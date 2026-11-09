import { describe, expect, it } from "vitest";
import { FIELD_REGISTRY } from "@/domain/fields";
import { FIXTURE_RAW } from "@/domain/fixtures";
import { isValueCompatible } from "@/domain/validation";
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
    expect(FIXTURE_RAW.tokens.some((t) => t.text === "0001234")).toBe(true);
  });
  it("tokens and candidates belong to their own document", () => {
    for (const d of FIXTURE_RAW.documents) {
      const ids = new Set(FIXTURE_RAW.tokens.filter((t) => t.documentId === d.id).map((t) => t.id));
      for (const c of FIXTURE_RAW.candidates[d.id] ?? []) for (const tid of c.tokenIds) expect(ids.has(tid)).toBe(true);
    }
  });
});

describe("validation", () => {
  it("tax IDs: 10 digits or 10-3", () => {
    expect(isValueCompatible("seller_tax_id", "0101234567")).toBe(true);
    expect(isValueCompatible("seller_tax_id", "0312345678-001")).toBe(true);
    expect(isValueCompatible("seller_tax_id", "800000")).toBe(false);
  });
  it("dates reject impossible days", () => {
    expect(isValueCompatible("invoice_date", "2026-10-03")).toBe(true);
    expect(isValueCompatible("invoice_date", "03/10/2026")).toBe(true);
    expect(isValueCompatible("invoice_date", "31/02/2026")).toBe(false);
  });
  it("names are not bare numbers", () => {
    expect(isValueCompatible("seller_name", "0101234567")).toBe(false);
  });
});

describe("accent-insensitive search", () => {
  it("matches Vietnamese without diacritics", () => {
    expect(normalizeForSearch("Tổng thanh toán")).toBe("tong thanh toan");
    expect(normalizeForSearch("Địa chỉ")).toBe("dia chi");
  });
});
