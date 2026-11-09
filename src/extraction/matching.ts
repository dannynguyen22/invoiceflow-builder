// Deterministic field matching for PDF text / OCR tokens (no AI, no network).
// Pipeline: tokens → reading lines → label/value segments → exact/fuzzy label match →
// section (seller vs buyer) → format-checked value extraction → spatial fallback
// (value on the line below) → shape-only alternatives → ranked, de-duplicated candidates.
// Values are always built from the document's own tokens; nothing is invented.
import type { FieldCandidate, FieldId, OCRToken } from "@/domain/types";
import { normalizeForSearch } from "@/lib/text";

// ---------- lines ----------

export interface Line {
  page: number;
  tokens: OCRToken[];
  y: number;
  height: number;
  text: string;
}

/** Group positioned tokens into reading lines (same page, overlapping vertical centre). */
export function buildLines(tokens: readonly OCRToken[]): Line[] {
  const byPage = new Map<number, OCRToken[]>();
  for (const t of tokens) if (t.bbox) (byPage.get(t.page) ?? byPage.set(t.page, []).get(t.page)!).push(t);
  const lines: Line[] = [];
  for (const [page, list] of [...byPage].sort((a, b) => a[0] - b[0])) {
    const sorted = [...list].sort((a, b) => a.bbox!.y + a.bbox!.height / 2 - (b.bbox!.y + b.bbox!.height / 2));
    const pageLines: { tokens: OCRToken[]; yc: number; h: number }[] = [];
    for (const t of sorted) {
      const yc = t.bbox!.y + t.bbox!.height / 2;
      const line = pageLines.find((l) => Math.abs(l.yc - yc) < Math.min(l.h, t.bbox!.height) * 0.5);
      if (line) {
        line.tokens.push(t);
        line.yc = (line.yc * (line.tokens.length - 1) + yc) / line.tokens.length;
        line.h = Math.max(line.h, t.bbox!.height);
      } else pageLines.push({ tokens: [t], yc, h: t.bbox!.height });
    }
    for (const l of pageLines.sort((a, b) => a.yc - b.yc)) {
      const toks = l.tokens.sort((a, b) => a.bbox!.x - b.bbox!.x);
      lines.push({ page, tokens: toks, y: l.yc, height: l.h, text: toks.map((t) => t.text).join(" ") });
    }
  }
  return lines;
}

// ---------- labels ----------

type Role = FieldId | "tax_id" | "name" | "address" | "ignore";
type Section = "seller" | "buyer" | null;

/** Normalised (lowercase, no diacritics) label phrases. Generic roles resolve by section. */
const LABELS: [Role, string[], Section?][] = [
  ["invoice_number", ["so hoa don", "so hd", "so", "invoice no", "invoice number", "invoice no.", "no"]],
  ["invoice_date", ["ngay lap", "ngay hoa don", "ngay", "ngay lap hoa don", "date", "invoice date", "date of issue"]],
  ["invoice_series", ["ky hieu", "ky hieu hoa don", "serial", "serial no", "series", "symbol"]],
  ["seller_name", ["don vi ban hang", "don vi ban", "nguoi ban", "ten nguoi ban", "ten don vi ban hang", "ben ban", "seller", "seller name", "cong ty ban"], "seller"],
  ["buyer_name", ["don vi mua hang", "don vi mua", "nguoi mua hang", "ho ten nguoi mua hang", "ten nguoi mua", "ten don vi mua", "ben mua", "buyer", "buyer name", "customer", "khach hang"], "buyer"],
  ["seller_tax_id", ["mst nguoi ban", "ma so thue nguoi ban", "seller tax code"], "seller"],
  ["buyer_tax_id", ["mst nguoi mua", "ma so thue nguoi mua", "buyer tax code", "mst khach hang"], "buyer"],
  ["tax_id", ["ma so thue", "mst", "tax code", "tax id", "ma so doanh nghiep"]],
  ["name", ["ten don vi", "ten cong ty", "ten", "company name", "company"]],
  ["address", ["dia chi", "address"]],
  ["subtotal", ["cong tien hang", "tong tien hang", "tien hang", "thanh tien truoc thue", "tong tien truoc thue", "cong tien hang hoa dich vu", "sub total", "subtotal", "total before tax", "amount before tax"]],
  ["vat_amount", ["tien thue gtgt", "tien thue", "thue gtgt", "tong tien thue", "tong tien thue gtgt", "vat", "vat amount", "tax amount"]],
  ["total_amount", ["tong cong thanh toan", "tong tien thanh toan", "tong thanh toan", "tong cong", "tong cong tien thanh toan", "total", "total amount", "grand total", "total payment"]],
  ["currency", ["loai tien", "don vi tien te", "currency", "dvtt", "tien te"]],
  // Rates look like VAT labels but carry percentages, not amounts.
  ["ignore", ["thue suat", "thue suat gtgt", "vat rate", "tax rate", "so tai khoan", "dien thoai", "account no", "phone", "tel", "fax", "email", "website", "hinh thuc thanh toan", "payment method"]],
];

