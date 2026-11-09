import { describe, expect, it } from "vitest";
import { FIXTURE_RAW, DEFAULT_COLUMNS } from "@/domain/fixtures";
import {
  addColumn,
  assignToken,
  cellKey,
  chooseCandidate,
  createInitialState,
  editCell,
  moveColumn,
  rankedCandidates,
  redo,
  replaceColumnField,
  undo,
  type CommandResult,
} from "@/editor/engine";

const raw = FIXTURE_RAW;
const fresh = () => createInitialState(raw, DEFAULT_COLUMNS);
const okState = (r: CommandResult) => {
  expect(r.ok).toBe(true);
  return r.state;
};
const taxCol = "col-seller_tax_id";

describe("header replacement", () => {
  it("keeps every value and source token, changes only the column field", () => {
    const s0 = fresh();
    const s1 = okState(replaceColumnField(s0, taxCol, "buyer_tax_id"));
    expect(s1.columns.find((c) => c.id === taxCol)?.fieldId).toBe("buyer_tax_id");
    for (const d of raw.documents) {
      const a = s0.cells[cellKey(d.id, taxCol)]!;
      const b = s1.cells[cellKey(d.id, taxCol)]!;
      expect(b.value).toBe(a.value);
      expect(b.sourceTokenIds).toEqual(a.sourceTokenIds);
      expect(b.fieldId).toBe(a.fieldId); // per-cell interpretation preserved
    }
  });
  it("flags cells whose interpretation no longer matches", () => {
    const s1 = okState(replaceColumnField(fresh(), taxCol, "buyer_tax_id"));
    const c = s1.cells[cellKey("doc-a", taxCol)]!;
    expect(c.flags).toContain("field_mismatch");
    expect(c.reviewState).toBe("needs_review");
  });
  it("flags type-incompatible values", () => {
    const s1 = okState(replaceColumnField(fresh(), "col-seller_name", "invoice_date"));
    expect(s1.cells[cellKey("doc-a", "col-seller_name")]!.flags).toContain("invalid_format");
  });
  it("undo restores header and cell state", () => {
    const s0 = fresh();
    const s2 = undo(okState(replaceColumnField(s0, taxCol, "buyer_tax_id")));
    expect(s2.columns).toEqual(s0.columns);
    expect(s2.cells).toEqual(s0.cells);
  });
});

describe("add column", () => {
  it("appends at the end, keeps existing data and fills only reliable matches", () => {
    const s0 = fresh();
    const s1 = okState(addColumn(s0, raw, "buyer_tax_id"));
    const col = s1.columns.at(-1)!;
    expect(s1.columns).toHaveLength(s0.columns.length + 1);
    expect(col.fieldId).toBe("buyer_tax_id");
    for (const [k, v] of Object.entries(s0.cells)) expect(s1.cells[k]).toEqual(v);
    expect(s1.cells[cellKey("doc-a", col.id)]!.value).toBe("0309876543");
    expect(s1.cells[cellKey("doc-b", col.id)]!.value).toBe("0312345678");
    // doc-c has no buyer tax id → blank, never invented
    expect(s1.cells[cellKey("doc-c", col.id)]!.value).toBe("");
    expect(undo(s1).columns).toEqual(s0.columns);
  });
  it("leaves ambiguous candidates blank", () => {
    const s0 = fresh();
    expect(s0.cells[cellKey("doc-c", taxCol)]!.value).toBe("");
    expect(s0.cells[cellKey("doc-c", taxCol)]!.reviewState).toBe("needs_review");
  });
});

describe("OCR token drop", () => {
  it("assigns exact text with provenance for the same invoice", () => {
    const tok = raw.tokens.find((t) => t.documentId === "doc-c" && t.text === "0109998887")!;
    const s1 = okState(assignToken(fresh(), raw, "doc-c", taxCol, tok.id));
    const c = s1.cells[cellKey("doc-c", taxCol)]!;
    expect(c.value).toBe("0109998887");
    expect(c.sourceTokenIds).toEqual([tok.id]);
    expect(c.provenance).toBe("ocr_drop");
  });
  it("blocks cross-document mapping", () => {
    const tok = raw.tokens.find((t) => t.documentId === "doc-a")!;
    const s0 = fresh();
    const r = assignToken(s0, raw, "doc-b", taxCol, tok.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("cross_document");
    expect(r.state).toBe(s0);
  });
});

describe("candidates and manual edit", () => {
  it("ranks candidates of the selected invoice only", () => {
    const list = rankedCandidates(raw, "doc-c", "seller_tax_id");
    expect(list.map((c) => c.value)).toEqual(["8012345678", "0109998887"]);
  });
  it("choosing a candidate sets the value but does NOT verify it", () => {
    const cand = rankedCandidates(raw, "doc-c", "seller_tax_id")[0]!;
    const c = okState(chooseCandidate(fresh(), raw, "doc-c", taxCol, cand)).cells[cellKey("doc-c", taxCol)]!;
    expect(c.value).toBe("8012345678");
    expect(c.provenance).toBe("candidate");
    expect(c.verified).toBe(false);
    expect(c.reviewState).toBe("unreviewed");
  });
  it("manual edit keeps leading zeros and reruns validation", () => {
    const s1 = okState(editCell(fresh(), "doc-a", "col-invoice_date", "31/02/2026"));
    const c = s1.cells[cellKey("doc-a", "col-invoice_date")]!;
    expect(c.flags).toContain("invalid_format");
    const s2 = okState(editCell(s1, "doc-a", "col-invoice_number", "0009999"));
    expect(s2.cells[cellKey("doc-a", "col-invoice_number")]!.value).toBe("0009999");
  });
});

describe("reorder + undo/redo", () => {
  it("reorders columns without touching cells, and redo reapplies", () => {
    const s0 = fresh();
    const s1 = okState(moveColumn(s0, "col-total_amount", 0));
    expect(s1.columns[0]!.id).toBe("col-total_amount");
    expect(s1.cells).toEqual(s0.cells);
    const s2 = undo(s1);
    expect(s2.columns).toEqual(s0.columns);
    expect(redo(s2).columns[0]!.id).toBe("col-total_amount");
  });
  it("new command clears redo stack", () => {
    const s1 = undo(okState(moveColumn(fresh(), "col-total_amount", 0)));
    expect(s1.future).toHaveLength(1);
    expect(okState(editCell(s1, "doc-a", "col-seller_name", "X Co")).future).toHaveLength(0);
  });
  it("raw extraction is never mutated", () => {
    const snapshot = JSON.stringify(raw);
    let s = fresh();
    s = okState(replaceColumnField(s, taxCol, "buyer_tax_id"));
    s = okState(editCell(s, "doc-a", taxCol, "123"));
    s = okState(addColumn(s, raw, "vat_amount"));
    expect(JSON.stringify(raw)).toBe(snapshot);
  });
});
