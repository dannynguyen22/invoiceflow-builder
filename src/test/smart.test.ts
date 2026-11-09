import { describe, expect, it } from "vitest";
import {
  createInitialState,
  undo,
  redo,
  cellKey,
  editCell,
  setVerified,
  type EditorState,
} from "@/editor/engine";
import {
  planAutoFill,
  applyAutoFill,
  planBatchCorrection,
  applyBatchCorrection,
} from "@/editor/smart";
import type {
  EditorColumn,
  FieldCandidate,
  InvoiceDocument,
  OCRToken,
  RawExtraction,
} from "@/domain/types";

function tok(id: string, documentId: string, text: string): OCRToken {
  return {
    id,
    documentId,
    page: 1,
    text,
    bbox: { x: 0, y: 0, width: 10, height: 10 },
    confidence: 0.95,
  };
}
function cand(
  fieldId: FieldCandidate["fieldId"],
  tokenId: string,
  value: string,
  score: number,
): FieldCandidate {
  return { fieldId, tokenIds: [tokenId], value, score, reasons: ["label_exact"] };
}

// d1 and d2 share a supplier (same tax id) but have their OWN invoice numbers; d3 is a different supplier.
function makeRaw(): RawExtraction {
  const documents: InvoiceDocument[] = ["d1", "d2", "d3"].map((id) => ({
    id,
    name: `${id}.pdf`,
    mime: "application/pdf",
    pages: 1,
    pageSizes: [{ width: 100, height: 100 }],
    source: "pdf_text",
    status: "ready",
  }));
  const tokens: OCRToken[] = [
    tok("d1-tax", "d1", "0101234567"),
    tok("d1-num", "d1", "0001001"),
    tok("d2-tax", "d2", "0101234567"),
    tok("d2-num", "d2", "0001002"),
    tok("d3-tax", "d3", "0300112233"),
    tok("d3-num", "d3", "0007777"),
  ];
  const candidates: Record<string, FieldCandidate[]> = {
    d1: [
      cand("seller_tax_id", "d1-tax", "0101234567", 0.9),
      cand("invoice_number", "d1-num", "0001001", 0.9),
    ],
    d2: [
      cand("seller_tax_id", "d2-tax", "0101234567", 0.9),
      cand("invoice_number", "d2-num", "0001002", 0.9),
    ],
    d3: [
      cand("seller_tax_id", "d3-tax", "0300112233", 0.9),
      cand("invoice_number", "d3-num", "0007777", 0.9),
    ],
  };
  return { documents, tokens, candidates };
}

const COLUMNS: EditorColumn[] = [
  { id: "c-invoice_number", fieldId: "invoice_number" },
  { id: "c-seller_tax_id", fieldId: "seller_tax_id" },
];

function initial(raw: RawExtraction): EditorState {
  return createInitialState(raw, COLUMNS);
}

describe("Smart Auto-fill", () => {
  it("proposes each document's OWN value, never the example value", () => {
    const raw = makeRaw();
    const plan = planAutoFill(raw, initial(raw), "d1", "c-invoice_number", "batch");
    const d2 = plan.proposals.find((p) => p.documentId === "d2");
    const d3 = plan.proposals.find((p) => p.documentId === "d3");
    expect(d2?.candidate?.value).toBe("0001002");
    expect(d3?.candidate?.value).toBe("0007777");
    expect(d2?.candidate?.value).not.toBe("0001001"); // never the example value
  });

  it("same_supplier scope only targets matching suppliers", () => {
    const raw = makeRaw();
    const plan = planAutoFill(raw, initial(raw), "d1", "c-invoice_number", "same_supplier");
    const targeted = plan.proposals.filter((p) => p.outcome !== "example").map((p) => p.documentId);
    expect(targeted).toContain("d2"); // same tax id as d1
    expect(targeted).not.toContain("d3"); // different supplier, filtered out
  });

  it("protects verified cells and applies atomically (one undo)", () => {
    const raw = makeRaw();
    let state = initial(raw);
    state = editCell(state, "d2", "c-invoice_number", "0001002").state;
    state = setVerified(state, "d2", "c-invoice_number", true).state;
    const plan = planAutoFill(raw, state, "d1", "c-invoice_number", "batch");
    expect(plan.proposals.find((p) => p.documentId === "d2")?.outcome).toBe("protected");

    const accept = plan.proposals.filter((p) => p.outcome === "matched").map((p) => p.documentId);
    const before = state;
    const applied = applyAutoFill(state, plan, accept);
    expect(applied.filled).toBeGreaterThan(0);
    expect(applied.state.cells[cellKey("d2", "c-invoice_number")]!.value).toBe("0001002"); // untouched
    const undone = undo(applied.state);
    expect(undone.cells).toEqual(before.cells); // one atomic undo
    const redone = redo(undone);
    expect(redone.cells[cellKey("d3", "c-invoice_number")]!.value).toBe(
      applied.state.cells[cellKey("d3", "c-invoice_number")]!.value,
    );
  });
});

describe("Batch Correction", () => {
  it("finds cells with the same error signature and fixes each with its own value", () => {
    const raw = makeRaw();
    let state = initial(raw);
    // Corrupt d2 and d3 tax ids to an invalid format; they now share the invalid_format signature.
    state = editCell(state, "d2", "c-seller_tax_id", "BAD").state;
    state = editCell(state, "d3", "c-seller_tax_id", "ALSOBAD").state;
    expect(state.cells[cellKey("d2", "c-seller_tax_id")]!.flags).toContain("invalid_format");

    const plan = planBatchCorrection(raw, state, "d1", "c-seller_tax_id", "invalid_format", false);
    const ids = plan.proposals.map((p) => p.documentId).sort();
    expect(ids).toEqual(["d2", "d3"]);
    expect(plan.proposals.find((p) => p.documentId === "d2")?.after).toBe("0101234567");
    expect(plan.proposals.find((p) => p.documentId === "d3")?.after).toBe("0300112233");

    const applied = applyBatchCorrection(state, plan, ids);
    expect(applied.corrected).toBe(2);
    expect(applied.state.cells[cellKey("d2", "c-seller_tax_id")]!.value).toBe("0101234567");
    const undone = undo(applied.state);
    expect(undone.cells[cellKey("d2", "c-seller_tax_id")]!.value).toBe("BAD"); // atomic undo
  });

  it("excludes verified cells from batch correction", () => {
    const raw = makeRaw();
    let state = initial(raw);
    state = editCell(state, "d2", "c-seller_tax_id", "BAD").state;
    // Fix + verify d3 so it is protected from batch correction.
    state = editCell(state, "d3", "c-seller_tax_id", "0300112233").state;
    state = setVerified(state, "d3", "c-seller_tax_id", true).state;
    const plan = planBatchCorrection(raw, state, "d1", "c-seller_tax_id", "invalid_format", false);
    expect(plan.proposals.map((p) => p.documentId)).toEqual(["d2"]);
  });
});
