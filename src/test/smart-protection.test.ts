// Protected data: verified cells and manually entered / assigned values are never changed by
// Auto-fill or Batch Correction unless the caller passes an explicit, confirmed override.
import { describe, expect, it } from "vitest";
import {
  cellKey,
  createInitialState,
  editCell,
  evaluate,
  setVerified,
  undo,
  type EditorState,
} from "@/editor/engine";
import {
  applyAutoFill,
  applyBatchCorrection,
  deriveBatchSignature,
  isOverridable,
  planAutoFill,
  planBatchCorrection,
  protectionOf,
} from "@/editor/smart";
import { build, INV, TAX, templateX, V, withExample } from "./helpers/invoices";

const raw = build([
  { id: "a", rows: templateX(V(1)) },
  { id: "b", rows: templateX(V(2)) },
  { id: "c", rows: templateX(V(3)) },
  { id: "d", rows: templateX(V(4)) },
]);
const K = (doc: string) => cellKey(doc, "c-num");

/** Example in `a` (OCR drop). b = manually typed, c = verified, d = plain extracted-but-wrong. */
function scenario(): EditorState {
  let st = withExample(raw, [INV], "a", "c-num", "0004561");
  st = editCell(st, "b", "c-num", "TYPED-BY-HAND").state;
  st = editCell(st, "c", "c-num", "0004563").state;
  st = setVerified(st, "c", "c-num", true).state;
  const cell = st.cells[K("d")]!;
  return {
    ...st,
    cells: {
      ...st.cells,
      [K("d")]: evaluate({ ...cell, value: "OLD", provenance: "extracted" }, "invoice_number"),
    },
  };
}

describe("protection classification", () => {
  it("manual, verified and OCR-assigned cells are protected; extracted cells are not", () => {
    const st = scenario();
    expect(protectionOf(st.cells[K("a")])).toBe("assigned");
    expect(protectionOf(st.cells[K("b")])).toBe("manual");
    expect(protectionOf(st.cells[K("c")])).toBe("verified");
    expect(protectionOf(st.cells[K("d")])).toBeNull();
  });
});

describe("Auto-fill never touches protected cells by default", () => {
  it("lists protected rows with the value an override WOULD write, but selects nothing for them", () => {
    const plan = planAutoFill(raw, scenario(), "a", "c-num", "batch");
    const by = (id: string) => plan.proposals.find((p) => p.documentId === id)!;
    expect(by("b")).toMatchObject({
      outcome: "protected",
      protection: "manual",
      currentValue: "TYPED-BY-HAND",
    });
    expect(by("b").candidate?.value).toBe("0004562");
    expect(isOverridable(by("b"))).toBe(true);
    expect(by("c")).toMatchObject({ outcome: "protected", protection: "verified" });
    expect(isOverridable(by("c"))).toBe(false); // already equals what would be written
    expect(by("d").outcome).toBe("matched");
    expect(plan.counts.protected).toBe(2);
  });

  it("applying every row without an override changes only the unprotected one", () => {
    const st = scenario();
    const plan = planAutoFill(raw, st, "a", "c-num", "batch");
    const r = applyAutoFill(raw, st, plan, ["b", "c", "d"]);
    expect(r.filled).toBe(1);
    expect(r.skippedProtected).toBe(1); // c is already equal (no-op, not counted as skipped); b is skipped
    expect(r.state.cells[K("b")]!.value).toBe("TYPED-BY-HAND");
    expect(r.state.cells[K("c")]!.verified).toBe(true);
    expect(r.state.cells[K("d")]!.value).toBe("0004564");
  });

  it("an override that is not confirmed is ignored", () => {
    const st = scenario();
    const plan = planAutoFill(raw, st, "a", "c-num", "batch");
    const r = applyAutoFill(raw, st, plan, ["b"], {
      overrideProtected: { confirmed: false, documentIds: ["b"] },
    });
    expect(r.filled).toBe(0);
    expect(r.state.cells[K("b")]!.value).toBe("TYPED-BY-HAND");
  });

  it("a confirmed override changes only the named protected cells, clears verification, and undoes in one step", () => {
    let st = scenario();
    // Make c differ so verified cell becomes overridable too.
    st = editCell(st, "c", "c-num", "9999999").state;
    st = setVerified(st, "c", "c-num", true).state;
    const plan = planAutoFill(raw, st, "a", "c-num", "batch");
    const before = st;
    const r = applyAutoFill(raw, st, plan, ["b", "c", "d"], {
      overrideProtected: { confirmed: true, documentIds: ["c"] },
    });
    expect(r.overridden).toBe(1);
    expect(r.state.cells[K("c")]!.value).toBe("0004563");
    expect(r.state.cells[K("c")]!.verified).toBe(false); // value changed → must be re-verified
    expect(r.state.cells[K("b")]!.value).toBe("TYPED-BY-HAND"); // not named → still protected
    expect(r.state.past.length).toBe(before.past.length + 1);
    expect(undo(r.state).cells).toEqual(before.cells);
  });

  it("protection is judged on the live cell, so a stale plan cannot overwrite a cell verified after planning", () => {
    const st = scenario();
    const plan = planAutoFill(raw, st, "a", "c-num", "batch"); // d is unprotected here
    const verifiedLater = setVerified(
      {
        ...st,
        cells: {
          ...st.cells,
          [K("d")]: evaluate({ ...st.cells[K("d")]!, value: "0004564" }, "invoice_number"),
        },
      },
      "d",
      "c-num",
      true,
    ).state;
    const r = applyAutoFill(raw, verifiedLater, plan, ["d"]);
    expect(r.state.cells[K("d")]!.verified).toBe(true);
    expect(r.filled).toBe(0);
  });
});

