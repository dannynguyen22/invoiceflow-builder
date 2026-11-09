// Layer C (export view, PRD §08): derive export columns + rows from editor state + raw.
// Export never mutates layers A/B. Identifiers (tax IDs, invoice numbers, series) stay strings
// so leading zeros survive (PRD §05, §14). Values come straight from the cells the user reviewed.
import { getField } from "@/domain/fields";
import type { Cell, EditorColumn, ExportColumn, FieldId, RawExtraction, ReviewState } from "@/domain/types";
import { cellKey, type EditorState } from "@/editor/engine";
import { translate, type Locale } from "@/i18n";

/** Value types that must be written as text, never coerced to a number, to keep leading zeros. */
export function isIdentifierField(fieldId: FieldId): boolean {
  const vt = getField(fieldId).valueType;
  return vt === "identifier" || vt === "tax_id";
}

/** A header string for a field in the chosen locale. Used as the default export header. */
export function defaultHeader(fieldId: FieldId, locale: Locale): string {
  return translate(locale, `fields.${fieldId}`);
}

/**
 * Build export columns from the editor's current schema. Headers default to the chosen locale's
 * field label, but a saved template's custom headers take precedence and are NOT rewritten on a
 * language switch (PRD §09, §14). The `review_status` column is synthesised from each cell's state.
 */
export function buildExportColumns(columns: EditorColumn[], locale: Locale, headerOverrides?: Record<string, string>): ExportColumn[] {
  return columns.map((c, i) => ({
    id: c.id,
    fieldId: c.fieldId,
    header: headerOverrides?.[c.id] ?? defaultHeader(c.fieldId, locale),
    order: i,
  }));
}

export type ExportScope = "all" | "validated" | "with_status";

export interface ExportRow {
  documentId: string;
  cells: Cell[];
  /** True when no cell in the row is flagged needs_review. */
  valid: boolean;
}

/** Row-level review summary: a row is "valid" only when none of its cells need review. */
export function buildExportRows(raw: RawExtraction, state: EditorState, columns: EditorColumn[]): ExportRow[] {
  return raw.documents.map((d) => {
    const cells = columns.map((c) => state.cells[cellKey(d.id, c.id)]!).filter(Boolean);
    const valid = cells.every((c) => c.reviewState !== "needs_review");
    return { documentId: d.id, cells, valid };
  });
}

/** Human-readable review status per cell, worst-case for the row (for the review_status column). */
function rowReviewStatus(cells: Cell[], locale: Locale): string {
  const order: ReviewState[] = ["needs_review", "unreviewed", "manual", "confirmed"];
  let worst: ReviewState = "confirmed";
  for (const c of cells) {
    // review_status column itself has no meaningful reviewState; skip it.
    if (c.fieldId === "review_status") continue;
    if (order.indexOf(c.reviewState) < order.indexOf(worst)) worst = c.reviewState;
  }
  return translate(locale, `review.${worst}`);
}

/**
 * Produce the final 2-D string matrix (header row + data rows) for serialization.
 * The `review_status` field is filled from the row summary; all other fields use the cell value.
 */
export function toMatrix(
  rows: ExportRow[],
  columns: ExportColumn[],
  locale: Locale,
): { header: string[]; body: { fieldId: FieldId; value: string }[][] } {
  const header = columns.map((c) => c.header);
  const body = rows.map((row) => {
    const byColumn = new Map(row.cells.map((c) => [c.columnId, c]));
    return columns.map((col) => {
      if (col.fieldId === "review_status") return { fieldId: col.fieldId, value: rowReviewStatus(row.cells, locale) };
      const cell = byColumn.get(col.id);
      return { fieldId: col.fieldId, value: cell?.value ?? "" };
    });
  });
  return { header, body };
}

export function filterRows(rows: ExportRow[], scope: ExportScope): ExportRow[] {
  if (scope === "validated") return rows.filter((r) => r.valid);
  return rows; // "all" and "with_status" export every row (with_status just means include the status column)
}