const norm = (s: string) =>
  normalizeForSearch(s)
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Levenshtein similarity in [0,1]. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[b.length]! / Math.max(a.length, b.length);
}

export interface LabelHit {
  role: Role;
  score: number;
  section?: Section;
  phrase: string;
}

/** Best label for a label segment: exact (1.0), suffix/prefix match (0.9), fuzzy ≥ 0.8. */
export function matchLabel(segment: string): LabelHit | null {
  const s = norm(segment);
  if (!s) return null;
  let best: LabelHit | null = null;
  for (const [role, phrases, section] of LABELS)
    for (const p of phrases) {
      let score = 0;
      if (s === p) score = 1;
      else if (p.length >= 4 && (s.endsWith(` ${p}`) || s.startsWith(`${p} `))) score = 0.9;
      else if (p.length >= 5) {
        const sim = similarity(s, p);
        if (sim >= 0.8) score = sim * 0.95;
      }
      // Longer phrases win ties ("ma so thue nguoi mua" over "ma so thue").
      if (score && (!best || score > best.score || (score === best.score && p.length > best.phrase.length)))
        best = { role, score, phrase: p, ...(section !== undefined ? { section } : {}) };
    }
  return best;
}

// ---------- value extraction ----------

type Extract = { tokens: OCRToken[]; value: string } | null;

const TAX_RE = /\d{10}(?:-\d{3})?/;
const DATE_RES = [/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/, /^(\d{4})-(\d{2})-(\d{2})$/];

/** Find a run of tokens whose concatenation (spaces removed) contains `re`; returns covering tokens. */
function findRun(tokens: OCRToken[], re: RegExp): { tokens: OCRToken[]; match: string } | null {
  for (let i = 0; i < tokens.length; i++) {
    let joined = "";
    for (let j = i; j < Math.min(tokens.length, i + 4); j++) {
      joined += tokens[j]!.text;
      const m = joined.match(new RegExp(`^${re.source}`));
      if (m && m[0].length === joined.replace(/[.,;:)]+$/, "").length) return { tokens: tokens.slice(i, j + 1), match: m[0] };
    }
  }
  return null;
}

export function normalizeAmount(text: string): string | null {
  const s = text.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(s)) return null;
  if (/^-?\d{1,3}([.,]\d{3})+$/.test(s)) return s.replace(/[.,]/g, "");
  if (/^-?\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) return s.replace(/\./g, "").replace(",", ".");
  if (/^-?\d{1,3}(,\d{3})+\.\d{1,2}$/.test(s)) return s.replace(/,/g, "");
  if (/^-?\d+$/.test(s)) return s;
  if (/^-?\d+[.,]\d{1,2}$/.test(s)) return s.replace(",", ".");
  return null;
}

function extractValue(field: FieldId, tokens: OCRToken[]): Extract {
  if (!tokens.length) return null;
  switch (field) {
    case "seller_tax_id":
    case "buyer_tax_id": {
      const r = findRun(tokens, TAX_RE);
      return r ? { tokens: r.tokens, value: r.match } : null;
    }
    case "invoice_date": {
      for (const t of tokens) {
        const s = t.text.replace(/[,;)]+$/, "");
        for (const re of DATE_RES) if (re.test(s)) return { tokens: [t], value: s.replace(/[.-](?=\d{1,2}[.-]|\d{4}$)/g, "/").replace(/^(\d{4})\/(\d{2})\/(\d{2})$/, "$1-$2-$3") };
      }
      return null;
    }
    case "subtotal":
    case "vat_amount":
    case "total_amount": {
      for (let i = 0; i < tokens.length; i++) {
        if (/%$/.test(tokens[i]!.text)) continue;
        // Amounts can be split by OCR ("5.500" "000"): try up to 3 adjacent tokens.
        for (let j = Math.min(tokens.length, i + 3); j > i; j--) {
          const run = tokens.slice(i, j);
          const v = normalizeAmount(run.map((t) => t.text).join(""));
          if (v && run.every((t) => /^[\d.,-]+$/.test(t.text.replace(/(đ|vnd|vnđ)$/i, "")))) return { tokens: run, value: v };
        }
      }
      return null;
    }
    case "invoice_number": {
      const t = tokens.find((x) => /^\d{1,10}$/.test(x.text.replace(/[,;.]$/, "")));
      return t ? { tokens: [t], value: t.text.replace(/[,;.]$/, "") } : null;
    }
    case "invoice_series": {
      const t = tokens.find((x) => /^[0-9]?[A-Z]\d{2}[A-Z]{1,3}$/.test(x.text.replace(/[,;.]$/, "")));
      return t ? { tokens: [t], value: t.text.replace(/[,;.]$/, "") } : null;
    }
    case "currency": {
      for (const t of tokens) {
        const n = normalizeForSearch(t.text).toUpperCase().replace(/[^A-Z]/g, "");
        if (n === "VND" || n === "DONG" || n === "VNDONG") return { tokens: [t], value: "VND" };
        if (/^(USD|EUR|JPY|CNY|KRW|SGD|THB|GBP|AUD)$/.test(n)) return { tokens: [t], value: n };
      }
      return null;
    }
    default: {
      // Text fields: the whole segment; a bare number is not a name/address.
      const value = tokens.map((t) => t.text).join(" ").trim();
      if (!value || /^[\d.,\s-]+$/.test(value)) return null;
      return { tokens, value };
    }
  }
}

