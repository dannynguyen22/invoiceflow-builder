// Minimal, dependency-free XLSX writer (PRD §05, §14). Builds a valid OOXML spreadsheet package.
// Every cell is written as an inline string (t="inlineStr"), which means:
//  - leading zeros on tax IDs / invoice numbers are preserved (text, never numeric),
//  - no formula is ever evaluated (inline strings are inert, so XLSX export is injection-proof),
//  - Vietnamese text is UTF-8 safe inside the XML parts.
// Amounts are also written as text to keep exact extracted values; this matches "one CSV row per
// invoice, identifiers as strings" and avoids float rounding. Local-only: no network.
import type { FieldId } from "@/domain/types";
import { buildZip, type ZipEntry } from "./zip";

const utf8 = new TextEncoder();
const enc = (s: string): ZipEntry["data"] => utf8.encode(s);

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Strip control chars that are illegal in XML 1.0 (keep tab/newline/cr).
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

function colLetter(index0: number): string {
  let n = index0 + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellXml(col: number, rowNum: number, value: string): string {
  const ref = `${colLetter(col)}${rowNum}`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function sheetXml(header: string[], body: { fieldId: FieldId; value: string }[][]): string {
  const rows: string[] = [];
  rows.push(`<row r="1">${header.map((h, i) => cellXml(i, 1, h)).join("")}</row>`);
  body.forEach((row, r) => {
    const rowNum = r + 2;
    rows.push(`<row r="${rowNum}">${row.map((c, i) => cellXml(i, rowNum, c.value)).join("")}</row>`);
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join("")}</sheetData></worksheet>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

function workbookXml(sheetName: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
}

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

/** Serialize header + body into a valid .xlsx byte array. `sheetName` max 31 chars (Excel limit). */
export function toXlsx(
  header: string[],
  body: { fieldId: FieldId; value: string }[][],
  sheetName = "Invoices",
): Uint8Array {
  const name = sheetName.slice(0, 31).replace(/[\\/?*[\]:]/g, " ");
  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: enc(CONTENT_TYPES) },
    { name: "_rels/.rels", data: enc(ROOT_RELS) },
    { name: "xl/workbook.xml", data: enc(workbookXml(name)) },
    { name: "xl/_rels/workbook.xml.rels", data: enc(WORKBOOK_RELS) },
    { name: "xl/worksheets/sheet1.xml", data: enc(sheetXml(header, body)) },
  ];
  return buildZip(entries);
}
