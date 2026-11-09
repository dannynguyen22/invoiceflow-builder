// Smart Auto-fill learning: label / geometry / section / layout / path signals from ONE example.
// Documents are synthetic positioned rows, as the PDF/OCR pipeline would produce them.
import { describe, expect, it } from "vitest";
import type {
  EditorColumn,
  FieldCandidate,
  InvoiceDocument,
  OCRToken,
  RawExtraction,
} from "@/domain/types";
import { assignToken, createInitialState } from "@/editor/engine";
import {
  buildLayoutProfile,
  LAYOUT_SIMILAR_MIN,
  layoutSimilarity,
  learnFromExample,
  shapeSimilarity,
} from "@/editor/learning";
import { applyAutoFill, planAutoFill } from "@/editor/smart";
import {
  build,
  docOf,
  templateX,
  templateY,
  V,
  withExample,
  INV,
  TAX,
  TOTAL,
} from "./helpers/invoices";
import { parseInvoiceXml } from "@/extraction/xml";

describe("learning from a selected example", () => {
  const raw = build([
    { id: "a", rows: templateX(V(1)) },
    { id: "b", rows: templateX(V(2)) },
    { id: "c", rows: templateX(V(3)) },
  ]);

  it("the registry matcher alone cannot find this label (so learning is what finds it)", () => {
    for (const id of ["b", "c"])
      expect(raw.candidates[id]!.some((c) => c.fieldId === "invoice_number")).toBe(false);
  });

  it("learns the nearby label and relative position, then fills each document's OWN value", () => {
    const state = withExample(raw, [INV], "a", "c-num", "0004561");
    const plan = planAutoFill(raw, state, "a", "c-num", "batch");

    expect(plan.learned.anchors[0]).toMatchObject({ key: "so dinh danh", relation: "same_line" });
    const b = plan.proposals.find((p) => p.documentId === "b")!;
    const c = plan.proposals.find((p) => p.documentId === "c")!;
    expect(b.outcome).toBe("matched");
    expect(b.candidate?.value).toBe("0004562");
    expect(c.candidate?.value).toBe("0004563");
    expect(b.evidence?.method).toBe("learned_label");
    // Meaningful, inspectable reasons and a source reference on the TARGET document.
    expect(b.evidence?.reasons.map((r) => r.code)).toEqual(
      expect.arrayContaining(["label_same", "place_same_line", "shape_same"]),
    );
    expect(b.evidence?.source).toMatchObject({
      documentId: "b",
      page: 1,
      context: "Số định danh: 0004562",
    });
    expect(b.evidence?.source?.tokenIds.every((id) => id.startsWith("b-"))).toBe(true);
  });

  it("applies atomically and every filled value comes from the target's own tokens", () => {
    const state = withExample(raw, [INV], "a", "c-num", "0004561");
    const plan = planAutoFill(raw, state, "a", "c-num", "batch");
    const applied = applyAutoFill(raw, state, plan, ["b", "c"]);
    expect(applied.filled).toBe(2);
    expect(applied.state.past).toHaveLength(state.past.length + 1);
    expect(applied.state.cells["b::c-num"]!.value).toBe("0004562");
    expect(applied.state.cells["b::c-num"]!.sourceTokenIds[0]).toMatch(/^b-/);
  });

  it("never copies the example value when the target lacks the learned label", () => {
    const r2 = build([
      { id: "a", rows: templateX(V(1)) },
      {
        id: "z",
        rows: [
          ["Khác", "hẳn"],
          ["Không", "có", "nhãn", "này"],
        ],
      },
    ]);
    const state = withExample(r2, [INV], "a", "c-num", "0004561");
    const z = planAutoFill(r2, state, "a", "c-num", "batch").proposals.find(
      (p) => p.documentId === "z",
    )!;
    expect(z.outcome).toBe("not_found");
    expect(z.candidate).toBeNull();
  });

  it("uses the seller/buyer section to pick the right 'Mã số thuế' when the label is printed twice", () => {
    const state = withExample(raw, [TAX], "a", "c-tax", "0101234567");
    const plan = planAutoFill(raw, state, "a", "c-tax", "batch");
    const b = plan.proposals.find((p) => p.documentId === "b")!;
    expect(plan.learned.section).toBe("seller");
    expect(b.candidate?.value).toBe("0105556667"); // seller's, not the buyer's 0312345678
    expect(b.evidence?.reasons.map((r) => r.code)).toContain("section_same");
  });

  it("normalizes amounts like the registry (printed 2.500.000 → 2500000)", () => {
    const state = withExample(raw, [TOTAL], "a", "c-total", "1.500.000");
    const plan = planAutoFill(raw, state, "a", "c-total", "batch");
    expect(plan.proposals.find((p) => p.documentId === "b")!.candidate?.value).toBe("2500000");
  });
});

