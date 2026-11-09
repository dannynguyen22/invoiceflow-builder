// Smart Auto-fill and Batch Correction (PRD §06, §07). Pure, deterministic, no AI, no network.
//
// Auto-fill: learn from ONE example cell (see learning.ts: nearby label, relative geometry, section,
// value shape, layout signature, XML path), then for every OTHER document find ITS OWN value. The
// example value is never copied across rows. Documents with no reliable match are reported as
// "review" or "not found", never silently filled.
//
// Batch correction: from one just-corrected (or still-flawed) cell, derive an error signature (same
// field + same flaw + optionally same supplier) and propose each affected cell's own best value.
//
// Protected data: verified cells and manually entered / manually assigned values are NEVER changed by
// default. They can be overridden only when the caller passes an explicit, confirmed override list;
// the engine enforces this itself, independent of UI filtering.
//
// Both operations produce a plan the UI previews; applying a plan emits a single atomic
// CorrectionOperation so the whole batch undoes/redoes in one step.
import type {
  Cell,
  CellChange,
  CellFlag,
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
  reliableCandidate,
  RELIABLE_MARGIN,
  RELIABLE_SCORE,
  type EditorState,
} from "./engine";
import {
  buildLayoutProfile,
  LAYOUT_SIMILAR_MIN,
  layoutSimilarity,
  learnFromExample,
  locateLearned,
  MATCHED_CONFIDENCE,
  sourceRef,
  type Evidence,
  type LayoutProfile,
  type LearnedExample,
  type Reason,
} from "./learning";

export type { Evidence, LearnedExample, Reason, SourceRef } from "./learning";
export { LAYOUT_SIMILAR_MIN } from "./learning";

/** Every source token of a candidate must belong to the target document (ownership invariant, PRD §03). */
function ownedBy(raw: RawExtraction, documentId: string, candidate: FieldCandidate): boolean {
  return candidate.tokenIds.every((id) => {
    const tk = raw.tokens.find((t) => t.id === id);
    return tk != null && tk.documentId === documentId;
  });
}

// ---------------------------------------------------------------- protection

/** Why a cell is protected from automatic changes. */
export type ProtectionReason = "verified" | "manual" | "assigned";

/**
 * Protected cells are never changed by Auto-fill or Batch Correction unless the user explicitly
 * confirms an override (PRD §06/§07: "never overwrite confirmed manual edits"):
 *  - verified / confirmed by the user,
 *  - typed by hand,
 *  - assigned by the user from the source document (dropped OCR region / clicked text).
 */
export function protectionOf(cell: Cell | undefined): ProtectionReason | null {
  if (!cell) return null;
  if (cell.verified || cell.reviewState === "confirmed") return "verified";
  if (cell.provenance === "manual") return "manual";
  if (cell.provenance === "ocr_drop") return "assigned";
  return null;
}

/** An explicit request to change protected cells. Ignored unless `confirmed` is exactly true. */
export interface ProtectedOverride {
  confirmed: boolean;
  documentIds: readonly string[];
}
export interface ApplyOptions {
  overrideProtected?: ProtectedOverride;
}
function overrideSet(opts?: ApplyOptions): Set<string> {
  const o = opts?.overrideProtected;
  return o && o.confirmed === true ? new Set(o.documentIds) : new Set();
}

// ---------------------------------------------------------------- shared proposal logic

/** The supplier identity of a document: cells first, else the reliable extracted seller tax id / name. */
function supplierKey(raw: RawExtraction, state: EditorState, documentId: string): string {
  const fromCell = (field: FieldId) => {
    const col = state.columns.find((c) => c.fieldId === field);
    return col ? (state.cells[cellKey(documentId, col.id)]?.value.trim() ?? "") : "";
  };
  const tax =
    fromCell("seller_tax_id") || reliableCandidate(raw, documentId, "seller_tax_id")?.value;
  if (tax) return `tax:${tax}`;
  const name = (
    fromCell("seller_name") ||
    reliableCandidate(raw, documentId, "seller_name")?.value ||
    ""
  )
    .toLowerCase()
    .trim();
  return name ? `name:${name}` : "";
}

