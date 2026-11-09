// Error/issue codes for file processing; each has an i18n key under `upload.errors.*`.
export type ExtractionErrorCode =
  | "too_large"
  | "unsupported_type"
  | "type_mismatch"
  | "too_many_files"
  | "xml_unsafe"
  | "xml_invalid"
  | "pdf_invalid"
  | "pdf_encrypted"
  | "image_invalid"
  | "ocr_failed"
  | "unknown";

/** Non-fatal findings: the document is kept, but flagged to the user. */
export type ExtractionIssue = "xml_unsupported_layout" | "no_text_found" | "ocr_used";

export class ExtractionError extends Error {
  constructor(public code: ExtractionErrorCode) {
    super(code);
    this.name = "ExtractionError";
  }
}
