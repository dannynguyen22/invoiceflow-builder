// Domain contracts (PRD §08). Three layers that must stay separate:
//  A) Raw extraction (immutable): documents, pages, OCR tokens, candidates.
//  B) Interpreted records: one Cell per (document, column). Each cell carries its OWN
//     field interpretation (`Cell.fieldId`), which can differ from the column's field.
//  C) Export view: which columns are exported, their headers, order and format.
//
// Three distinct "field" notions — never conflate them:
//  - EditorColumn.fieldId : the column's schema field (what the header says).
//  - Cell.fieldId         : what this specific value was extracted/confirmed as.
//  - ExportColumn         : export configuration (header text, order) derived from columns.
// A header replacement changes EditorColumn.fieldId only. Cells keep value, sources and
// interpretation; cells whose interpretation no longer matches are flagged for review.

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
export type FieldValueType = "text" | "identifier" | "tax_id" | "date" | "amount" | "currency" | "status";

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
export interface PageSize {
  width: number;
  height: number;
}
/** How the raw tokens were produced. "fixture" = synthetic sample data. */
export type ExtractionSource = "xml" | "pdf_text" | "ocr" | "fixture";
export interface InvoiceDocument {
  readonly id: string;
  readonly name: string;
  readonly mime: SupportedMime;
  readonly pages: number;
  /** Size of each page (index 0 = page 1) in the coordinate space of token bboxes. */
  readonly pageSizes: readonly PageSize[];
  readonly source: ExtractionSource;
  status: DocumentStatus;
}
export interface OCRToken {
  readonly id: string;
  readonly documentId: string;
  readonly page: number;
  readonly text: string;
  /** Position on the page. Absent for structured sources (XML) that have no geometry. */
  readonly bbox?: BBox;
  /** Structured source path (XML element path), when the token comes from structured data. */
  readonly sourcePath?: string;
  /** Engine-reported confidence 0–1; not a calibrated probability. */
  readonly confidence: number;
}
export interface FieldCandidate {
  fieldId: FieldId;
  tokenIds: string[];
  value: string;
  /** Heuristic ranking score, not a probability. */
  score: number;
  reasons: string[];
  /** Source line text around the value (for review UI); raw document text only. */
  context?: string;
}
export interface RawExtraction {
  readonly documents: readonly InvoiceDocument[];
  readonly tokens: readonly OCRToken[];
  /** Candidates per document id. */
  readonly candidates: Readonly<Record<string, readonly FieldCandidate[]>>;
}

// ---- Layer B: interpreted records ----
export type ReviewState = "unreviewed" | "needs_review" | "confirmed" | "manual";
export type Provenance = "extracted" | "candidate" | "ocr_drop" | "manual" | "auto_fill" | "batch" | "empty";
export type CellFlag = "missing" | "invalid_format" | "field_mismatch";
export interface Cell {
  documentId: string;
  columnId: string;
  /** Per-cell semantic interpretation; may differ from the column field after header replacement. */
  fieldId: FieldId;
  value: string;
  sourceTokenIds: string[];
  provenance: Provenance;
  reviewState: ReviewState;
  flags: CellFlag[];
  /**
   * Explicit user verification. Selecting a value (candidate, OCR drop, manual edit) never
   * sets this; only the verify command does, and any later value/field change clears it.
   */
  verified: boolean;
}
/** Grid/schema column. Order = position in the columns array; identity = stable `id`. */
export interface EditorColumn {
  id: string;
  fieldId: FieldId;
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
  | "verify"
  | "auto_fill"
  | "batch_correction";
export type CorrectionScope = "cell" | "column" | "current_invoice" | "same_supplier" | "similar_layout" | "batch";
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
  /** Present when the operation changed the column schema. */
  columns?: { before: EditorColumn[]; after: EditorColumn[] } | undefined;
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