/** Fields whose values are read from the document text and so can be learned. */
export function canLearnField(fieldId: FieldId): boolean {
  return fieldId !== "source_filename" && fieldId !== "review_status";
}

/** Best registry candidate for a document+field, with a reliability classification. */
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

type Proposed =
  | { outcome: "not_found"; candidate: null; evidence: null }
  | { outcome: "matched" | "review"; candidate: FieldCandidate; evidence: Evidence };

/**
 * One document's own proposal: first what the example taught (label / geometry / path), cross-checked
 * with the deterministic registry matcher; the registry alone is the fallback and is only trusted when
 * the user's example agreed with it.
 */
function propose(
  raw: RawExtraction,
  documentId: string,
  fieldId: FieldId,
  learned: LearnedExample | null,
  ctx: { layoutSimilarity: number; supplierMatch: boolean },
): Proposed {
  const registry = bestCandidate(raw, documentId, fieldId);
  let hit =
    learned && (learned.anchors.length || learned.sourcePath || learned.valueBox)
      ? locateLearned(raw, documentId, learned, ctx)
      : null;
  // A position-only guess (no matching label) must not displace a reliable label-based candidate.
  if (
    hit?.evidence.method === "learned_position" &&
    registry.reliable &&
    registry.candidate?.tokenIds.join(",") !== hit.candidate.tokenIds.join(",")
  )
    hit = null;

  if (hit) {
    let confidence = hit.evidence.confidence;
    const reasons: Reason[] = [...hit.evidence.reasons];
    let capped = hit.evidence.method !== "learned_label" && hit.evidence.method !== "learned_path";
    if (registry.candidate) {
      const same = registry.candidate.tokenIds.join(",") === hit.candidate.tokenIds.join(",");
      if (same) {
        confidence = Math.min(1, confidence + 0.1);
        reasons.push({ code: "registry_agrees" });
      } else if (registry.reliable) {
        reasons.push({ code: "registry_differs", params: { value: registry.candidate.value } });
        if (learned?.registryAgrees) capped = true; // the user followed the registry in the example
      }
    }
    confidence = Math.round(confidence * 100) / 100;
    const outcome =
      !capped && hit.evidence.ambiguousWith === 0 && confidence >= MATCHED_CONFIDENCE
        ? "matched"
        : "review";
    return {
      outcome,
      candidate: { ...hit.candidate, score: confidence },
      evidence: { ...hit.evidence, confidence, reasons },
    };
  }

  const c = registry.candidate;
  if (!c) return { outcome: "not_found", candidate: null, evidence: null };
  // Registry fallback. With no learned example (e.g. a flawed reference cell) the registry is the
  // only signal. With one, it is trusted only if the example agreed with it.
  const trusted = !learned || learned.registryAgrees;
  const reasons: Reason[] = [{ code: "registry_only" }];
  if (!trusted)
    reasons.push({
      code: learned.locatedBy === "none" ? "example_unlocated" : "registry_untrusted",
    });
  for (const r of c.reasons) reasons.push({ code: `reg_${r}` });
  return {
    outcome: registry.reliable && trusted ? "matched" : "review",
    candidate: c,
    evidence: {
      method: "registry",
      confidence: Math.min(1, c.score),
      reasons,
      source: sourceRef(raw, documentId, c.tokenIds, c.context ?? ""),
      ambiguousWith: 0,
    },
  };
}

function profiler(raw: RawExtraction) {
  const cache = new Map<string, LayoutProfile>();
  return (id: string) => {
    let p = cache.get(id);
    if (!p) cache.set(id, (p = buildLayoutProfile(raw, id)));
    return p;
  };
}