describe("readable labels and no-op rows", () => {
  // Two labelled values on one line, as in real invoices: "Ký hiệu: 1C26TAA Số định danh: 0004561".
  const rows = (num: string) => [
    ["Ký", "hiệu:", "1C26TAA", "Số", "định", "danh:", num],
    ["Ngày", "lập:", "01/10/2026"],
  ];
  const raw = build([
    { id: "a", rows: rows("0004561") },
    { id: "b", rows: rows("0004562") },
  ]);

  it("shows the full unknown label ('Số định danh'), not just its last word", () => {
    const state = withExample(raw, [INV], "a", "c-num", "0004561");
    const plan = planAutoFill(raw, state, "a", "c-num", "batch");
    expect(plan.learned.anchors[0]!.text).toBe("Số định danh");
    const b = plan.proposals.find((p) => p.documentId === "b")!;
    expect(b.outcome).toBe("matched");
    expect(b.evidence?.reasons.find((r) => r.code === "label_same")?.params).toEqual({
      label: "Số định danh",
    });
  });

  it("a row whose cell already holds the proposed value is 'unchanged', not offered", () => {
    let state = withExample(raw, [INV], "a", "c-num", "0004561");
    const first = planAutoFill(raw, state, "a", "c-num", "batch");
    state = applyAutoFill(raw, state, first, ["b"]).state;
    const again = planAutoFill(raw, state, "a", "c-num", "batch");
    expect(again.proposals.find((p) => p.documentId === "b")!.outcome).toBe("unchanged");
    expect(again.counts).toMatchObject({ matched: 0, review: 0, unchanged: 1 });
  });
});

describe("label printed above the value", () => {
  const rows = (num: string) => [["Số", "định", "danh"], [num], ["Ngày", "lập:", "01/10/2026"]];
  const raw = build([
    { id: "a", rows: rows("0004561") },
    { id: "b", rows: rows("0004562") },
  ]);

  it("learns the label above and finds the value under the same label in other documents", () => {
    const state = withExample(raw, [INV], "a", "c-num", "0004561");
    const plan = planAutoFill(raw, state, "a", "c-num", "batch");
    expect(plan.learned.anchors[0]).toMatchObject({ key: "so dinh danh", relation: "below_label" });
    const b = plan.proposals.find((p) => p.documentId === "b")!;
    expect(b.candidate?.value).toBe("0004562");
    expect(b.outcome).toBe("matched");
    expect(b.evidence?.reasons.map((r) => r.code)).toContain("place_below_label");
  });

  it("a value that already has its own label on the line does not also learn the title above it", () => {
    const r2 = build([{ id: "a", rows: templateX(V(1)) }]);
    const st = withExample(r2, [INV], "a", "c-num", "0004561");
    const learned = learnFromExample(r2, {
      documentId: "a",
      fieldId: "invoice_number",
      value: "0004561",
      sourceTokenIds: st.cells["a::c-num"]!.sourceTokenIds,
    });
    expect(learned.anchors.map((a) => a.relation)).toEqual(["same_line"]);
  });
});

