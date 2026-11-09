import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ExtractionError } from "@/extraction/errors";
import { precheck, sniff, verifyContent } from "@/extraction/files";
import { pdfItemBBox, pixelBoxToPage, splitRun } from "@/extraction/geometry";
import { buildRaw, createUploadStore } from "@/extraction/store";
import type { Processor } from "@/extraction/process";
import { parseInvoiceXml } from "@/extraction/xml";

const sample = readFileSync(`${process.cwd()}/src/test/samples/hoadon-tt78.xml`, "utf8");
const enc = (s: string) => new TextEncoder().encode(s);

describe("XML e-invoice parser", () => {
  it("maps TT78 fields with source paths and keeps leading zeros", () => {
    const r = parseInvoiceXml(sample, "d1");
    const v = Object.fromEntries(r.candidates.map((c) => [c.fieldId, c.value]));
    expect(v).toMatchObject({
      invoice_number: "00001234",
      invoice_series: "1C26TAA",
      invoice_date: "2026-10-03",
      seller_tax_id: "0101234567",
      buyer_tax_id: "0309876543-001",
      vat_amount: "800000",
      total_amount: "10800000",
      currency: "VND",
    });
    expect(r.unsupportedLayout).toBe(false);
    const tk = r.tokens.find((t) => t.text === "0101234567")!;
    expect(tk.sourcePath).toBe("HDon/DLHDon/NDHDon/NBan/MST");
    // seller vs buyer tax ID come from different paths
    const buyer = r.candidates.find((c) => c.fieldId === "buyer_tax_id")!;
    expect(r.tokens.find((t) => t.id === buyer.tokenIds[0])!.sourcePath).toContain("NMua");
  });
  it("is namespace-agnostic", () => {
    const ns = sample.replace(/<(\/?)(\w+)/g, "<$1inv:$2").replace("<inv:?xml", "<?xml").replace('inv:HDon xmlns:inv', "inv:HDon xmlns:inv");
    const r = parseInvoiceXml(ns, "d1");
    expect(r.candidates.find((c) => c.fieldId === "seller_tax_id")?.value).toBe("0101234567");
  });
  it("rejects DOCTYPE/ENTITY (no entity expansion)", () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><x>&a;</x>`;
    expect(() => parseInvoiceXml(bomb, "d1")).toThrow(ExtractionError);
  });
  it("rejects malformed XML", () => {
    expect(() => parseInvoiceXml("<a><b></a>", "d1")).toThrowError("xml_invalid");
  });
  it("flags unknown layouts but keeps the raw values", () => {
    const r = parseInvoiceXml("<Root><Foo>123</Foo></Root>", "d1");
    expect(r.unsupportedLayout).toBe(true);
    expect(r.candidates).toHaveLength(0);
    expect(r.tokens.map((t) => t.text)).toEqual(["123"]);
  });
});

describe("file admission", () => {
  it("checks extension and size", () => {
    expect(precheck({ name: "a.docx", size: 10 })).toBe("unsupported_type");
    expect(precheck({ name: "a.pdf", size: 21 * 1024 * 1024 })).toBe("too_large");
    expect(precheck({ name: "A.PDF", size: 10 })).toBeNull();
  });
  it("sniffs real content and detects mismatches", () => {
    expect(sniff(enc("%PDF-1.7"))?.kind).toBe("pdf");
    expect(sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))?.mime).toBe("image/png");
    expect(sniff(new Uint8Array([0xef, 0xbb, 0xbf, 0x20, 0x3c]))?.kind).toBe("xml");
    expect(verifyContent("x.pdf", enc("<xml/>"))).toBe("type_mismatch");
    expect(verifyContent("x.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toMatchObject({ mime: "image/jpeg" });
  });
});

describe("geometry", () => {
  it("converts a pdf.js text item to a top-left bbox", () => {
    // Page 600x800, viewport flips y: [1,0,0,-1,0,800]; 12pt text at (100, 700) in PDF space.
    const b = pdfItemBBox([1, 0, 0, -1, 0, 800], [12, 0, 0, 12, 100, 700], 60);
    expect(b).toEqual({ x: 100, y: 88, width: 60, height: 12 });
  });
  it("splits runs into word boxes inside the run box", () => {
    const words = splitRun("MST: 0101234567", { x: 0, y: 0, width: 150, height: 10 });
    expect(words.map((w) => w.text)).toEqual(["MST:", "0101234567"]);
    expect(words[1]!.bbox.x).toBe(50);
    expect(words[1]!.bbox.width).toBe(100);
  });
  it("maps OCR pixel boxes back by render scale", () => {
    expect(pixelBoxToPage({ x0: 20, y0: 40, x1: 220, y1: 80 }, 2)).toEqual({ x: 10, y: 20, width: 100, height: 20 });
  });
});

describe("upload store", () => {
  const file = (name: string, size = 10) => ({ name, size }) as File;
  const okProc: Processor = async (f, id, onProgress) => {
    onProgress(0.5, "parsing");
    return {
      document: { id, name: f.name, mime: "application/xml", pages: 1, pageSizes: [{ width: 0, height: 0 }], source: "xml", status: "ready" },
      tokens: [{ id: `${id}-x1`, documentId: id, page: 1, text: "1", confidence: 1 }],
      candidates: [],
      pageImages: [],
      issues: [],
    };
  };
  it("processes queued files, enforces the cap and builds raw extraction", async () => {
    const s = createUploadStore(okProc, 2);
    const r = s.add([file("a.xml"), file("b.xml"), file("c.xml")]);
    expect(r).toEqual({ accepted: 2, rejectedOverLimit: 1 });
    await s.idle();
    expect(s.getSnapshot().map((i) => i.status)).toEqual(["ready", "ready"]);
    const raw = buildRaw(s.getSnapshot());
    expect(raw.documents).toHaveLength(2);
    expect(raw.tokens.every((t) => raw.documents.some((d) => d.id === t.documentId))).toBe(true);
  });
  it("marks failures with their code and supports retry/remove", async () => {
    let fail = true;
    const proc: Processor = async (f, id, p) => {
      if (fail) throw new ExtractionError("pdf_invalid");
      return okProc(f, id, p);
    };
    const s = createUploadStore(proc);
    s.add([file("a.xml"), file("bad.docx")]);
    await s.idle();
    const [a, b] = s.getSnapshot();
    expect(a).toMatchObject({ status: "failed", error: "pdf_invalid" });
    expect(b).toMatchObject({ status: "failed", error: "unsupported_type" });
    fail = false;
    s.retry(a!.id);
    await s.idle();
    expect(s.getSnapshot()[0]!.status).toBe("ready");
    s.remove(b!.id);
    expect(s.getSnapshot()).toHaveLength(1);
  });
});