function learnFrom(
  raw: RawExtraction,
  state: EditorState,
  documentId: string,
  columnId: string,
  fieldId: FieldId,
): LearnedExample {
  const cell = state.cells[cellKey(documentId, columnId)];
  return learnFromExample(raw, {
    documentId,
    fieldId,
    value: cell?.value ?? "",
    sourceTokenIds: cell?.sourceTokenIds ?? [],
  });
}

// ---------------------------------------------------------------- Smart Auto-fill

export type AutoFillScope = "same_supplier" | "similar_layout" | "batch";
export type RowOutcome =
  | "matched"
  | "review"
  | "not_found"
  | "protected"
  | "example"
  /** The cell already holds exactly the value that would be proposed. */
  | "unchanged";

export interface AutoFillProposal {
  documentId: string;
  columnId: string;
  outcome: RowOutcome;
  currentValue: string;
  /** Proposed value + source. For "protected" rows this is what an override would write. */
  candidate: FieldCandidate | null;
  evidence: Evidence | null;
  /** How reliable the proposal is, independent of protection (protected rows keep their own grade). */
  proposedOutcome: "matched" | "review" | "not_found";
  protection: ProtectionReason | null;
  /** 0–1 layout similarity to the example document. */
  layoutSimilarity: number;
  supplierMatch: boolean;
}

export interface AutoFillPlan {
  fieldId: FieldId;
  columnId: string;
  exampleDocumentId: string;
  scope: AutoFillScope;
  learned: LearnedExample;
  proposals: AutoFillProposal[];
  counts: {
    matched: number;
    review: number;
    notFound: number;
    protected: number;
    unchanged: number;
  };
  /** Documents left out by the chosen scope. */
  outOfScope: number;
}

/** A protected row whose override would actually change something. */
export function isOverridable(p: {
  outcome: RowOutcome;
  candidate: FieldCandidate | null;
  currentValue: string;
}) {
  return p.outcome === "protected" && !!p.candidate && p.candidate.value !== p.currentValue;
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
  const learned = learnFrom(raw, state, exampleDocumentId, columnId, fieldId);
  const exampleSupplier = supplierKey(raw, state, exampleDocumentId);
  const profileOf = profiler(raw);
  const proposals: AutoFillProposal[] = [];
  let outOfScope = 0;

  for (const doc of raw.documents) {
    const cell = state.cells[cellKey(doc.id, columnId)];
    if (doc.id === exampleDocumentId) {
      proposals.push({
        documentId: doc.id,
        columnId,
        outcome: "example",
        currentValue: cell?.value ?? "",
        candidate: null,
        evidence: null,
        proposedOutcome: "not_found",
        protection: null,
        layoutSimilarity: 1,
        supplierMatch: true,
      });
      continue;
    }
    const sim = layoutSimilarity(learned.profile, profileOf(doc.id));
    const supplierMatch = !!exampleSupplier && supplierKey(raw, state, doc.id) === exampleSupplier;
    if (scope === "same_supplier" && !supplierMatch) {
      outOfScope++;
      continue;
    }
    if (scope === "similar_layout" && sim < LAYOUT_SIMILAR_MIN) {
      outOfScope++;
      continue;
    }
    const protection = protectionOf(cell);
    const p = canLearnField(fieldId)
      ? propose(raw, doc.id, fieldId, learned, { layoutSimilarity: sim, supplierMatch })
      : ({ outcome: "not_found", candidate: null, evidence: null } as const);
    proposals.push({
      documentId: doc.id,
      columnId,
      outcome: protection
        ? "protected"
        : p.candidate && cell && p.candidate.value === cell.value
          ? "unchanged"
          : p.outcome,
      currentValue: cell?.value ?? "",
      candidate: p.candidate,
      evidence: p.evidence,
      proposedOutcome: p.outcome,
      protection,
      layoutSimilarity: sim,
      supplierMatch,
    });
  }

  const count = (o: RowOutcome) => proposals.filter((p) => p.outcome === o).length;
  return {
    fieldId,
    columnId,
    exampleDocumentId,
    scope,
    learned,
    proposals,
    counts: {
      matched: count("matched"),
      review: count("review"),
      notFound: count("not_found"),
      protected: count("protected"),
      unchanged: count("unchanged"),
    },
    outOfScope,
  };
}