function resolveRole(role: Role, section: Section): FieldId | null {
  if (role === "ignore") return null;
  if (role === "tax_id") return section === "buyer" ? "buyer_tax_id" : "seller_tax_id";
  if (role === "name") return section === "buyer" ? "buyer_name" : section === "seller" ? "seller_name" : null;
  if (role === "address") return section === "buyer" ? null : "seller_address";
  return role;
}

// ---------- segments ----------

interface Segment {
  label: OCRToken[];
  value: OCRToken[];
}

/** Split a line into label/value segments at tokens containing ":". */
function segments(line: Line): Segment[] {
  const out: Segment[] = [];
  let label: OCRToken[] = [];
  let cur: Segment | null = null;
  for (const t of line.tokens) {
    const ci = t.text.indexOf(":");
    if (ci >= 0) {
      // "Số:" / "MST:0101…" — label ends here; text after ':' within the token stays as value text.
      const before = t.text.slice(0, ci);
      // Labels are short; if a previous segment's value is followed by more words, those words
      // (up to 5) are the next label: "Ký hiệu: 1C26TAA Số: 0004567".
      if (cur) {
        // Pick the tail length whose words form the best label (ties → shorter tail).
        let bestN = 0;
        let bestScore = 0;
        for (let n = 1; n <= Math.min(5, cur.value.length); n++) {
          const tail = cur.value.slice(-n);
          if (tail.some((x) => /\d/.test(x.text))) break;
          const h = matchLabel([...tail.map((x) => x.text), before].join(" "));
          if (h && h.score > bestScore) {
            bestScore = h.score;
            bestN = n;
          }
        }
        if (!bestN && !before && cur.value.length) bestN = 1;
        label = bestN ? cur.value.splice(cur.value.length - bestN, bestN) : [];
      }
      const after = t.text.slice(ci + 1).trim();
      const lab = before ? [...label, { ...t, text: before }] : label;
      cur = { label: lab, value: after ? [{ ...t, text: after }] : [] };
      out.push(cur);
      label = [];
    } else if (cur) cur.value.push(t);
    else label.push(t);
  }
  if (!out.length && label.length) out.push({ label, value: [] }); // label-only or prefix-label line
  return out;
}

// ---------- main ----------

const BASE = { label: 0.55, format: 0.3, sameLine: 0.1, conf: 0.05 };
export const SHAPE_ONLY_SCORE = 0.35;

