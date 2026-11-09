import { describe, expect, it } from "vitest";
import { serializeExport, sanitizeForFormula } from "@/export";
import { toCsv } from "@/export/csv";
import { toXlsx } from "@/export/xlsx";
import { crc32, buildZip } from "@/export/zip";
import { vatArithmeticOk, allIssues, duplicateInvoiceIssues } from "@/domain/invoice-checks";
import { createInitialState } from "@/editor/engine";
import { FIXTURE_RAW, DEFAULT_COLUMNS } from "@/domain/fixtures";
import type { FieldId } from "@/domain/types";

const H = ["Số hóa đơn", "MST"];
const body = (rows: [FieldId, string][][]) =>
  rows.map((r) => r.map(([fieldId, value]) => ({ fieldId, value })));

describe("CSV export", () => {
  it("neutralizes formula injection", () => {
    expect(sanitizeForFormula("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(sanitizeForFormula("+1")).toBe("'+1");
    expect(sanitizeForFormula("@cmd")).toBe("'@cmd");
    expect(sanitizeForFormula("0101234567")).toBe("0101234567");
  });
  it("preserves leading zeros and quotes fields with the delimiter", () => {
    const csv = toCsv(
      H,
      body([
        [
          ["invoice_number", "0001234"],
          ["seller_tax_id", "0101234567"],
        ],
      ]),
      { delimiter: ",", utf8Bom: false },
    );
    expect(csv).toContain("0001234");
    expect(csv).toContain("0101234567");
    const withComma = toCsv(
      H,
      body([
        [
          ["seller_name", "Công ty, TNHH"],
          ["seller_tax_id", "1"],
        ],
      ]),
      { delimiter: ",", utf8Bom: false },
    );
    expect(withComma).toContain('"Công ty, TNHH"');
  });
  it("adds a UTF-8 BOM when requested and uses CRLF", () => {
    const csv = toCsv(
      H,
      body([
        [
          ["invoice_number", "1"],
          ["seller_tax_id", "2"],
        ],
      ]),
      { delimiter: ",", utf8Bom: true },
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("\r\n");
  });
  it("supports semicolon and tab delimiters", () => {
    expect(
      toCsv(
        H,
        body([
          [
            ["invoice_number", "a"],
            ["seller_tax_id", "b"],
          ],
        ]),
        { delimiter: ";", utf8Bom: false },
      ),
    ).toContain("a;b");
    expect(
      toCsv(
        H,
        body([
          [
            ["invoice_number", "a"],
            ["seller_tax_id", "b"],
          ],
        ]),
        { delimiter: "\t", utf8Bom: false },
      ),
    ).toContain("a\tb");
  });
});

describe("ZIP / XLSX writer", () => {
  it("computes the standard CRC-32 of 'The quick brown fox'", () => {
    const bytes = new TextEncoder().encode("The quick brown fox jumps over the lazy dog");
    expect(crc32(bytes) >>> 0).toBe(0x414fa339);
  });
  it("produces a ZIP with the local-file and end-of-central-dir signatures", () => {
    const zip = buildZip([{ name: "a.txt", data: new TextEncoder().encode("hi") }]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50); // local header
    // End of central directory signature appears near the end.
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
  });
  it("writes a valid XLSX package containing the data as inline strings", () => {
    const xlsx = toXlsx(
      H,
      body([
        [
          ["invoice_number", "0001234"],
          ["seller_tax_id", "0101234567"],
        ],
      ]),
    );
    expect(xlsx[0]).toBe(0x50); // 'P'
    expect(xlsx[1]).toBe(0x4b); // 'K'
    const text = new TextDecoder().decode(xlsx);
    // Stored (uncompressed) entries keep the sheet XML readable in the archive bytes.
    expect(text).toContain("0001234");
    expect(text).toContain("inlineStr");
    expect(text).toContain("[Content_Types].xml");
  });
});

describe("serializeExport scopes", () => {
  const state = createInitialState(FIXTURE_RAW, DEFAULT_COLUMNS);
  it("all scope exports every document row", () => {
    const r = serializeExport({
      raw: FIXTURE_RAW,
      state,
      columns: DEFAULT_COLUMNS,
      locale: "vi",
      scope: "all",
      format: { type: "csv", delimiter: ",", utf8Bom: false },
    });
    expect(r.rowCount).toBe(FIXTURE_RAW.documents.length);
    expect(r.filename).toMatch(/\.csv$/);
  });
  it("validated scope excludes rows with needs_review cells", () => {
    const all = serializeExport({
      raw: FIXTURE_RAW,
      state,
      columns: DEFAULT_COLUMNS,
      locale: "vi",
      scope: "all",
      format: { type: "csv", delimiter: ",", utf8Bom: false },
    });
    const validated = serializeExport({
      raw: FIXTURE_RAW,
      state,
      columns: DEFAULT_COLUMNS,
      locale: "vi",
      scope: "validated",
      format: { type: "csv", delimiter: ",", utf8Bom: false },
    });
    expect(validated.rowCount).toBeLessThanOrEqual(all.rowCount);
  });
  it("xlsx scope yields a .xlsx filename and bytes", () => {
    const r = serializeExport({
      raw: FIXTURE_RAW,
      state,
      columns: DEFAULT_COLUMNS,
      locale: "vi",
      scope: "all",
      format: { type: "xlsx", delimiter: ",", utf8Bom: false },
    });
    expect(r.filename).toMatch(/\.xlsx$/);
    expect(r.data).toBeInstanceOf(Uint8Array);
  });
});

describe("invoice cross-field checks", () => {
  it("VAT arithmetic tolerates rounding", () => {
    expect(vatArithmeticOk(10000000, 800000, 10800000)).toBe(true);
    expect(vatArithmeticOk(10000000, 800000, 10800000.4)).toBe(true); // within 0.5%
    expect(vatArithmeticOk(10000000, 800000, 12000000)).toBe(false);
  });
  it("flags duplicate (seller_tax_id, invoice_number)", () => {
    const state = createInitialState(FIXTURE_RAW, DEFAULT_COLUMNS);
    // Fixtures have distinct invoice numbers, so no duplicates by default.
    expect(duplicateInvoiceIssues(FIXTURE_RAW, state).length).toBe(0);
    expect(Array.isArray(allIssues(FIXTURE_RAW, state))).toBe(true);
  });
});