/**
 * Apply selected auto-fill proposals as one atomic operation. Only the given documentIds are filled
 * (the UI lets the user accept a subset). Protected cells are skipped unless the caller passes a
 * confirmed override naming them.
 */
export function applyAutoFill(
  raw: RawExtraction,
  state: EditorState,
  plan: AutoFillPlan,
  acceptDocumentIds: string[],
  opts?: ApplyOptions,
): { state: EditorState; filled: number; overridden: number; skippedProtected: number } {
  const accept = new Set(acceptDocumentIds);
  const overrides = overrideSet(opts);
  const changes: CellChange[] = [];
  let overridden = 0;
  let skippedProtected = 0;
  for (const p of plan.proposals) {
    if (!accept.has(p.documentId) || !p.candidate) continue;
    // Ownership invariant: never apply a candidate whose tokens are not this document's own.
    if (!ownedBy(raw, p.documentId, p.candidate)) continue;
    const before = state.cells[cellKey(p.documentId, p.columnId)];
    if (!before) continue;
    const protectedNow = protectionOf(before) !== null; // judged on the live cell, not the plan snapshot
    if (before.value === p.candidate.value) {
      // Nothing to change; a protected cell with the same value is not "skipped", it is already right.
      if (protectedNow || before.sourceTokenIds.join() === p.candidate.tokenIds.join()) continue;
    }
    if (protectedNow && !overrides.has(p.documentId)) {
      skippedProtected++;
      continue;
    }
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
    if (protectedNow) overridden++;
    changes.push({ documentId: p.documentId, columnId: p.columnId, before, after });
  }
  if (!changes.length) return { state, filled: 0, overridden: 0, skippedProtected };
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
    overridden,
    skippedProtected,
  };
}

// ---------------------------------------------------------------- Batch Correction

export type ErrorSignature = "invalid_format" | "missing" | "field_mismatch";
const SIGNATURE_ORDER: ErrorSignature[] = ["invalid_format", "field_mismatch", "missing"];

function signatureOf(flags: readonly CellFlag[]): ErrorSignature | null {
  return SIGNATURE_ORDER.find((s) => flags.includes(s)) ?? null;
}

/**
 * The error signature to batch-correct from a reference cell:
 *  - "corrected": the user just fixed this cell; the signature is the flaw it had BEFORE the fix, and
 *    the corrected value teaches where the right value lives.
 *  - "flagged": the cell still has the flaw; its signature is the current flaw (no value to learn from).
 */
export function deriveBatchSignature(
  state: EditorState,
  documentId: string,
  columnId: string,
): { signature: ErrorSignature; mode: "corrected" | "flagged" } | null {
  const cell = state.cells[cellKey(documentId, columnId)];
  if (!cell) return null;
  const current = signatureOf(cell.flags);
  if (current) return { signature: current, mode: "flagged" };
  for (let i = state.past.length - 1; i >= 0; i--) {
    const op = state.past[i]!;
    if (op.kind === "verify") continue; // verification never changes the value
    const ch = op.changes.find((c) => c.documentId === documentId && c.columnId === columnId);
    if (!ch) continue;
    const was = ch.before ? signatureOf(ch.before.flags) : null;
    return was && ch.after && !signatureOf(ch.after.flags)
      ? { signature: was, mode: "corrected" }
      : null;
  }
  return null;
}

export interface BatchProposal {
  documentId: string;
  columnId: string;
  fieldId: FieldId;
  before: string;
  after: string;
  candidate: FieldCandidate;
  evidence: Evidence;
  /** "review" proposals are shown but not pre-selected. */
  outcome: "matched" | "review";
  protection: ProtectionReason | null;
  supplierMatch: boolean;
}