/** Rank candidates for every field from one document's tokens. */
export function matchFields(tokens: readonly OCRToken[]): FieldCandidate[] {
  const lines = buildLines(tokens);
  const out = new Map<string, FieldCandidate>();
  const add = (c: FieldCandidate) => {
    const k = `${c.fieldId}|${c.tokenIds.join(",")}`;
    const prev = out.get(k);
    if (!prev || prev.score < c.score) out.set(k, c);
  };
  const avgConf = (ts: OCRToken[]) => ts.reduce((s, t) => s + t.confidence, 0) / ts.length;

  let section: Section = null;
  lines.forEach((line, li) => {
    const lineNorm = norm(line.text);
    // Section headings without a colon ("NGƯỜI MUA", "Bên bán").
    if (/\b(nguoi mua|ben mua|don vi mua|buyer|khach hang)\b/.test(lineNorm)) section = "buyer";
    else if (/\b(nguoi ban|ben ban|don vi ban|seller)\b/.test(lineNorm)) section = "seller";

    // "Ngày 05 tháng 10 năm 2026" has no colon: match by pattern on the token sequence.
    const words = line.tokens.map((t) => norm(t.text));
    for (let i = 0; i + 5 < words.length; i++) {
      if (words[i] === "ngay" && words[i + 2] === "thang" && words[i + 4] === "nam" && /^\d{1,2}$/.test(words[i + 1]!) && /^\d{1,2}$/.test(words[i + 3]!) && /^\d{4}$/.test(words[i + 5]!)) {
        const toks = [line.tokens[i + 1]!, line.tokens[i + 3]!, line.tokens[i + 5]!];
        add({ fieldId: "invoice_date", tokenIds: toks.map((t) => t.id), value: `${words[i + 1]!.padStart(2, "0")}/${words[i + 3]!.padStart(2, "0")}/${words[i + 5]}`, score: 0.9, reasons: ["date_phrase"], context: line.text });
      }
    }

    for (const seg of segments(line)) {
      let labelTokens = seg.label;
      let hit = matchLabel(labelTokens.map((t) => t.text).join(" "));
      let value = seg.value;
      // No colon: try the longest label prefix of the line.
      if (!hit && !seg.value.length) {
        for (let n = Math.min(6, labelTokens.length - 1); n >= 1; n--) {
          const h = matchLabel(labelTokens.slice(0, n).map((t) => t.text).join(" "));
          if (h && h.score >= 0.9) {
            hit = h;
            value = labelTokens.slice(n);
            labelTokens = labelTokens.slice(0, n);
            break;
          }
        }
      }
      if (!hit) continue;
      // The buyer's contact person is not the buyer entity: rank below "Tên đơn vị".
      if (hit.phrase.startsWith("ho ten")) hit = { ...hit, score: hit.score * 0.7 };
      if (hit.section) section = hit.section;
      const field = resolveRole(hit.role, hit.section ?? section);
      if (!field) continue;

      let ex = extractValue(field, value);
      let sameLine = true;
      // Spatial fallback: value on the next line, horizontally overlapping the label's right side.
      if (!ex && !value.length) {
        const next = lines[li + 1];
        const lab = labelTokens.at(-1)?.bbox;
        if (next && next.page === line.page && lab && next.y - line.y < line.height * 2.5 && !segments(next).some((s) => matchLabel(s.label.map((t) => t.text).join(" ")))) {
          ex = extractValue(field, next.tokens.filter((t) => t.bbox!.x + t.bbox!.width >= labelTokens[0]!.bbox!.x));
          sameLine = false;
        }
      }
      if (!ex) continue;
      const uncertainSection = (hit.role === "tax_id" || hit.role === "address") && section === null;
      const score =
        (BASE.label * hit.score + BASE.format + BASE.sameLine * (sameLine ? 1 : 0.5) + BASE.conf * avgConf(ex.tokens)) * (uncertainSection ? 0.85 : 1);
      add({
        fieldId: field,
        tokenIds: ex.tokens.map((t) => t.id),
        value: ex.value,
        score: Math.round(score * 100) / 100,
        reasons: [hit.score === 1 ? "label_exact" : "label_fuzzy", sameLine ? "same_line" : "below_label", ...(uncertainSection ? ["section_unknown"] : [])],
        context: line.text,
      });
    }
  });

  // Shape-only alternatives (never auto-filled: score stays below the reliability threshold).
  section = null;
  for (const line of lines) {
    const ln = norm(line.text);
    if (/\b(nguoi mua|ben mua|don vi mua|buyer)\b/.test(ln)) section = "buyer";
    else if (/\b(nguoi ban|ben ban|don vi ban|seller)\b/.test(ln)) section = "seller";
    for (const t of line.tokens) {
      const s = t.text.replace(/[,;.]$/, "");
      if (/^\d{10}(-\d{3})?$/.test(s)) {
        for (const f of ["seller_tax_id", "buyer_tax_id"] as const)
          add({ fieldId: f, tokenIds: [t.id], value: s, score: SHAPE_ONLY_SCORE * (section === (f === "seller_tax_id" ? "seller" : "buyer") ? 1 : 0.7), reasons: ["value_shape"], context: line.text });
      } else if (DATE_RES.some((re) => re.test(s))) {
        const ex = extractValue("invoice_date", [t]);
        if (ex) add({ fieldId: "invoice_date", tokenIds: [t.id], value: ex.value, score: SHAPE_ONLY_SCORE, reasons: ["value_shape"], context: line.text });
      }
    }
  }
  return [...out.values()].sort((a, b) => b.score - a.score);
}
