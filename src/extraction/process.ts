// One file → raw extraction (layer A). Dispatches by verified content type.
import type { FieldCandidate, InvoiceDocument, OCRToken } from "@/domain/types";
import { ExtractionError, type ExtractionIssue } from "./errors";
import { verifyContent } from "./files";
import { matchFields } from "./matching";

export type Stage = "reading" | "parsing" | "loading_ocr" | "ocr";

export interface ProcessedDocument {
  document: InvoiceDocument;
  tokens: OCRToken[];
  candidates: FieldCandidate[];
  pageImages: string[];
  issues: ExtractionIssue[];
}

export type Processor = (file: File, documentId: string, onProgress: (fraction: number, stage: Stage) => void) => Promise<ProcessedDocument>;

export const processFile: Processor = async (file, documentId, onProgress) => {
  onProgress(0, "reading");
  const buf = await file.arrayBuffer();
  const verdict = verifyContent(file.name, new Uint8Array(buf.slice(0, 16)));
  if (typeof verdict === "string") throw new ExtractionError(verdict);
  const { kind, mime } = verdict;
  const base = { id: documentId, name: file.name, mime, status: "ready" as const };

  if (kind === "xml") {
    onProgress(0, "parsing");
    const { parseInvoiceXml } = await import("./xml");
    const text = new TextDecoder("utf-8").decode(buf);
    const r = parseInvoiceXml(text, documentId);
    onProgress(1, "parsing");
    return {
      document: { ...base, pages: 1, pageSizes: [{ width: 0, height: 0 }], source: "xml", status: r.unsupportedLayout ? "unsupported" : "ready" },
      tokens: r.tokens,
      candidates: r.candidates,
      pageImages: [],
      issues: r.unsupportedLayout ? ["xml_unsupported_layout"] : [],
    };
  }

  if (kind === "pdf") {
    const { extractPdf } = await import("./pdf");
    const r = await extractPdf(buf, documentId, onProgress);
    const issues: ExtractionIssue[] = [];
    if (r.ocrPages.length) issues.push("ocr_used");
    if (!r.tokens.length) issues.push("no_text_found");
    return {
      document: { ...base, pages: r.pageSizes.length, pageSizes: r.pageSizes, source: r.ocrPages.length ? "ocr" : "pdf_text" },
      tokens: r.tokens,
      candidates: matchFields(r.tokens),
      pageImages: r.pageImages,
      issues,
    };
  }

  // Image → OCR.
  const blob = new Blob([buf], { type: mime });
  let size: { width: number; height: number };
  try {
    const bmp = await createImageBitmap(blob);
    size = { width: bmp.width, height: bmp.height };
    bmp.close();
  } catch {
    throw new ExtractionError("image_invalid");
  }
  const { recognizePage } = await import("./ocr");
  const tokens = await recognizePage({ image: blob, scale: 1 }, documentId, 1, documentId, (f, stage) => onProgress(stage === "ocr" ? f : 0, stage));
  return {
    document: { ...base, pages: 1, pageSizes: [size], source: "ocr" },
    tokens,
    candidates: matchFields(tokens),
    pageImages: [URL.createObjectURL(blob)],
    issues: tokens.length ? ["ocr_used"] : ["ocr_used", "no_text_found"],
  };
};