describe("layout signatures and 'similar layout' scope", () => {
  const raw = build([
    { id: "a", rows: templateX(V(1)) },
    { id: "b", rows: templateX(V(2, "Sao Mai")) },
    { id: "y", rows: templateY(V(3, "Khác")) }, // same source type (pdf_text), different layout
  ]);

  it("measures real layout, not extraction source type", () => {
    const pa = buildLayoutProfile(raw, "a");
    expect(layoutSimilarity(pa, buildLayoutProfile(raw, "b"))).toBeGreaterThanOrEqual(0.9);
    expect(layoutSimilarity(pa, buildLayoutProfile(raw, "y"))).toBeLessThan(LAYOUT_SIMILAR_MIN);
  });

  it("similar_layout excludes a same-source document that is laid out differently", () => {
    const state = withExample(raw, [INV], "a", "c-num", "0004561");
    const plan = planAutoFill(raw, state, "a", "c-num", "similar_layout");
    const ids = plan.proposals.map((p) => p.documentId);
    expect(ids).toContain("b");
    expect(ids).not.toContain("y");
    expect(plan.outOfScope).toBe(1);
  });

  it("different supplier, same template: still in layout scope but not in supplier scope", () => {
    const state = withExample(raw, [INV], "a", "c-num", "0004561");
    expect(
      planAutoFill(raw, state, "a", "c-num", "same_supplier").proposals.map((p) => p.documentId),
    ).not.toContain("b");
    const b = planAutoFill(raw, state, "a", "c-num", "similar_layout").proposals.find(
      (p) => p.documentId === "b",
    )!;
    expect(b.supplierMatch).toBe(false);
    expect(b.layoutSimilarity).toBeGreaterThanOrEqual(LAYOUT_SIMILAR_MIN);
  });

  it("an OCR scan of the same template is compared by its labels (slightly discounted), XML never matches PDF", () => {
    const withOcr = build([
      { id: "a", rows: templateX(V(1)) },
      { id: "o", rows: templateX(V(2)), source: "ocr" },
    ]);
    const s = layoutSimilarity(buildLayoutProfile(withOcr, "a"), buildLayoutProfile(withOcr, "o"));
    expect(s).toBeGreaterThan(0.85);
    expect(s).toBeLessThan(1);
    const xml = { ...buildLayoutProfile(withOcr, "a"), source: "xml" as const };
    expect(layoutSimilarity(buildLayoutProfile(withOcr, "a"), xml)).toBe(0);
  });
});

describe("weaker evidence is graded for review, not auto-filled", () => {
  it("a garbled label in the same place of a similar layout becomes a 'review' position match", () => {
    const garbled = V(2);
    const rows = templateX(garbled);
    rows[1] = ["Sô", "đinh", "dahn:", garbled.num]; // OCR damage; not close enough to the learned label
    const raw = build([
      { id: "a", rows: templateX(V(1)) },
      { id: "b", rows },
    ]);
    const state = withExample(raw, [INV], "a", "c-num", "0004561");
    const b = planAutoFill(raw, state, "a", "c-num", "batch").proposals.find(
      (p) => p.documentId === "b",
    )!;
    expect(b.candidate?.value).toBe("0004562");
    expect(b.outcome).toBe("review");
    expect(b.evidence?.method).toBe("learned_position");
  });

  it("two equally good label hits are flagged ambiguous and not auto-matched", () => {
    const rows = templateX(V(2));
    rows.push(["Số", "định", "danh:", "0009999"]); // same label printed again (e.g. a reference copy)
    const raw = build([
      { id: "a", rows: templateX(V(1)) },
      { id: "b", rows },
    ]);
    const state = withExample(raw, [INV], "a", "c-num", "0004561");
    const b = planAutoFill(raw, state, "a", "c-num", "batch").proposals.find(
      (p) => p.documentId === "b",
    )!;
    expect(b.outcome).toBe("review");
    expect(b.evidence?.ambiguousWith).toBeGreaterThan(0);
    expect(b.evidence?.reasons.map((r) => r.code)).toContain("ambiguous");
  });

  it("when the user deliberately picked something other than the registry's top candidate, the registry is not trusted for other documents", () => {
    // Example: user took the BUYER tax id for the seller-tax column (different from the registry's pick).
    const raw = build([
      { id: "a", rows: templateX(V(1)) },
      { id: "q", rows: [["Không", "nhãn"], ["0101234567"]] },
    ]);
    const state = withExample(raw, [TAX], "a", "c-tax", "0312345678");
    const learned = learnFromExample(raw, {
      documentId: "a",
      fieldId: "seller_tax_id",
      value: "0312345678",
      sourceTokenIds: state.cells["a::c-tax"]!.sourceTokenIds,
    });
    expect(learned.registryAgrees).toBe(false);
    expect(learned.section).toBe("buyer");
  });
});

