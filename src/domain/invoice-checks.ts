// Cross-field invoice consistency checks (PRD §04, §14). Deterministic, no AI.
// These complement per-cell format validation (validation.ts) with arithmetic/duplicate checks
// used by the review summary and the export validation dialog. They never mutate data.
import type { Cell, FieldId, RawExtraction } from "./types";
import { cellKey, type EditorState } from "@/editor/engine";

export type InvoiceIssueCode = "vat_mismatch" | "total_not_sum" | "duplicate_invoice";

export interface InvoiceIssue {
  code: InvoiceIssueCode;
  documentId: string;
  /** Field ids involved, for highlighting. */
  fields: FieldId[];
}

/** Parse a normalized amount cell ("10800000", "10800000.50") to a number, or null. */
function amount(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value.replace(/\s/g, ""));
  return Number.isFinite(n) ? n : null;
}

function cellValue(state: EditorState, documentId: string, fieldId: FieldId): string | undefined {
  // Find the first column carrying this field, then read that cell.
  const col = state.columns.find((c) => c.fieldId === fieldId);
  if (!col) return undefined;
  return state.cells[cellKey(documentId, col.id)]?.value;
}

/**
 * VAT arithmetic: subtotal + vat_amount ≈ total_amount, with tolerance for rounding/discounts.
 * Tolerance is the larger of 1 currency unit or 0.5% of the total (PRD: "account for discounts/rounding").
 * Only checks when all three amounts are present and parse as numbers; abstains otherwise.
 */
export function vatArithmeticOk(subtotal: number, vat: number, total: number): boolean {
  const tolerance = Math.max(1, Math.abs(total) * 0.005);
  return Math.abs(subtotal + vat - total) <= tolerance;
}

/** Collect cross-field issues for one document from the current editor state. */
export function documentIssues(state: EditorState, documentId: string): InvoiceIssue[] {
  const issues: InvoiceIssue[] = [];
  const sub = amount(cellValue(state, documentId, "subtotal"));
  const vat = amount(cellValue(state, documentId, "vat_amount"));
  const total = amount(cellValue(state, documentId, "total_amount"));
  if (sub !== null && vat !== null && total !== null && !vatArithmeticOk(sub, vat, total)) {
    issues.push({ code: "vat_mismatch", documentId, fields: ["subtotal", "vat_amount", "total_amount"] });
  } else if (sub !== null && total !== null && vat === null && Math.abs(sub - total) > Math.max(1, Math.abs(total) * 0.005)) {
    // Subtotal and total present but differ and there is no VAT to explain the gap.
    issues.push({ code: "total_not_sum", documentId, fields: ["subtotal", "total_amount"] });
  }
  return issues;
}

/** Duplicate invoice detection: same (seller_tax_id, invoice_number) across documents. */
export function duplicateInvoiceIssues(raw: RawExtraction, state: EditorState): InvoiceIssue[] {
  const seen = new Map<string, string>();
  const dupes: InvoiceIssue[] = [];
  for (const d of raw.documents) {
    const num = cellValue(state, d.id, "invoice_number")?.trim();
    const seller = cellValue(state, d.id, "seller_tax_id")?.trim() ?? "";
    if (!num) continue;
    const key = `${seller}|${num}`;
    if (seen.has(key)) dupes.push({ code: "duplicate_invoice", documentId: d.id, fields: ["invoice_number"] });
    else seen.set(key, d.id);
  }
  return dupes;
}

/** All cross-field issues for the whole batch. */
export function allIssues(raw: RawExtraction, state: EditorState): InvoiceIssue[] {
  const out: InvoiceIssue[] = [];
  for (const d of raw.documents) out.push(...documentIssues(state, d.id));
  out.push(...duplicateInvoiceIssues(raw, state));
  return out;
}

export function issuesByDocument(issues: InvoiceIssue[]): Map<string, InvoiceIssue[]> {
  const m = new Map<string, InvoiceIssue[]>();
  for (const i of issues) (m.get(i.documentId) ?? m.set(i.documentId, []).get(i.documentId)!).push(i);
  return m;
}

/** Cells referenced by an issue, for highlighting in the grid. */
export function issueCells(state: EditorState, issue: InvoiceIssue): Cell[] {
  const out: Cell[] = [];
  for (const f of issue.fields) {
    const col = state.columns.find((c) => c.fieldId === f);
    if (!col) continue;
    const cell = state.cells[cellKey(issue.documentId, col.id)];
    if (cell) out.push(cell);
  }
  return out;
}
