// Matching pipeline regression tests. `real-extraction.json` holds REAL output captured from
// this app's pipeline: PDF.js text of a generated 2-page A4 PDF and Tesseract OCR of a
// blurred, slightly rotated JPEG scan of the same invoice (OCR errors included as-is).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_COLUMNS } from "@/domain/fixtures";
import type { FieldCandidate, FieldId, InvoiceDocument, OCRToken, RawExtraction } from "@/domain/types";
import { cellKey, createInitialState, reliableCandidate } from "@/editor/engine";
import { buildLines, matchFields, matchLabel, normalizeAmount, similarity } from "@/extraction/matching";

type Sample = { name: string; document: InvoiceDocument; tokens: OCRToken[] };
const samples: Sample[] = JSON.parse(readFileSync(`${process.cwd()}/src/test/samples/real-extraction.json`, "utf8"));

const rawOf = (s: Sample): RawExtraction => ({ documents: [s.document], tokens: s.tokens, candidates: { [s.document.id]: matchFields(s.tokens) } });
const reliable = (s: Sample, f: FieldId) => reliableCandidate(rawOf(s), s.document.id, f)?.value ?? null;

const EXPECTED: Partial<Record<FieldId, string>> = {
  invoice_number: "0004567",
  invoice_series: "1C26TAA",
  invoice_date: "05/10/2026",
  seller_name: "CÔNG TY TNHH HÒA BÌNH",
  seller_tax_id: "0105556667",
  buyer_name: "CÔNG TY CP THƯƠNG MẠI SAO VIỆT",
  buyer_tax_id: "0312345678-001",
  subtotal: "12500000",
  vat_amount: "1000000",
  total_amount: "13500000",
  currency: "VND",
};

describe.each(samples.map((s) => [s.name, s] as const))("real document %s", (_name, s) => {
  it.each(Object.entries(EXPECTED))("reliably matches %s", (field, value) => {
    expect(reliable(s, field as FieldId)).toBe(value);
  });
  it("every candidate references this document's own tokens and is built from their text", () => {
    const ids = new Set(s.tokens.map((t) => t.id));
    for (const c of matchFields(s.tokens)) {
      expect(c.tokenIds.length).toBeGreaterThan(0);
      for (const id of c.tokenIds) expect(ids.has(id)).toBe(true);
      const src = c.tokenIds.map((id) => s.tokens.find((t) => t.id === id)!.text).join("").replace(/\D/g, "");
      if (/^\d[\d-]*$/.test(c.value)) expect(src).toContain(c.value.replace(/\D/g, ""));
    }
  });
  it("populates the editor table for reliable fields", () => {
    const st = createInitialState(rawOf(s), DEFAULT_COLUMNS);
    expect(st.cells[cellKey(s.document.id, "col-seller_tax_id")]!.value).toBe("0105556667");
    expect(st.cells[cellKey(s.document.id, "col-total_amount")]!.value).toBe("13500000");
    expect(st.cells[cellKey(s.document.id, "col-total_amount")]!.verified).toBe(false);
  });
});

describe("multi-page", () => {
  it("finds totals on page 2 of the PDF", () => {
    const pdf = samples.find((x) => x.document.pages === 2)!;
    const c = matchFields(pdf.tokens).find((x) => x.fieldId === "total_amount")!;
    expect(pdf.tokens.find((t) => t.id === c.tokenIds[0])!.page).toBe(2);
  });
});

// ---- synthetic edge cases (positioned token rows) ----
let n = 0;
function doc(rows: string[][]): OCRToken[] {
  const out: OCRToken[] = [];
  rows.forEach((words, r) => {
    let x = 20;
    for (const w of words) {
      out.push({ id: `s${++n}`, documentId: "d", page: 1, text: w, bbox: { x, y: 20 + r * 30, width: w.length * 8, height: 14 }, confidence: 0.9 });
      x += w.length * 8 + 6;
    }
  });
  return out;
}
const top = (cs: FieldCandidate[], f: FieldId) => cs.filter((c) => c.fieldId === f).sort((a, b) => b.score - a.score)[0]?.value;

describe("matching rules", () => {
  it("distinguishes seller vs buyer tax IDs by section", () => {
    const cs = matchFields(doc([["Người", "bán:", "Công", "ty", "A"], ["MST:", "0101234567"], ["Người", "mua:", "Công", "ty", "B"], ["MST:", "0309876543"]]));
    expect(top(cs, "seller_tax_id")).toBe("0101234567");
    expect(top(cs, "buyer_tax_id")).toBe("0309876543");
  });
  it("does not confuse VAT rate/amount with a tax ID", () => {
    const cs = matchFields(doc([["Thuế", "suất", "GTGT:", "10%"], ["Tiền", "thuế", "GTGT:", "250.000"]]));
    expect(top(cs, "vat_amount")).toBe("250000");
    expect(cs.some((c) => c.value === "10%" || c.value === "10")).toBe(false);
    expect(cs.some((c) => c.fieldId.endsWith("tax_id"))).toBe(false);
  });
  it("keeps leading zeros", () => {
    expect(top(matchFields(doc([["Số", "hóa", "đơn:", "0000055"]])), "invoice_number")).toBe("0000055");
  });
  it("never fabricates a missing value", () => {
    const cs = matchFields(doc([["Mã", "số", "thuế:"], ["Ngày:", "chưa", "ghi"]]));
    expect(cs).toHaveLength(0);
  });
  it("uses the line below when the label has no value on its line", () => {
    const cs = matchFields(doc([["Tổng", "cộng", "thanh", "toán:"], ["1.650.000"]]));
    const c = cs.find((x) => x.fieldId === "total_amount")!;
    expect(c.value).toBe("1650000");
    expect(c.reasons).toContain("below_label");
  });
  it("keeps alternatives: ambiguous tax IDs are not auto-filled", () => {
    const toks = doc([["MST:", "8012345678"], ["MST:", "0109998887"]]);
    const raw: RawExtraction = { documents: [], tokens: toks, candidates: { d: matchFields(toks) } };
    expect(matchFields(toks).filter((c) => c.fieldId === "seller_tax_id").length).toBeGreaterThanOrEqual(2);
    expect(reliableCandidate(raw, "d", "seller_tax_id")).toBeNull();
  });
  it("handles fuzzy OCR labels", () => {
    expect(matchLabel("Mã sd thuế")?.role).toBe("tax_id");
    expect(matchLabel("Cong tiền hàng")?.role).toBe("subtotal");
    expect(similarity("abc", "abc")).toBe(1);
  });
  it("normalizes Vietnamese amounts", () => {
    expect(normalizeAmount("12.500.000")).toBe("12500000");
    expect(normalizeAmount("1.234,50")).toBe("1234.50");
    expect(normalizeAmount("abc")).toBeNull();
  });
  it("groups tokens into lines left to right", () => {
    const lines = buildLines(doc([["b", "a"]]).reverse());
    expect(lines[0]!.text).toBe("b a");
  });
});
