import { describe, expect, it } from "vitest";
import { dictionaries, flattenKeys, translate, DEFAULT_LOCALE, readStoredLocale, LOCALE_STORAGE_KEY } from "@/i18n";
import { FIELD_REGISTRY, FIELD_GROUPS } from "@/domain/fields";

const vi = flattenKeys(dictionaries.vi);
const en = flattenKeys(dictionaries.en);
const vars = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

describe("i18n dictionaries", () => {
  it("vi and en have exactly the same keys", () => {
    expect(Object.keys(vi).sort()).toEqual(Object.keys(en).sort());
  });
  it("no empty or placeholder values", () => {
    for (const d of [vi, en])
      for (const [k, v] of Object.entries(d)) {
        expect(v.trim(), k).not.toBe("");
        expect(v, k).not.toMatch(/TODO|TBD|FIXME|lorem/i);
        expect(v, k).not.toBe(k);
      }
  });
  it("interpolation variables match across locales", () => {
    for (const k of Object.keys(vi)) expect(vars(en[k] ?? ""), k).toEqual(vars(vi[k] ?? ""));
  });
  it("every registry field and group has a label in both locales", () => {
    for (const f of FIELD_REGISTRY) {
      expect(vi[f.labelKey]).toBeTruthy();
      expect(en[f.labelKey]).toBeTruthy();
    }
    for (const g of FIELD_GROUPS) expect(vi[`fieldGroups.${g}`] && en[`fieldGroups.${g}`]).toBeTruthy();
  });
  it("PRD field labels are exact", () => {
    expect(translate("vi", "fields.seller_tax_id")).toBe("MST nhà cung cấp");
    expect(translate("en", "fields.total_amount")).toBe("Total");
  });
});

describe("locale default", () => {
  it("defaults to Vietnamese with nothing stored, even if browser is English", () => {
    window.localStorage.removeItem(LOCALE_STORAGE_KEY);
    expect(DEFAULT_LOCALE).toBe("vi");
    expect(readStoredLocale()).toBe("vi");
  });
  it("respects an explicit stored choice", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    expect(readStoredLocale()).toBe("en");
    window.localStorage.removeItem(LOCALE_STORAGE_KEY);
  });
});
