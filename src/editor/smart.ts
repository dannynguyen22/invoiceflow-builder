// Smart Auto-fill and Batch Correction (PRD §06, §07). Pure, deterministic, no AI, no network.
//
// Auto-fill: learn a rule from ONE example cell (its field + the example document's supplier/layout),
// then for every OTHER document find ITS OWN best candidate for the same field. The example value is
// never copied across rows — each row gets its own extracted value or nothing. Confirmed/manual cells
// are protected. Ambiguous documents (no reliable candidate) are reported as "review", not filled.
//
// Batch correction: from one just-corrected cell, derive an error signature (same field + same flaw +
// optionally same supplier) and find other cells that share it, proposing each one's own best candidate.
//
// Both produce a plan the UI previews; applying a plan emits a single atomic CorrectionOperation so the
// whole batch undoes/redoes in one step.
import type {
  Cell,
  CellChange,
  CorrectionOperation,
  CorrectionScope,
  FieldCandidate,
  FieldId,
  RawExtraction,
} from "@/domain/types";
import {
  cellKey,
  evaluate,
  rankedCandidates,
  RELIABLE_MARGIN,
  RELIABLE_SCORE,
  type EditorState,
} from "./engine";

/** Every source token of a candidate must belong to the target document (ownership invariant, PRD §03). */
function ownedBy(raw: RawExtraction, documentId: string, candidate: FieldCandidate): boolean {
  return candidate.tokenIds.every((id) => {
    const tk = raw.tokens.find((t) => t.id === id);
    return tk != null && tk.documentId === documentId;
  });
}

export type AutoFillScope = "same_supplier" | "similar_layout" | "batch";
export type RowOutcome = "matched" | "review" | "not_found" | "protected" | "example";

export interface AutoFillProposal {
  documentId: string;
  columnId: string;
  outcome: RowOutcome;
  currentValue: string;
  /** Proposed value + source when outcome is "matched"/"review"; null for not_found/protected. */
  candidate: FieldCandidate | null;
  reasonKey: string;
}

export interface AutoFillPlan {
  fieldId: FieldId;
  columnId: string;
  exampleDocumentId: string;
  scope: AutoFillScope;
  proposals: AutoFillProposal[];
  counts: { matched: number; review: number; notFound: number };
}

/** The supplier identity of a document, read from the current cells (seller_tax_id preferred, else name). */
function supplierKey(state: EditorState, documentId: string): string {
  const taxCol = state.columns.find((c) => c.fieldId === "seller_tax_id");
  const tax = taxCol ? state.cells[cellKey(documentId, taxCol.id)]?.value.trim() : "";
  if (tax) return `tax:${tax}`;
  const nameCol = state.columns.find((c) => c.fieldId === "seller_name");
  const name = nameCol
    ? state.cells[cellKey(documentId, nameCol.id)]?.value.trim().toLowerCase()
    : "";
  return name ? `name:${name}` : "";
}

/**
 * A confirmed/verified cell is never touched by any automatic operation.
 * (PRD §06/§07: "never overwrite confirmed manual edits", "exclude protected/confirmed cells".)
 */
function isConfirmed(cell: Cell | undefined): boolean {
  return !!cell && (cell.verified || cell.reviewState === "confirmed");
}

/**
 * Auto-fill additionally leaves deliberate manual entries alone: a user who typed a value should
 * not have it silently replaced by a guessed match.
 */
function isAutoFillProtected(cell: Cell | undefined): boolean {
  return isConfirmed(cell) || (!!cell && cell.provenance === "manual");
}

/** Best candidate for a document+field, with a reliability classification for review bucketing. */
function bestCandidate(
  raw: RawExtraction,
  documentId: string,
  fieldId: FieldId,
): { candidate: FieldCandidate | null; reliable: boolean } {
  const ranked = rankedCandidates(raw, documentId, fieldId);
  const top = ranked[0];
  if (!top) return { candidate: null, reliable: false };
  const second = ranked[1];
  const reliable =
    top.score >= RELIABLE_SCORE && (!second || top.score - second.score >= RELIABLE_MARGIN);
  return { candidate: top, reliable };
}