describe("typed examples and XML", () => {
  it("a typed value is located in the example document so it can still teach the label", () => {
    const raw = build([
      { id: "a", rows: templateX(V(1)) },
      { id: "b", rows: templateX(V(2)) },
    ]);
    const learned = learnFromExample(raw, {
      documentId: "a",
      fieldId: "invoice_number",
      value: "0004561",
      sourceTokenIds: [],
    });
    expect(learned.locatedBy).toBe("value_lookup");
    expect(learned.anchors[0]?.key).toBe("so dinh danh");
  });

  it("a typed value that is nowhere in the document teaches nothing (no guessing)", () => {
    const raw = build([{ id: "a", rows: templateX(V(1)) }]);
    const learned = learnFromExample(raw, {
      documentId: "a",
      fieldId: "invoice_number",
      value: "ZZZ",
      sourceTokenIds: [],
    });
    expect(learned.locatedBy).toBe("none");
    expect(learned.anchors).toEqual([]);
  });

  it("XML: learns the element path and finds each file's own element", () => {
    const xml = (n: string) =>
      `<HDon><DLHDon><TTChung><SHDon>${n}</SHDon><KHHDon>C26TAA</KHHDon></TTChung><NDHDon><NBan><Ten>A</Ten><MST>0101234567</MST></NBan></NDHDon></DLHDon></HDon>`;
    const parsed = ["x1", "x2"].map((id, i) => parseInvoiceXml(xml(`000${i + 1}`), id));
    const raw: RawExtraction = {
      documents: ["x1", "x2"].map((id) => ({
        ...docOf(id, "xml"),
        mime: "application/xml" as const,
        pageSizes: [{ width: 0, height: 0 }],
      })),
      tokens: parsed.flatMap((p) => p.tokens),
      candidates: { x1: parsed[0]!.candidates, x2: parsed[1]!.candidates },
    };
    const sellerPath = raw.tokens.find((t) => t.documentId === "x1" && t.text === "A")!;
    const cols: EditorColumn[] = [{ id: "c-name", fieldId: "seller_name" }];
    let st = createInitialState(raw, cols);
    const r = assignToken(st, raw, "x1", "c-name", sellerPath.id);
    if (!r.ok) throw new Error(r.error);
    st = r.state;
    const plan = planAutoFill(raw, st, "x1", "c-name", "similar_layout");
    expect(plan.learned.sourcePath).toMatch(/NBan\/Ten$/);
    const x2 = plan.proposals.find((p) => p.documentId === "x2")!;
    expect(x2.evidence?.method).toBe("learned_path");
    expect(x2.evidence?.source?.sourcePath).toMatch(/NBan\/Ten$/);
    expect(x2.layoutSimilarity).toBe(1);
  });
});

describe("shape similarity", () => {
  it("compares character classes, not exact characters", () => {
    expect(shapeSimilarity("0004561", "0004999")).toBe(1);
    expect(shapeSimilarity("1.500.000", "12.500.000")).toBeGreaterThan(0.85);
    expect(shapeSimilarity("0004561", "ABC")).toBeLessThan(0.5);
  });
});