describe("Batch Correction protection and signature", () => {
  const cols = [TAX];
  const flawed = (st: EditorState, doc: string, provenance: "extracted" | "manual") => {
    const k = cellKey(doc, "c-tax");
    return {
      ...st,
      cells: {
        ...st.cells,
        [k]: evaluate({ ...st.cells[k]!, value: "BAD", provenance }, "seller_tax_id"),
      },
    };
  };

  it("flawed manual cells are listed separately and left alone unless the override is confirmed", () => {
    let st = createInitialState(raw, cols);
    st = flawed(st, "b", "manual");
    st = flawed(st, "c", "extracted");
    const plan = planBatchCorrection(raw, st, "a", "c-tax", "invalid_format", false);
    expect(plan.proposals.map((p) => p.documentId)).toEqual(["c"]);
    expect(plan.protectedProposals.map((p) => [p.documentId, p.protection])).toEqual([
      ["b", "manual"],
    ]);

    const none = applyBatchCorrection(raw, st, plan, ["b", "c"]);
    expect(none.corrected).toBe(1);
    expect(none.skippedProtected).toBe(1);
    expect(none.state.cells[cellKey("b", "c-tax")]!.value).toBe("BAD");

    const unconfirmed = applyBatchCorrection(raw, st, plan, ["b"], {
      overrideProtected: { confirmed: false, documentIds: ["b"] },
    });
    expect(unconfirmed.corrected).toBe(0);

    const yes = applyBatchCorrection(raw, st, plan, ["b", "c"], {
      overrideProtected: { confirmed: true, documentIds: ["b"] },
    });
    expect(yes.corrected).toBe(2);
    expect(yes.overridden).toBe(1);
    expect(undo(yes.state).cells).toEqual(st.cells);
  });

  it("derives the signature from the flaw a cell had BEFORE the user corrected it", () => {
    let st = createInitialState(raw, cols);
    st = flawed(st, "a", "extracted");
    expect(deriveBatchSignature(st, "a", "c-tax")).toEqual({
      signature: "invalid_format",
      mode: "flagged",
    });
    st = editCell(st, "a", "c-tax", "0101234567").state;
    expect(deriveBatchSignature(st, "a", "c-tax")).toEqual({
      signature: "invalid_format",
      mode: "corrected",
    });
    st = setVerified(st, "a", "c-tax", true).state; // verifying does not hide the correction
    expect(deriveBatchSignature(st, "a", "c-tax")).toEqual({
      signature: "invalid_format",
      mode: "corrected",
    });
    expect(deriveBatchSignature(createInitialState(raw, cols), "a", "c-tax")).toBeNull();
  });

  it("a corrected reference teaches the right place; a still-flawed one falls back to the registry", () => {
    let st = createInitialState(raw, cols);
    st = flawed(st, "b", "extracted");
    const corrected = planBatchCorrection(raw, st, "a", "c-tax", "invalid_format", false);
    expect(corrected.mode).toBe("corrected");
    expect(corrected.learned).not.toBeNull();
    expect(corrected.proposals[0]!.evidence.source?.documentId).toBe("b");

    st = flawed(st, "a", "extracted");
    const flaggedPlan = planBatchCorrection(raw, st, "a", "c-tax", "invalid_format", false);
    expect(flaggedPlan.mode).toBe("flagged");
    expect(flaggedPlan.learned).toBeNull();
  });
});
