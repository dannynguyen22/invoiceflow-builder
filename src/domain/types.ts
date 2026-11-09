// Domain contracts (PRD §08). Three layers that must stay separate:
// A) raw extraction (immutable)  B) interpreted records  C) export view.

export type FieldId =
  | "invoice_number"
  | "invoice_date"
  | "invoice_series"
  | "seller_name"
  | "seller_tax_id"
  | "seller_address"
  | "buyer_name"
  | "buyer_tax_id"
  | "subtotal"
  | "vat_amount"
  | "total_amount"
  | "currency"
  | "source_filename"
  | "notes"
  | "review_status";

export type FieldGroup = "invoice" | "seller" | "buyer" | "amounts" | "metadata";
export type FieldValueType = "text" | "identifier" | "date" | "amount" | "currency" | "status";

export interface FieldDefinition {
  id: FieldId;
  group: FieldGroup;
  valueType: FieldValueType;
  /** Translation key for the display label; never used as identity. */
  labelKey: string;
}

export type SupportedMime = "application/pdf" | "application/xml" | "text/xml" | "image/jpeg" | "image/png";
export type DocumentStatus = "queued" | "processing" | "ready" | "failed" | "unsupported";

// ---- Layer A: raw extraction (immutable) ----
export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface InvoiceDocument {
  readonly id: string;
  readonly name: string;
  readonly mime: SupportedMime;
  readonly pages: number;
  status: DocumentStatus;
}
export interface OCRToken {
  readonly id: string;
  readonly documentId: string;
  readonly page: number;
  readonly text: string;
  readonly bbox: BBox;
  /** Engine-reported confidence 0–1; not a calibrated probability. */
  readonly confidence: number;
}

// ---- Layer B: interpreted records ----
export interface FieldCandidate {
  fieldId: FieldId;
  tokenIds: string[];
  value: string;
  /** Heuristic ranking score, not a probability. */
  score: number;
  reasons: string[];
}
export type ReviewState = "unreviewed" | "needs_review" | "confirmed" | "manual";
export type Provenance = "extracted" | "candidate" | "ocr_drop" | "manual" | "auto_fill" | "batch";
export interface Cell {
  documentId: string;
  columnId: string;
  /** Per-cell semantic field; may differ from column field after header replacement. */
  fieldId: FieldId;
  value: string;
  sourceTokenIds: string[];
  provenance: Provenance;
  reviewState: ReviewState;
  flags: string[];
}

// ---- Layer C: export view ----
export interface ExportColumn {
  id: string;
  fieldId: FieldId;
  header: string;
  order: number;
}
export type CorrectionKind =
  | "set_value"
  | "replace_field"
  | "add_column"
  | "reorder_columns"
  | "auto_fill"
  | "batch_correction";
export type CorrectionScope = "cell" | "current_invoice" | "same_supplier" | "similar_layout" | "batch";
export interface CellChange {
  documentId: string;
  columnId: string;
  before: Cell | null;
  after: Cell | null;
}
export interface CorrectionOperation {
  id: string;
  kind: CorrectionKind;
  scope: CorrectionScope;
  changes: CellChange[];
  createdAt: string;
}
export interface ExportTemplate {
  id: string;
  userId: string;
  name: string;
  columns: ExportColumn[];
  format: {
    type: "csv" | "xlsx";
    delimiter: "," | ";" | "\t";
    dateFormat: string;
    numberFormat: "vi" | "en";
    utf8Bom: boolean;
  };
}
