// Vietnamese e-invoice XML (TT78/2021, NĐ123/2020 "HDon" schema) → raw tokens + candidates.
// Safe parsing: DOCTYPE/ENTITY declarations are refused before parsing (no entity expansion),
// and matching is namespace-agnostic (by localName) so prefixed/namespaced files work.
import type { FieldCandidate, FieldId, OCRToken } from "@/domain/types";
import { ExtractionError } from "./errors";

export interface XmlExtraction {
  tokens: OCRToken[];
  candidates: FieldCandidate[];
  /** True when no known invoice structure was recognised (tokens are still kept). */
  unsupportedLayout: boolean;
}

/** Field → element path (localNames) relative to the DLHDon element. */
const XML_FIELD_PATHS: [FieldId, string][] = [
  ["invoice_number", "TTChung/SHDon"],
  ["invoice_date", "TTChung/NLap"],
  ["currency", "TTChung/DVTTe"],
  ["seller_name", "NDHDon/NBan/Ten"],
  ["seller_tax_id", "NDHDon/NBan/MST"],
  ["seller_address", "NDHDon/NBan/DChi"],
  ["buyer_name", "NDHDon/NMua/Ten"],
  ["buyer_tax_id", "NDHDon/NMua/MST"],
  ["subtotal", "NDHDon/TToan/TgTCThue"],
  ["vat_amount", "NDHDon/TToan/TgTThue"],
  ["total_amount", "NDHDon/TToan/TgTTTBSo"],
];

const UNSAFE = /<!DOCTYPE|<!ENTITY/i;

function leafPath(el: Element): string {
  const parts: string[] = [];
  for (let n: Element | null = el; n; n = n.parentElement) parts.unshift(n.localName);
  return parts.join("/");
}

export function parseInvoiceXml(text: string, documentId: string): XmlExtraction {
  if (UNSAFE.test(text)) throw new ExtractionError("xml_unsafe");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length || !doc.documentElement) throw new ExtractionError("xml_invalid");

  // Every non-empty leaf element becomes one raw token with its structured source path.
  const tokens: OCRToken[] = [];
  const byPath = new Map<string, OCRToken>();
  let n = 0;
  const walk = (el: Element) => {
    const kids = Array.from(el.children);
    if (!kids.length) {
      const value = (el.textContent ?? "").trim();
      if (value) {
        const path = leafPath(el);
        const tk: OCRToken = { id: `${documentId}-x${++n}`, documentId, page: 1, text: value, confidence: 1, sourcePath: path };
        tokens.push(tk);
        if (!byPath.has(path)) byPath.set(path, tk);
      }
      return;
    }
    kids.forEach(walk);
  };
  walk(doc.documentElement);

  // Locate the DLHDon element by localName anywhere (signed files wrap it in extra nodes).
  const dl = Array.from(doc.getElementsByTagNameNS("*", "DLHDon"))[0] ?? null;
  const candidates: FieldCandidate[] = [];
  if (dl) {
    const base = leafPath(dl);
    for (const [fieldId, rel] of XML_FIELD_PATHS) {
      const tk = byPath.get(`${base}/${rel}`);
      if (tk) candidates.push({ fieldId, tokenIds: [tk.id], value: tk.text, score: 1, reasons: ["xml_path"] });
    }
    // Series = template code (KHMSHDon) + series symbol (KHHDon), e.g. "1" + "C26TAA".
    const ms = byPath.get(`${base}/TTChung/KHMSHDon`);
    const kh = byPath.get(`${base}/TTChung/KHHDon`);
    if (kh) {
      const tokenIds = ms ? [ms.id, kh.id] : [kh.id];
      candidates.push({ fieldId: "invoice_series", tokenIds, value: `${ms?.text ?? ""}${kh.text}`, score: 1, reasons: ["xml_path"] });
    }
  }
  return { tokens, candidates, unsupportedLayout: candidates.length === 0 };
}
