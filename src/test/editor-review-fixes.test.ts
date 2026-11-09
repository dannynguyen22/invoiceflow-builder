// Regression tests for the Phase 1 review fixes.
import { describe, expect, it } from "vitest";
import { DEFAULT_COLUMNS, FIXTURE_RAW } from "@/domain/fixtures";
import type { FieldCandidate } from "@/domain/types";
import {
  addColumn,
  assignToken,
  cellKey,
  chooseCandidate,
  createInitialState,
  editCell,
  rankedCandidates,
  replaceColumnField,
  setVerified,
  undo,
  type CommandResult,
} from "@/editor/engine";
import { clampPage, clampZoom, MAX_ZOOM, MIN_ZOOM, pageForHighlight, pagesWithHighlights, wheelZoom } from "@/editor/preview";

const raw = FIXTURE_RAW;
const fresh = () => createInitialState(raw, DEFAULT_COLUMNS);
const okState = (r: CommandResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.state;
};
const taxCol = "col-seller_tax_id";

describe("chooseCandidate validates token ownership", () => {
  it("rejects a candidate whose tokens belong to another invoice", () => {
    const foreign = rankedCandidates(raw, "doc-a", "seller_tax_id")[0]!;
    const s0 = fresh();
    const r = chooseCandidate(s0, raw, "doc-c", taxCol, foreign);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("cross_document");
    expect(r.state).toBe(s0);
  });
  it("rejects a candidate mixing own and foreign tokens", () => {
    const own = rankedCandidates(raw, "doc-c", "seller_tax_id")[0]!;
    const foreignTok = raw.tokens.find((t) => t.documentId === "doc-a")!;
    const mixed: FieldCandidate = { ...own, tokenIds: [...own.tokenIds, foreignTok.id] };
    const r = chooseCandidate(fresh(), raw, "doc-c", taxCol, mixed);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("cross_document");
  });
  it("rejects candidates with unknown or no tokens", () => {
    const own = rankedCandidates(raw, "doc-c", "seller_tax_id")[0]!;
    const a = chooseCandidate(fresh(), raw, "doc-c", taxCol, { ...own, tokenIds: ["nope"] });
    const b = chooseCandidate(fresh(), raw, "doc-c", taxCol, { ...own, tokenIds: [] });
    expect(a.ok || b.ok).toBe(false);
    if (!a.ok) expect(a.error).toBe("unknown_token");
  });
});

describe("selected vs verified", () => {
  it("OCR drop and manual edit select a value without verifying it", () => {
    const tok = raw.tokens.find((t) => t.documentId === "doc-c" && t.text === "0109998887")!;
    const s1 = okState(assignToken(fresh(), raw, "doc-c", taxCol, tok.id));
    expect(s1.cells[cellKey("doc-c", taxCol)]!.reviewState).toBe("unreviewed");
    const s2 = okState(editCell(s1, "doc-a", "col-seller_name", "Công ty X"));
    expect(s2.cells[cellKey("doc-a", "col-seller_name")]!).toMatchObject({ reviewState: "manual", verified: false });
  });
  it("explicit verify confirms; undo restores the unverified state", () => {
    const k = cellKey("doc-a", "col-invoice_number");
    const s1 = okState(setVerified(fresh(), "doc-a", "col-invoice_number", true));
    expect(s1.cells[k]).toMatchObject({ verified: true, reviewState: "confirmed" });
    const s0 = undo(s1);
    expect(s0.cells[k]).toMatchObject({ verified: false, reviewState: "unreviewed" });
  });
  it("changing a verified value clears verification", () => {
    const s1 = okState(setVerified(fresh(), "doc-a", "col-invoice_number", true));
    const s2 = okState(editCell(s1, "doc-a", "col-invoice_number", "0001235"));
    expect(s2.cells[cellKey("doc-a", "col-invoice_number")]!).toMatchObject({ verified: false, reviewState: "manual" });
  });
  it("header replacement clears verification", () => {
    const s1 = okState(setVerified(fresh(), "doc-a", taxCol, true));
    const s2 = okState(replaceColumnField(s1, taxCol, "invoice_number"));
    expect(s2.cells[cellKey("doc-a", taxCol)]!.verified).toBe(false);
  });
  it("cells needing review cannot be verified", () => {
    const s0 = fresh();
    expect(s0.cells[cellKey("doc-c", taxCol)]!.reviewState).toBe("needs_review");
    const r = setVerified(s0, "doc-c", taxCol, true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("verify_needs_review");
  });
});

describe("duplicate columns", () => {
  it("refuses an accidental duplicate field column", () => {
    const s0 = fresh();
    const r = addColumn(s0, raw, "seller_tax_id");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("duplicate_column");
    expect(r.state.columns).toHaveLength(s0.columns.length);
  });
  it("allows a duplicate when explicitly requested, with its own column id", () => {
    const s1 = okState(addColumn(fresh(), raw, "seller_tax_id", { allowDuplicate: true }));
    const cols = s1.columns.filter((c) => c.fieldId === "seller_tax_id");
    expect(cols).toHaveLength(2);
    expect(cols[0]!.id).not.toBe(cols[1]!.id);
    expect(undo(s1).columns.filter((c) => c.fieldId === "seller_tax_id")).toHaveLength(1);
  });
});

describe("multi-page preview logic", () => {
  const docB = raw.documents.find((d) => d.id === "doc-b")!;
  const tokensB = raw.tokens.filter((t) => t.documentId === "doc-b");
  it("fixture doc-b spans two pages with tokens on each", () => {
    expect(docB.pages).toBe(2);
    expect(docB.pageSizes).toHaveLength(2);
    expect(new Set(tokensB.map((t) => t.page))).toEqual(new Set([1, 2]));
  });
  it("jumps to the page holding the selected cell's source tokens", () => {
    const s = fresh();
    const total = s.cells[cellKey("doc-b", "col-total_amount")]!;
    const hl = new Set(total.sourceTokenIds);
    expect(pagesWithHighlights(tokensB, hl)).toEqual([2]);
    expect(pageForHighlight(tokensB, hl, 1)).toBe(2);
    const num = new Set(s.cells[cellKey("doc-b", "col-invoice_number")]!.sourceTokenIds);
    expect(pageForHighlight(tokensB, num, 2)).toBe(1);
    expect(pageForHighlight(tokensB, new Set(), 2)).toBe(2);
  });
  it("clamps pages and zoom", () => {
    expect(clampPage(0, 2)).toBe(1);
    expect(clampPage(5, 2)).toBe(2);
    expect(clampZoom(10)).toBe(MAX_ZOOM);
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(wheelZoom(1, -100, 0)).toBeGreaterThan(1);
    expect(wheelZoom(1, 3, 1)).toBeLessThan(1);
  });
});