export interface BatchPlan {
  fieldId: FieldId;
  signature: ErrorSignature;
  sameSupplier: boolean;
  referenceDocumentId: string;
  /** "corrected": learned from the user's fix. "flagged": registry matcher only. */
  mode: "corrected" | "flagged";
  learned: LearnedExample | null;
  /** Unprotected cells that can be changed. */
  proposals: BatchProposal[];
  /** Protected cells that share the flaw; changed only with a confirmed override. */
  protectedProposals: BatchProposal[];
}

/**
 * From a reference cell, find other cells in the SAME field that share the error signature (same
 * flaw) and, when `sameSupplier`, the same supplier. Propose each cell's own best value. Protected
 * cells are listed separately and never applied without a confirmed override.
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
  const refCell = state.cells[cellKey(referenceDocumentId, columnId)];
  const refSupplier = supplierKey(raw, state, referenceDocumentId);
  const mode: "corrected" | "flagged" =
    refCell && refCell.flags.length === 0 && refCell.value.trim() ? "corrected" : "flagged";
  const learned =
    mode === "corrected" && canLearnField(fieldId)
      ? learnFrom(raw, state, referenceDocumentId, columnId, fieldId)
      : null;
  const profileOf = profiler(raw);
  const proposals: BatchProposal[] = [];
  const protectedProposals: BatchProposal[] = [];

  for (const doc of raw.documents) {
    if (doc.id === referenceDocumentId) continue;
    const cell = state.cells[cellKey(doc.id, columnId)];
    if (!cell || !cell.flags.includes(signature)) continue; // must show the same flaw
    const supplierMatch = !!refSupplier && supplierKey(raw, state, doc.id) === refSupplier;
    if (sameSupplier && !supplierMatch) continue;
    const sim = learned ? layoutSimilarity(learned.profile, profileOf(doc.id)) : 0;
    const p = propose(raw, doc.id, fieldId, learned, { layoutSimilarity: sim, supplierMatch });
    // Only propose a change if there is a different, plausible value to apply.
    if (p.outcome === "not_found" || p.candidate.value === cell.value) continue;
    const protection = protectionOf(cell);
    const proposal: BatchProposal = {
      documentId: doc.id,
      columnId,
      fieldId,
      before: cell.value,
      after: p.candidate.value,
      candidate: p.candidate,
      evidence: p.evidence,
      outcome: p.outcome,
      protection,
      supplierMatch,
    };
    (protection ? protectedProposals : proposals).push(proposal);
  }
  return {
    fieldId,
    signature,
    sameSupplier,
    referenceDocumentId,
    mode,
    learned,
    proposals,
    protectedProposals,
  };
}

export function applyBatchCorrection(
  raw: RawExtraction,
  state: EditorState,
  plan: BatchPlan,
  acceptDocumentIds: string[],
  opts?: ApplyOptions,
): { state: EditorState; corrected: number; overridden: number; skippedProtected: number } {
  const accept = new Set(acceptDocumentIds);
  const overrides = overrideSet(opts);
  const changes: CellChange[] = [];
  let overridden = 0;
  let skippedProtected = 0;
  for (const p of [...plan.proposals, ...plan.protectedProposals]) {
    if (!accept.has(p.documentId)) continue;
    if (!ownedBy(raw, p.documentId, p.candidate)) continue;
    const before = state.cells[cellKey(p.documentId, p.columnId)];
    if (!before) continue;
    const protectedNow = protectionOf(before) !== null;
    if (protectedNow && !overrides.has(p.documentId)) {
      skippedProtected++;
      continue;
    }
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
    if (protectedNow) overridden++;
    changes.push({ documentId: p.documentId, columnId: p.columnId, before, after });
  }
  if (!changes.length) return { state, corrected: 0, overridden: 0, skippedProtected };
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
    overridden,
    skippedProtected,
  };
}
