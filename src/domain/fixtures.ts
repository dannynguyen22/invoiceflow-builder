// TEST/DEV FIXTURES ONLY. Synthetic invoices used to develop the editor (Phase 1)
// before real extraction exists (Phase 2). Never presented as real processing output.
import type { Cell, ExportColumn, FieldCandidate, FieldId, InvoiceDocument, OCRToken } from "./types";

export interface FixtureInvoice {
  document: InvoiceDocument;
  tokens: OCRToken[];
  candidates: FieldCandidate[];
}

let n = 0;
const tok = (documentId: string, text: string, x: number, y: number, w = 120, confidence = 0.9): OCRToken => ({
  id: `${documentId}-t${++n}`,
  documentId,
  page: 1,
  text,
  bbox: { x, y, width: w, height: 14 },
  confidence,
});

function build(
  id: string,
  name: string,
  values: Partial<Record<FieldId, string>>,
  extra: string[] = [],
): FixtureInvoice {
  const tokens: OCRToken[] = [];
  const candidates: FieldCandidate[] = [];
  let y = 40;
  for (const [fieldId, value] of Object.entries(values) as [FieldId, string][]) {
    const t = tok(id, value, 260, y);
    tokens.push(tok(id, `${fieldId}:`, 40, y, 180), t);
    candidates.push({ fieldId, tokenIds: [t.id], value, score: 0.8, reasons: ["fixture"] });
    y += 28;
  }
  for (const text of extra) {
    tokens.push(tok(id, text, 40, y, 200, 0.7));
    y += 28;
  }
  return { document: { id, name, mime: "application/pdf", pages: 1, status: "ready" }, tokens, candidates };
}

export const FIXTURE_INVOICES: FixtureInvoice[] = [
  build("doc-a", "hoa-don-0001234.pdf", {
    invoice_number: "0001234",
    invoice_date: "2026-10-03",
    invoice_series: "1C26TAA",
    seller_name: "Công ty TNHH Minh Phát",
    seller_tax_id: "0101234567",
    buyer_name: "Công ty CP Sao Mai",
    buyer_tax_id: "0309876543",
    subtotal: "10000000",
    vat_amount: "800000",
    total_amount: "10800000",
    currency: "VND",
  }),
  build("doc-b", "invoice_000987.pdf", {
    invoice_number: "000987",
    invoice_date: "2026-10-11",
    seller_name: "Công ty TNHH Minh Phát",
    seller_tax_id: "0101234567",
    buyer_tax_id: "0312345678",
    subtotal: "2500000",
    vat_amount: "250000",
    total_amount: "2750000",
    currency: "VND",
  }, ["0312345678-001"]),
  // Deliberately incomplete: no VAT, ambiguous tax ID candidates — for review-flag tests.
  build("doc-c", "scan_hd_55.jpg", {
    invoice_number: "0000055",
    seller_name: "Hộ kinh doanh Lan Anh",
    seller_tax_id: "8012345678",
    total_amount: "1650000",
  }, ["0109998887", "1500000"]),
];

export const DEFAULT_COLUMNS: ExportColumn[] = (
  ["invoice_number", "invoice_date", "seller_name", "seller_tax_id", "total_amount", "source_filename"] as FieldId[]
).map((fieldId, order) => ({ id: `col-${fieldId}`, fieldId, header: fieldId, order }));

export function fixtureCell(inv: FixtureInvoice, col: ExportColumn): Cell {
  if (col.fieldId === "source_filename") {
    return { documentId: inv.document.id, columnId: col.id, fieldId: col.fieldId, value: inv.document.name, sourceTokenIds: [], provenance: "extracted", reviewState: "confirmed", flags: [] };
  }
  const c = inv.candidates.find((x) => x.fieldId === col.fieldId);
  return {
    documentId: inv.document.id,
    columnId: col.id,
    fieldId: col.fieldId,
    value: c?.value ?? "",
    sourceTokenIds: c?.tokenIds ?? [],
    provenance: "extracted",
    reviewState: c ? "unreviewed" : "needs_review",
    flags: c ? [] : ["missing"],
  };
}
