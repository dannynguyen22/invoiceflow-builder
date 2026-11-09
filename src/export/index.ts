// Export orchestration: editor state + options → serialized file → download. Local-only, no network.
import type { EditorColumn, RawExtraction } from "@/domain/types";
import type { EditorState } from "@/editor/engine";
import type { Locale } from "@/i18n";
import { buildExportColumns, buildExportRows, filterRows, toMatrix, type ExportScope } from "./model";
import { toCsv } from "./csv";
import { toXlsx } from "./xlsx";
import { downloadBlob, exportFilename } from "./download";

export type { ExportScope } from "./model";
export { buildExportColumns, buildExportRows, filterRows } from "./model";
export { sanitizeForFormula } from "./csv";

export interface ExportFormat {
  type: "csv" | "xlsx";
  delimiter: "," | ";" | "\t";
  utf8Bom: boolean;
}

export interface ExportRequest {
  raw: RawExtraction;
  state: EditorState;
  columns: EditorColumn[];
  locale: Locale;
  scope: ExportScope;
  format: ExportFormat;
  /** Custom header text per column id (from a saved template); not rewritten on language switch. */
  headerOverrides?: Record<string, string>;
  /** Base filename stem; a date and extension are appended. */
  filenameStem?: string;
}

export interface ExportResult {
  rowCount: number;
  filename: string;
}

/** Build the matrix + serialized bytes without downloading (used by tests and preview). */
export function serializeExport(req: ExportRequest): { filename: string; data: string | Uint8Array; mime: string; rowCount: number } {
  const columns = buildExportColumns(req.columns, req.locale, req.headerOverrides);
  const rows = filterRows(buildExportRows(req.raw, req.state, req.columns), req.scope);
  const { header, body } = toMatrix(rows, columns, req.locale);
  if (req.format.type === "xlsx") {
    const data = toXlsx(header, body);
    return {
      filename: exportFilename(req.filenameStem, "xlsx"),
      data,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      rowCount: rows.length,
    };
  }
  const data = toCsv(header, body, { delimiter: req.format.delimiter, utf8Bom: req.format.utf8Bom });
  return { filename: exportFilename(req.filenameStem, "csv"), data, mime: "text/csv;charset=utf-8", rowCount: rows.length };
}

/** Serialize and trigger a browser download. */
export function runExport(req: ExportRequest): ExportResult {
  const { filename, data, mime, rowCount } = serializeExport(req);
  downloadBlob(data, filename, mime);
  return { rowCount, filename };
}