/**
 * Build an auto-fill plan from an example cell. The example document itself is marked "example"
 * and left unchanged. Each other in-scope document gets its OWN candidate (never the example value).
 */
export function planAutoFill(
  raw: RawExtraction,
  state: EditorState,
  exampleDocumentId: string,
  columnId: string,
  scope: AutoFillScope,
): AutoFillPlan {
  const column = state.columns.find((c) => c.id === columnId);
  const fieldId =
    column?.fieldId ?? (state.cells[cellKey(exampleDocumentId, columnId)]?.fieldId as FieldId);
  const exampleSupplier = supplierKey(state, exampleDocumentId);
  const proposals: AutoFillProposal[] = [];

  for (const doc of raw.documents) {
    const cell = state.cells[cellKey(doc.id, columnId)];
    if (doc.id === exampleDocumentId) {
      proposals.push({
        documentId: doc.id,
        columnId,
        outcome: "example",
        currentValue: cell?.value ?? "",
        candidate: null,
        reasonKey: "autofill.scopeSupplier",
      });
      continue;
    }
    // Scope gate: same supplier only fills documents with a matching supplier identity.
    if (
      scope === "same_supplier" &&
      (!exampleSupplier || supplierKey(state, doc.id) !== exampleSupplier)
    )
      continue;
    // "similar_layout" approximated by same extraction source (xml/pdf_text/ocr) as the example doc.
    if (scope === "similar_layout") {
      const exDoc = raw.documents.find((d) => d.id === exampleDocumentId);
      if (exDoc && doc.source !== exDoc.source) continue;
    }
    if (isAutoFillProtected(cell)) {
      proposals.push({
        documentId: doc.id,
        columnId,
        outcome: "protected",
        currentValue: cell?.value ?? "",
        candidate: null,
        reasonKey: "autofill.protectedNote",
      });
      continue;
    }
    const { candidate, reliable } = bestCandidate(raw, doc.id, fieldId);
    if (!candidate) {
      proposals.push({
        documentId: doc.id,
        columnId,
        outcome: "not_found",
        currentValue: cell?.value ?? "",
        candidate: null,
        reasonKey: "autofill.notFound",
      });
    } else {
      proposals.push({
        documentId: doc.id,
        columnId,
        outcome: reliable ? "matched" : "review",
        currentValue: cell?.value ?? "",
        candidate,
        reasonKey: candidate.reasons[0] ?? "autofill.matched",
      });
    }
  }

  const counts = {
    matched: proposals.filter((p) => p.outcome === "matched").length,
    review: proposals.filter((p) => p.outcome === "review").length,
    notFound: proposals.filter((p) => p.outcome === "not_found").length,
  };
  return { fieldId, columnId, exampleDocumentId, scope, proposals, counts };
}

/**
 * Apply selected auto-fill proposals as one atomic operation. Only the given documentIds are filled
 * (the UI lets the user accept a subset). Protected cells are skipped defensively even if passed in.
 */
export function applyAutoFill(
  raw: RawExtraction,
  state: EditorState,
  plan: AutoFillPlan,
  acceptDocumentIds: string[],
): { state: EditorState; filled: number } {
  const accept = new Set(acceptDocumentIds);
  const changes: CellChange[] = [];
  for (const p of plan.proposals) {
    if (!accept.has(p.documentId) || !p.candidate) continue;
    // Ownership invariant: never apply a candidate whose tokens are not this document's own.
    if (!ownedBy(raw, p.documentId, p.candidate)) continue;
    const k = cellKey(p.documentId, p.columnId);
    const before = state.cells[k];
    if (!before || isAutoFillProtected(before)) continue;
    const after = evaluate(
      {
        ...before,
        value: p.candidate.value,
        sourceTokenIds: p.candidate.tokenIds,
        provenance: "auto_fill",
        fieldId: plan.fieldId,
        verified: false,
      },
      plan.fieldId,
    );
    changes.push({ documentId: p.documentId, columnId: p.columnId, before, after });
  }
  if (!changes.length) return { state, filled: 0 };
  const scope: CorrectionScope = plan.scope;
  const op: CorrectionOperation = {
    id: `op-autofill-${Date.now().toString(36)}`,
    kind: "auto_fill",
    scope,
    changes,
    createdAt: new Date().toISOString(),
  };
  const cells = { ...state.cells };
  for (const ch of changes) cells[cellKey(ch.documentId, ch.columnId)] = ch.after!;
  return {
    state: { ...state, cells, past: [...state.past, op], future: [] },
    filled: changes.length,
  };
}

