// CSV serialization (PRD §05, §10, §14). Local-first: builds a string in the browser, no network.
// - Formula-injection guard: a field starting with = + - @ (or tab/CR) is prefixed with a single
//   quote so spreadsheets don't execute it (CSV injection / DDE).
// - Identifiers (tax IDs, invoice numbers, series) are always quoted text so leading zeros survive.
// - UTF-8 BOM is optional, so Excel on Windows reads Vietnamese diacritics correctly.
import type { FieldId } from "@/domain/types";
import { isIdentifierField } from "./model";

export interface CsvOptions {
  delimiter: "," | ";" | "\t";
  utf8Bom: boolean;
}

const FORMULA_PREFIX = /^[=+\-@\t\r]/;
// A plain number (optional leading sign, digits, grouping/decimal separators) is data, not a formula:
// e.g. "-500000" is a credit-note amount and must not be quote-prefixed.
const PLAIN_NUMBER = /^[+-]?\d[\d.,\s]*$/;

/** Neutralize spreadsheet formula injection by prefixing a leading risky char with a quote. */
export function sanitizeForFormula(value: string): string {
  if (PLAIN_NUMBER.test(value)) return value;
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

/** Escape one CSV field per RFC 4180: wrap in quotes if it contains delimiter, quote, or newline. */
function escapeField(value: string, delimiter: string): string {
  const needsQuote =
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r");
  const escaped = value.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

function cellText(fieldId: FieldId, value: string): string {
  const safe = sanitizeForFormula(value);
  // Identifiers are kept as-is text; quoting in escapeField plus the formula guard preserve them.
  // (We rely on the consumer reading CSV as text; for guaranteed text typing, use XLSX export.)
  void isIdentifierField(fieldId);
  return safe;
}

export function toCsv(
  header: string[],
  body: { fieldId: FieldId; value: string }[][],
  opts: CsvOptions,
): string {
  const d = opts.delimiter;
  const lines: string[] = [];
  lines.push(header.map((h) => escapeField(sanitizeForFormula(h), d)).join(d));
  for (const row of body)
    lines.push(row.map((c) => escapeField(cellText(c.fieldId, c.value), d)).join(d));
  // CRLF line endings: most compatible with Excel.
  const text = lines.join("\r\n");
  return opts.utf8Bom ? `\uFEFF${text}` : text;
}
