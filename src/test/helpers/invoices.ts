// Synthetic positioned invoices for editor tests (as the PDF/OCR pipeline would produce them).
import type {
  EditorColumn,
  FieldCandidate,
  InvoiceDocument,
  OCRToken,
  RawExtraction,
} from "@/domain/types";
import { assignToken, createInitialState, type EditorState } from "@/editor/engine";
import { matchFields } from "@/extraction/matching";

export const PAGE = { width: 600, height: 800 };

/** Rows of words → positioned tokens (one text line per row). */
export function tokensFor(docId: string, rows: string[][], pageIndex = 1): OCRToken[] {
  const out: OCRToken[] = [];
  let n = 0;
  rows.forEach((words, r) => {
    let x = 40;
    for (const w of words) {
      out.push({
        id: `${docId}-t${++n}`,
        documentId: docId,
        page: pageIndex,
        text: w,
        bbox: { x, y: 60 + r * 30, width: w.length * 7, height: 14 },
        confidence: 0.95,
      });
      x += w.length * 7 + 6;
    }
  });
  return out;
}

export function docOf(id: string, source: InvoiceDocument["source"] = "pdf_text"): InvoiceDocument {
  return {
    id,
    name: `${id}.pdf`,
    mime: "application/pdf",
    pages: 1,
    pageSizes: [PAGE],
    source,
    status: "ready",
  };
}

export interface Vals {
  num: string;
  date: string;
  seller: string[];
  sellerTax: string;
  buyer: string[];
  buyerTax: string;
  total: string;
}
/** Template X: unusual invoice-number label ("Số định danh") the registry matcher does not know. */
export const templateX = (v: Vals): string[][] => [
  ["HÓA", "ĐƠN", "GIÁ", "TRỊ", "GIA", "TĂNG"],
  ["Số", "định", "danh:", v.num],
  ["Ngày", "lập:", v.date],
  ["Bên", "bán:", ...v.seller],
  ["Mã", "số", "thuế:", v.sellerTax],
  ["Bên", "mua:", ...v.buyer],
  ["Mã", "số", "thuế:", v.buyerTax],
  ["Tổng", "cộng", "thanh", "toán:", v.total],
];
/** Template Y: another supplier's layout, same extraction source. */
export const templateY = (v: Vals): string[][] => [
  ["Invoice", "copy"],
  ["Seller", "tax", "code:", v.sellerTax],
  ["Reference", "no.:", v.num],
  ["Grand", "total:", v.total],
];

export const V = (n: number, seller = "Minh Phát"): Vals => ({
  num: `000${4560 + n}`,
  date: `0${n}/10/2026`,
  seller: ["Công", "ty", seller],
  sellerTax: n % 2 ? "0101234567" : "0105556667",
  buyer: ["Công", "ty", "Sao", "Việt"],
  buyerTax: "0312345678",
  total: `${n}.500.000`,
});

export function build(
  docs: { id: string; rows: string[][]; source?: InvoiceDocument["source"] }[],
): RawExtraction {
  const tokens = docs.flatMap((d) => tokensFor(d.id, d.rows));
  const candidates: Record<string, FieldCandidate[]> = {};
  for (const d of docs) candidates[d.id] = matchFields(tokens.filter((t) => t.documentId === d.id));
  return { documents: docs.map((d) => docOf(d.id, d.source)), tokens, candidates };
}

export const INV: EditorColumn = { id: "c-num", fieldId: "invoice_number" };
export const TAX: EditorColumn = { id: "c-tax", fieldId: "seller_tax_id" };
export const TOTAL: EditorColumn = { id: "c-total", fieldId: "total_amount" };
export const tokenId = (raw: RawExtraction, doc: string, text: string, nth = 0) =>
  raw.tokens.filter((t) => t.documentId === doc && t.text === text)[nth]!.id;

/** The user drops the OCR token onto the example cell (provenance ocr_drop). */
export function withExample(
  raw: RawExtraction,
  cols: EditorColumn[],
  doc: string,
  col: string,
  tokenText: string,
  nth = 0,
): EditorState {
  const st = createInitialState(raw, cols);
  const r = assignToken(st, raw, doc, col, tokenId(raw, doc, tokenText, nth));
  if (!r.ok) throw new Error(r.error);
  return r.state;
}