// ---------------- Batch Correction ----------------

export type ErrorSignature = "invalid_format" | "missing" | "field_mismatch";

export interface BatchProposal {
  documentId: string;
  columnId: string;
  fieldId: FieldId;
  before: string;
  after: string;
  candidate: FieldCandidate | null;
}

export interface BatchPlan {
  fieldId: FieldId;
  signature: ErrorSignature;
  sameSupplier: boolean;
  proposals: BatchProposal[];
}

/**
 * From a reference cell that was just corrected, find other cells in the SAME field that share the
 * error signature (same flaw) and, when `sameSupplier`, the same supplier. Propose each cell's own
 * best candidate as the fix. Confirmed/manual cells are excluded.
 */
export function planBatchCorrection(
  raw: RawExtraction,
  state: EditorState,
  referenceDocumentId: string,
  columnId: string,
  signature: ErrorSignature,
  sameSupplier: boolean,
): BatchPlan {
  const column = state.columns.find((c) => c.id === columnId);
  const fieldId = column!.fieldId;
  const refSupplier = supplierKey(state, referenceDocumentId);
  const proposals: BatchProposal[] = [];

  for (const doc of raw.documents) {
    if (doc.id === referenceDocumentId) continue;
    const cell = state.cells[cellKey(doc.id, columnId)];
    if (!cell || isConfirmed(cell)) continue;
    // Must currently exhibit the same error signature.
    if (!cell.flags.includes(signature)) continue;
    if (sameSupplier && (!refSupplier || supplierKey(state, doc.id) !== refSupplier)) continue;
    const { candidate } = bestCandidate(raw, doc.id, fieldId);
    // Only propose a change if there is a different, plausible value to apply.
    if (!candidate || candidate.value === cell.value) continue;
    proposals.push({
      documentId: doc.id,
      columnId,
      fieldId,
      before: cell.value,
      after: candidate.value,
      candidate,
    });
  }
  return { fieldId, signature, sameSupplier, proposals };
}

export function applyBatchCorrection(
  raw: RawExtraction,
  state: EditorState,
  plan: BatchPlan,
  acceptDocumentIds: string[],
): { state: EditorState; corrected: number } {
  const accept = new Set(acceptDocumentIds);
  const changes: CellChange[] = [];
  for (const p of plan.proposals) {
    if (!accept.has(p.documentId) || !p.candidate) continue;
    if (!ownedBy(raw, p.documentId, p.candidate)) continue;
    const k = cellKey(p.documentId, p.columnId);
    const before = state.cells[k];
    if (!before || isConfirmed(before)) continue;
    const after = evaluate(
      {
        ...before,
        value: p.candidate.value,
        sourceTokenIds: p.candidate.tokenIds,
        provenance: "batch",
        fieldId: plan.fieldId,
        verified: false,
      },
      plan.fieldId,
    );
    changes.push({ documentId: p.documentId, columnId: p.columnId, before, after });
  }
  if (!changes.length) return { state, corrected: 0 };
  const op: CorrectionOperation = {
    id: `op-batch-${Date.now().toString(36)}`,
    kind: "batch_correction",
    scope: plan.sameSupplier ? "same_supplier" : "batch",
    changes,
    createdAt: new Date().toISOString(),
  };
  const cells = { ...state.cells };
  for (const ch of changes) cells[cellKey(ch.documentId, ch.columnId)] = ch.after!;
  return {
    state: { ...state, cells, past: [...state.past, op], future: [] },
    corrected: changes.length,
  };
}
