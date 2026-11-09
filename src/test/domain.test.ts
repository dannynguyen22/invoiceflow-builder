import { describe, expect, it } from "vitest";
import { FIELD_REGISTRY } from "@/domain/fields";
import { DEFAULT_COLUMNS, FIXTURE_INVOICES, fixtureCell } from "@/domain/fixtures";
import { normalizeForSearch } from "@/lib/text";

describe("field registry", () => {
  it("has the 15 PRD fields with unique stable ids", () => {
    const ids = FIELD_REGISTRY.map((f) => f.id);
    expect(ids).toHaveLength(15);
    expect(new Set(ids).size).toBe(15);
  });
});

describe("fixtures", () => {
  it("keep leading zeros on identifiers", () => {
    const inv = FIXTURE_INVOICES[0]!;
    const col = DEFAULT_COLUMNS.find((c) => c.fieldId === "invoice_number")!;
    expect(fixtureCell(inv, col).value).toBe("0001234");
  });
  it("missing values are blank and flagged, never invented", () => {
    const inv = FIXTURE_INVOICES[2]!;
    const col = DEFAULT_COLUMNS.find((c) => c.fieldId === "invoice_date")!;
    const cell = fixtureCell(inv, col);
    expect(cell.value).toBe("");
    expect(cell.reviewState).toBe("needs_review");
  });
  it("tokens belong to their own document", () => {
    for (const inv of FIXTURE_INVOICES) for (const t of inv.tokens) expect(t.documentId).toBe(inv.document.id);
  });
});

describe("accent-insensitive search", () => {
  it("matches Vietnamese without diacritics", () => {
    expect(normalizeForSearch("Tổng thanh toán")).toBe("tong thanh toan");
    expect(normalizeForSearch("Địa chỉ")).toBe("dia chi");
  });
});
