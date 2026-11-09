// TEST/DEV FIXTURES ONLY. Synthetic invoices used to develop the editor (Phase 1)
// and tests. doc-b spans two pages (totals on page 2) to exercise multi-page preview. Never presented as real processing output.
import type { EditorColumn, FieldCandidate, FieldId, InvoiceDocument, OCRToken, RawExtraction, SupportedMime } from "./types";

type Line = { label: string; value: string; field?: FieldId; score?: number };
type Extra = { text: string; field?: FieldId; score?: number };

const PAGE = { width: 600, height: 800 };

/** `breakAfter`: number of label/value lines on page 1; the rest (and extras) go to page 2. */
function buildDoc(id: string, name: string, mime: SupportedMime, lines: Line[], extras: Extra[] = [], breakAfter?: number) {
  const tokens: OCRToken[] = [];
  const candidates: FieldCandidate[] = [];
  let n = 0;
  let page = 1;
  const mk = (text: string, x: number, y: number, w: number, confidence: number): OCRToken => ({
    id: `${id}-t${++n}`,
    documentId: id,
    page,
    text,
    bbox: { x, y, width: w, height: 18 },
    confidence,
  });
  let y = 60;
  for (const [i, l] of lines.entries()) {
    if (breakAfter !== undefined && i === breakAfter) {
      page = 2;
      y = 60;
    }
    tokens.push(mk(l.label, 40, y, 200, 0.95));
    const v = mk(l.value, 260, y, Math.min(300, 20 + l.value.length * 9), 0.9);
    tokens.push(v);
    if (l.field) candidates.push({ fieldId: l.field, tokenIds: [v.id], value: l.value, score: l.score ?? 0.9, reasons: ["label_match"] });
    y += 34;
  }
  y += 20;
  for (const e of extras) {
    const t = mk(e.text, 40, y, Math.min(400, 20 + e.text.length * 9), 0.7);
    tokens.push(t);
    if (e.field) candidates.push({ fieldId: e.field, tokenIds: [t.id], value: e.text, score: e.score ?? 0.5, reasons: ["value_shape"] });
    y += 34;
  }
  const document: InvoiceDocument = {
    id,
    name,
    mime,
    pages: page,
    pageSizes: Array.from({ length: page }, () => PAGE),
    source: "fixture",
    status: "ready",
  };
  return { document, tokens, candidates };
}

const docs = [
  buildDoc("doc-a", "hoa-don-0001234.pdf", "application/pdf", [
    { label: "Số hóa đơn:", value: "0001234", field: "invoice_number" },
    { label: "Ngày:", value: "2026-10-03", field: "invoice_date" },
    { label: "Ký hiệu:", value: "1C26TAA", field: "invoice_series" },
    { label: "Đơn vị bán hàng:", value: "Công ty TNHH Minh Phát", field: "seller_name" },
    { label: "Mã số thuế:", value: "0101234567", field: "seller_tax_id" },
    { label: "Địa chỉ:", value: "12 Lê Lợi, Q.1, TP.HCM", field: "seller_address" },
    { label: "Người mua hàng:", value: "Công ty CP Sao Mai", field: "buyer_name" },
    { label: "MST người mua:", value: "0309876543", field: "buyer_tax_id" },
    { label: "Cộng tiền hàng:", value: "10000000", field: "subtotal" },
    { label: "Tiền thuế GTGT:", value: "800000", field: "vat_amount" },
    { label: "Tổng thanh toán:", value: "10800000", field: "total_amount" },
    { label: "Loại tiền:", value: "VND", field: "currency" },
  ], [{ text: "8%" }]),
  buildDoc("doc-b", "invoice_000987.pdf", "application/pdf", [
    { label: "Invoice No.:", value: "000987", field: "invoice_number" },
    { label: "Date:", value: "2026-10-11", field: "invoice_date" },
    { label: "Seller:", value: "Công ty TNHH Minh Phát", field: "seller_name" },
    { label: "Tax code:", value: "0101234567", field: "seller_tax_id" },
    { label: "Buyer tax code:", value: "0312345678", field: "buyer_tax_id", score: 0.85 },
    { label: "Sub total:", value: "2500000", field: "subtotal" },
    { label: "VAT (10%):", value: "250000", field: "vat_amount" },
    { label: "Total:", value: "2750000", field: "total_amount" },
    { label: "Currency:", value: "VND", field: "currency" },
  ], [{ text: "0312345678-001", field: "buyer_tax_id", score: 0.6 }], 5),
  // Deliberately incomplete/ambiguous: no date, two near-equal tax ID candidates.
  buildDoc("doc-c", "scan_hd_55.jpg", "image/jpeg", [
    { label: "Số:", value: "0000055", field: "invoice_number" },
    { label: "Hộ kinh doanh:", value: "Hộ kinh doanh Lan Anh", field: "seller_name" },
    { label: "MST:", value: "8012345678", field: "seller_tax_id", score: 0.66 },
    { label: "Tổng cộng:", value: "1650000", field: "total_amount" },
  ], [
    { text: "0109998887", field: "seller_tax_id", score: 0.6 },
    { text: "1500000", field: "subtotal", score: 0.5 },
  ]),
];

export const FIXTURE_RAW: RawExtraction = {
  documents: docs.map((d) => d.document),
  tokens: docs.flatMap((d) => d.tokens),
  candidates: Object.fromEntries(docs.map((d) => [d.document.id, d.candidates])),
};

export const DEFAULT_COLUMN_FIELDS: FieldId[] = [
  "invoice_number",
  "invoice_date",
  "seller_name",
  "seller_tax_id",
  "total_amount",
  "source_filename",
];

export const DEFAULT_COLUMNS: EditorColumn[] = DEFAULT_COLUMN_FIELDS.map((fieldId) => ({ id: `col-${fieldId}`, fieldId }));
