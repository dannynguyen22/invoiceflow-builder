// Command/transaction layer for the editor (PRD §08). Pure functions, no React.
// Raw extraction (layer A) is read-only input; only columns + cells (layer B) change.
import { isValueCompatible } from "@/domain/validation";
import type {
  Cell,
  CellChange,
  CellFlag,
  CorrectionKind,
  CorrectionOperation,
  CorrectionScope,
  EditorColumn,
  FieldCandidate,
  FieldId,
  OCRToken,
  Provenance,
  RawExtraction,
  ReviewState,
} from "@/domain/types";

export interface EditorState {
  columns: EditorColumn[];
  cells: Record<string, Cell>;
  past: CorrectionOperation[];
  future: CorrectionOperation[];
}

export type EditorError = "cross_document" | "unknown_token" | "unknown_cell" | "duplicate_column" | "verify_needs_review";
export type CommandResult = { ok: true; state: EditorState } | { ok: false; error: EditorError; state: EditorState };

export const cellKey = (documentId: string, columnId: string) => `${documentId}::${columnId}`;

/** Score threshold and margin over the runner-up for a candidate to be filled automatically. */
export const RELIABLE_SCORE = 0.75;
export const RELIABLE_MARGIN = 0.15;

let seq = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${(++seq).toString(36)}`;

// ---------- evaluation ----------

/** Recompute flags + review state of a cell against its column field. */
export function evaluate(cell: Cell, columnField: FieldId): Cell {
  const flags: CellFlag[] = [];
  const value = cell.value.trim();
  if (!value) flags.push("missing");
  else {
    if (!isValueCompatible(columnField, value)) flags.push("invalid_format");
    if (cell.fieldId !== columnField) flags.push("field_mismatch");
  }
  // "Value selected" (provenance) and "value verified" (explicit user check) are separate:
  // only `verified` can produce "confirmed". A flagged cell can never stay verified.
  let reviewState: ReviewState;
  let verified = cell.verified;
  if (flags.length && !(cell.provenance === "manual" && flags.every((f) => f === "missing"))) {
    reviewState = "needs_review";
    verified = false;
  } else if (verified) reviewState = "confirmed";
  else if (cell.provenance === "manual") reviewState = "manual";
  else reviewState = "unreviewed";
  return { ...cell, flags, reviewState, verified };
}

// ---------- raw lookups ----------

export function rankedCandidates(raw: RawExtraction, documentId: string, fieldId: FieldId): FieldCandidate[] {
  return [...(raw.candidates[documentId] ?? [])].filter((c) => c.fieldId === fieldId).sort((a, b) => b.score - a.score);
}

export function reliableCandidate(raw: RawExtraction, documentId: string, fieldId: FieldId): FieldCandidate | null {
  const [top, second] = rankedCandidates(raw, documentId, fieldId);
  if (!top || top.score < RELIABLE_SCORE) return null;
  if (second && top.score - second.score < RELIABLE_MARGIN) return null;
  return top;
}

export function documentTokens(raw: RawExtraction, documentId: string): OCRToken[] {
  return raw.tokens.filter((t) => t.documentId === documentId);
}

function initialCell(raw: RawExtraction, documentId: string, column: EditorColumn): Cell {
  const base = { documentId, columnId: column.id, fieldId: column.fieldId };
  if (column.fieldId === "source_filename") {
    const doc = raw.documents.find((d) => d.id === documentId);
    return evaluate({ ...base, value: doc?.name ?? "", sourceTokenIds: [], provenance: "extracted", reviewState: "unreviewed", flags: [], verified: false }, column.fieldId);
  }
  const c = reliableCandidate(raw, documentId, column.fieldId);
  const provenance: Provenance = c ? "extracted" : "empty";
  return evaluate(
    { ...base, value: c?.value ?? "", sourceTokenIds: c?.tokenIds ?? [], provenance, reviewState: "unreviewed", flags: [], verified: false },
    column.fieldId,
  );
}

export function createInitialState(raw: RawExtraction, columns: EditorColumn[]): EditorState {
  const cells: Record<string, Cell> = {};
  for (const d of raw.documents) for (const c of columns) cells[cellKey(d.id, c.id)] = initialCell(raw, d.id, c);
  return { columns, cells, past: [], future: [] };
}

// ---------- transactions ----------

function applyOp(state: EditorState, op: CorrectionOperation, dir: "after" | "before"): EditorState {
  const cells = { ...state.cells };
  for (const ch of op.changes) {
    const k = cellKey(ch.documentId, ch.columnId);
    const v = ch[dir];
    if (v) cells[k] = v;
    else delete cells[k];
  }
  return { ...state, cells, columns: op.columns ? op.columns[dir] : state.columns };
}

function commit(
  state: EditorState,
  kind: CorrectionKind,
  scope: CorrectionScope,
  changes: CellChange[],
  columns?: { before: EditorColumn[]; after: EditorColumn[] },
): EditorState {
  const op: CorrectionOperation = { id: newId("op"), kind, scope, changes, columns, createdAt: new Date().toISOString() };
  return { ...applyOp(state, op, "after"), past: [...state.past, op], future: [] };
}

export function undo(state: EditorState): EditorState {
  const op = state.past.at(-1);
  if (!op) return state;
  return { ...applyOp(state, op, "before"), past: state.past.slice(0, -1), future: [op, ...state.future] };
}

export function redo(state: EditorState): EditorState {
  const op = state.future[0];
  if (!op) return state;
  return { ...applyOp(state, op, "after"), past: [...state.past, op], future: state.future.slice(1) };
}

const ok = (state: EditorState): CommandResult => ({ ok: true, state });
const fail = (state: EditorState, error: EditorError): CommandResult => ({ ok: false, error, state });

/**
 * Field dropped onto an existing header: REPLACE the column's field interpretation.
 * Every value and source reference is preserved; cells whose own interpretation no
 * longer matches (or whose value doesn't fit the new field) are flagged for review.
 */
export function replaceColumnField(state: EditorState, columnId: string, fieldId: FieldId): CommandResult {
  const col = state.columns.find((c) => c.id === columnId);
  if (!col) return fail(state, "unknown_cell");
  if (col.fieldId === fieldId) return ok(state);
  const after = state.columns.map((c) => (c.id === columnId ? { ...c, fieldId } : c));
  const changes: CellChange[] = [];
  for (const cell of Object.values(state.cells)) {
    if (cell.columnId !== columnId) continue;
    changes.push({ documentId: cell.documentId, columnId, before: cell, after: evaluate({ ...cell, verified: false }, fieldId) });
  }
  return ok(commit(state, "replace_field", "column", changes, { before: state.columns, after }));
}

export const hasColumnForField = (state: EditorState, fieldId: FieldId) => state.columns.some((c) => c.fieldId === fieldId);

/**
 * Field dropped on the Add zone: new column at the end; only reliable matches are filled.
 * A second column for the same field is refused ("duplicate_column") unless the user
 * explicitly asked for it (`allowDuplicate`), so accidental double drops don't clutter exports.
 */
export function addColumn(
  state: EditorState,
  raw: RawExtraction,
  fieldId: FieldId,
  opts: { allowDuplicate?: boolean } = {},
): CommandResult {
  if (!opts.allowDuplicate && hasColumnForField(state, fieldId)) return fail(state, "duplicate_column");
  const column: EditorColumn = { id: newId(`col-${fieldId}`), fieldId };
  const changes: CellChange[] = raw.documents.map((d) => ({
    documentId: d.id,
    columnId: column.id,
    before: null,
    after: initialCell(raw, d.id, column),
  }));
  return ok(commit(state, "add_column", "column", changes, { before: state.columns, after: [...state.columns, column] }));
}

/** Header drag: reorder export columns only — no cell data changes. */
export function moveColumn(state: EditorState, columnId: string, toIndex: number): CommandResult {
  const from = state.columns.findIndex((c) => c.id === columnId);
  if (from < 0) return fail(state, "unknown_cell");
  const idx = Math.max(0, Math.min(state.columns.length - 1, toIndex));
  if (idx === from) return ok(state);
  const after = [...state.columns];
  const [moved] = after.splice(from, 1);
  after.splice(idx, 0, moved!);
  return ok(commit(state, "reorder_columns", "column", [], { before: state.columns, after }));
}

function setCell(
  state: EditorState,
  documentId: string,
  columnId: string,
  patch: Pick<Cell, "value" | "sourceTokenIds" | "provenance">,
): CommandResult {
  const k = cellKey(documentId, columnId);
  const before = state.cells[k];
  const col = state.columns.find((c) => c.id === columnId);
  if (!before || !col) return fail(state, "unknown_cell");
  // Explicit user assignment = per-cell correction: interpretation becomes the column field.
  // A new value is "selected", never "verified": verification must be explicit.
  const after = evaluate({ ...before, ...patch, fieldId: col.fieldId, verified: false }, col.fieldId);
  return ok(commit(state, "set_value", "cell", [{ documentId, columnId, before, after }]));
}

/** OCR region dropped onto a cell: only tokens of the SAME invoice are accepted. */
export function assignToken(state: EditorState, raw: RawExtraction, documentId: string, columnId: string, tokenId: string): CommandResult {
  const token = raw.tokens.find((t) => t.id === tokenId);
  if (!token) return fail(state, "unknown_token");
  if (token.documentId !== documentId) return fail(state, "cross_document");
  return setCell(state, documentId, columnId, { value: token.text, sourceTokenIds: [token.id], provenance: "ocr_drop" });
}

/**
 * Candidate chosen for a cell. Ownership is validated here (not only by UI filtering):
 * every source token must exist and belong to the target invoice.
 */
export function chooseCandidate(
  state: EditorState,
  raw: RawExtraction,
  documentId: string,
  columnId: string,
  candidate: FieldCandidate,
): CommandResult {
  if (!candidate.tokenIds.length) return fail(state, "unknown_token");
  for (const id of candidate.tokenIds) {
    const token = raw.tokens.find((t) => t.id === id);
    if (!token) return fail(state, "unknown_token");
    if (token.documentId !== documentId) return fail(state, "cross_document");
  }
  return setCell(state, documentId, columnId, { value: candidate.value, sourceTokenIds: candidate.tokenIds, provenance: "candidate" });
}

/** Manual edit (double click / F2). Source references are cleared: the value is user-typed. */
export function editCell(state: EditorState, documentId: string, columnId: string, value: string): CommandResult {
  const cur = state.cells[cellKey(documentId, columnId)];
  if (cur && cur.value === value) return ok(state);
  return setCell(state, documentId, columnId, { value, sourceTokenIds: [], provenance: "manual" });
}

/** Explicit verification toggle. Flagged cells must be fixed before they can be verified. */
export function setVerified(state: EditorState, documentId: string, columnId: string, verified: boolean): CommandResult {
  const k = cellKey(documentId, columnId);
  const before = state.cells[k];
  const col = state.columns.find((c) => c.id === columnId);
  if (!before || !col) return fail(state, "unknown_cell");
  if (before.verified === verified) return ok(state);
  if (verified && before.reviewState === "needs_review") return fail(state, "verify_needs_review");
  const after = evaluate({ ...before, verified }, col.fieldId);
  return ok(commit(state, "verify", "cell", [{ documentId, columnId, before, after }]));
}
