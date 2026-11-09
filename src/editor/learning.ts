// Learning from a user-selected example (PRD §06). Pure, deterministic, no AI, no network.
//
// From ONE example cell we learn *where on the document* the user took the value from:
//  - the nearby label(s) printed next to it ("Số hóa đơn:"),
//  - the relative geometry between label and value (same line / below, offset in line heights),
//  - the section it sat in (seller / buyer block),
//  - the value's shape (digits/letters/punctuation pattern),
//  - the layout signature of the example document (label set + label positions),
//  - the structured source path for XML.
// For every other document we then look for ITS OWN value using those signals. The example value
// is never copied: each result is built from the target document's own tokens.
import { getField } from "@/domain/fields";
import { isValueCompatible } from "@/domain/validation";
import type {
  BBox,
  ExtractionSource,
  FieldCandidate,
  FieldId,
  OCRToken,
  PageSize,
  RawExtraction,
} from "@/domain/types";
import {
  buildLines,
  extractValue,
  norm,
  SECTION_BUYER_RE,
  SECTION_SELLER_RE,
  segments,
  similarity,
  type Line,
  type Segment,
} from "@/extraction/matching";

// ---------------------------------------------------------------- shared types

export type Section = "seller" | "buyer" | null;
export type Relation = "same_line" | "below_label";
export type MatchMethod = "learned_label" | "learned_position" | "learned_path" | "registry";

/** A machine-readable reason; the UI turns `code` + `params` into localized text. */
export interface Reason {
  code: string;
  params?: Record<string, string | number>;
}

/** Where a proposed value comes from on the target document. */
export interface SourceRef {
  documentId: string;
  page: number;
  tokenIds: string[];
  /** Union of the token boxes (page units); null for structured (XML) sources. */
  bbox: BBox | null;
  sourcePath: string | null;
  /** The printed line the value sits in (document text only). */
  context: string;
  text: string;
}

export interface Evidence {
  method: MatchMethod;
  /** Heuristic 0–1 agreement with what was learned; not a probability. */
  confidence: number;
  reasons: Reason[];
  source: SourceRef | null;
  /** Other distinct candidates scoring within AMBIGUITY_MARGIN of this one. */
  ambiguousWith: number;
}

/** Thresholds shared by auto-fill and batch correction. */
export const MATCHED_CONFIDENCE = 0.75;
export const REVIEW_CONFIDENCE = 0.4;
export const AMBIGUITY_MARGIN = 0.08;
export const LAYOUT_SIMILAR_MIN = 0.6;

const LABEL_FUZZY_MIN = 0.85;

// ---------------------------------------------------------------- small helpers

const usable = (s: PageSize | undefined): s is PageSize => !!s && s.width > 0 && s.height > 0;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number) => Math.round(n * 100);
const cleanLabel = (s: string) => s.replace(/[:\s]+$/, "").trim();

/** Label identity: diacritic-free, lowercase, digits removed ("VAT (8%)" ≈ "VAT (10%)"). */
export function labelKey(text: string): string {
  const k = norm(text).replace(/\d+/g, " ").replace(/\s+/g, " ").trim();
  return k.length >= 2 ? k : "";
}

/** Character-class shape: digit→9, upper→A, lower→a, anything else kept. */
export function shapeOf(text: string): string {
  return [...text]
    .map((c) => (/\d/.test(c) ? "9" : /\p{Lu}/u.test(c) ? "A" : /\p{L}/u.test(c) ? "a" : c))
    .join("");
}
export const shapeSimilarity = (a: string, b: string) => similarity(shapeOf(a), shapeOf(b));

function unionBox(tokens: readonly OCRToken[]): BBox | null {
  const boxes = tokens.map((t) => t.bbox).filter((b): b is BBox => !!b);
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function docTokens(raw: RawExtraction, documentId: string): OCRToken[] {
  return raw.tokens.filter((t) => t.documentId === documentId);
}
function pageSizeOf(raw: RawExtraction, documentId: string, page: number): PageSize | undefined {
  return raw.documents.find((d) => d.id === documentId)?.pageSizes[page - 1];
}

/** Build a source reference for display (page, box, printed line). */
export function sourceRef(
  raw: RawExtraction,
  documentId: string,
  tokenIds: readonly string[],
  context = "",
): SourceRef | null {
  const toks = tokenIds
    .map((id) => raw.tokens.find((t) => t.id === id))
    .filter((t): t is OCRToken => !!t && t.documentId === documentId);
  if (!toks.length) return null;
  return {
    documentId,
    page: toks[0]!.page,
    tokenIds: toks.map((t) => t.id),
    bbox: unionBox(toks),
    sourcePath: toks.find((t) => t.sourcePath)?.sourcePath ?? null,
    context,
    text: toks.map((t) => t.text).join(" "),
  };
}

function sectionAt(lines: readonly Line[], index: number): Section {
  let s: Section = null;
  for (let i = 0; i <= index && i < lines.length; i++) {
    const n = norm(lines[i]!.text);
    if (SECTION_BUYER_RE.test(n)) s = "buyer";
    else if (SECTION_SELLER_RE.test(n)) s = "seller";
  }
  return s;
}

// ---------------------------------------------------------------- layout profile

export interface LayoutProfile {
  documentId: string;
  source: ExtractionSource;
  pages: number;
  /** width / height of page 1; null when the source has no page geometry (XML). */
  aspect: number | null;
  /** Printed "label:" anchors with their position as a fraction of the page. */
  labels: { key: string; page: number; x: number; y: number }[];
  /** Structured paths (XML only). */
  paths: string[];
}

const MAX_PROFILE_LABELS = 60;

/** The layout signature of one document: which labels it prints and where. */
export function buildLayoutProfile(raw: RawExtraction, documentId: string): LayoutProfile {
  const doc = raw.documents.find((d) => d.id === documentId);
  const toks = docTokens(raw, documentId);
  const size = doc?.pageSizes[0];
  const profile: LayoutProfile = {
    documentId,
    source: doc?.source ?? "fixture",
    pages: doc?.pages ?? 1,
    aspect: usable(size) ? size.width / size.height : null,
    labels: [],
    paths: [],
  };
  if (doc?.source === "xml") {
    profile.paths = [...new Set(toks.map((t) => t.sourcePath).filter((p): p is string => !!p))];
    return profile;
  }
  const seen = new Set<string>();
  for (const line of buildLines(toks)) {
    const ps = pageSizeOf(raw, documentId, line.page);
    if (!usable(ps)) continue;
    for (const seg of segments(line)) {
      if (!seg.value.length || !seg.label.length) continue;
      const key = labelKey(seg.label.map((t) => t.text).join(" "));
      const box = unionBox(seg.label);
      if (!key || !box || seen.has(key) || profile.labels.length >= MAX_PROFILE_LABELS) continue;
      seen.add(key);
      profile.labels.push({ key, page: line.page, x: box.x / ps.width, y: box.y / ps.height });
    }
  }
  return profile;
}

/**
 * Similarity of two document layouts in [0,1]: same kind of source, similar page shape, the same
 * printed labels, and those labels at similar places on the page. Extraction source type alone is
 * never enough.
 */
export function layoutSimilarity(a: LayoutProfile, b: LayoutProfile): number {
  if ((a.source === "xml") !== (b.source === "xml")) return 0;
  if (a.source === "xml") {
    const A = new Set(a.paths);
    const B = new Set(b.paths);
    const inter = [...A].filter((p) => B.has(p)).length;
    const union = A.size + B.size - inter;
    return union ? round2(inter / union) : 0;
  }
  const srcFactor = a.source === b.source ? 1 : 0.9; // PDF text vs OCR of the same template
  const aspect =
    a.aspect != null && b.aspect != null ? clamp01(1 - Math.abs(a.aspect - b.aspect) / 0.1) : 0.5;
  const pages = a.pages === b.pages ? 1 : 0.5;
  const minLabels = Math.min(a.labels.length, b.labels.length);
  if (minLabels < 2) return round2((0.5 * aspect + 0.1 * pages) * srcFactor); // too little text to compare
  const byKey = new Map(b.labels.map((l) => [l.key, l]));
  const shared = a.labels.filter((l) => byKey.has(l.key));
  const overlap = shared.length / minLabels;
  const posAgree = shared.length
    ? shared.reduce((sum, l) => {
        const o = byKey.get(l.key)!;
        const dist = Math.hypot((l.x - o.x) / 0.1, (l.y - o.y) / 0.25);
        return sum + clamp01(1 - dist);
      }, 0) / shared.length
    : 0;
  return round2((0.1 * aspect + 0.05 * pages + 0.4 * overlap + 0.45 * posAgree) * srcFactor);
}

// ---------------------------------------------------------------- learning

export interface LearnedAnchor {
  /** Label as printed in the example ("Số hóa đơn:"). */
  text: string;
  key: string;
  wordCount: number;
  relation: Relation;
  /** Gap from the label to the value in page widths (label right edge for same-line, left edge for below). */
  dx: number;
  /** Vertical offset label→value in line heights. */
  dy: number;
}

export interface LearnedExample {
  fieldId: FieldId;
  documentId: string;
  value: string;
  /** How the example's source tokens were identified. */
  locatedBy: "user_source" | "value_lookup" | "none";
  sourceTokenIds: string[];
  page: number;
  /** Value box as fractions of the page; null without geometry. */
  valueBox: { x: number; y: number; w: number; h: number } | null;
  rawText: string;
  tokenCount: number;
  /** True when the value was everything after its label up to the next label. */
  wholeSegment: boolean;
  anchors: LearnedAnchor[];
  sourcePath: string | null;
  section: Section;
  profile: LayoutProfile;
  /** The deterministic registry matcher ranked this same source first for the example document. */
  registryAgrees: boolean;
  source: SourceRef | null;
}

function topRegistry(raw: RawExtraction, documentId: string, fieldId: FieldId) {
  return [...(raw.candidates[documentId] ?? [])]
    .filter((c) => c.fieldId === fieldId)
    .sort((a, b) => b.score - a.score)[0];
}

/** Find the example's source tokens when the cell has none (typed value): first exact text match. */
function lookupValueTokens(
  lines: readonly Line[],
  toks: readonly OCRToken[],
  fieldId: FieldId,
  value: string,
): OCRToken[] {
  const want = value.trim();
  if (!want) return [];
  const direct = toks.find((t) => !t.bbox && t.text === want);
  if (direct) return [direct];
  for (const line of lines)
    for (let i = 0; i < line.tokens.length; i++)
      for (let j = i + 1; j <= Math.min(line.tokens.length, i + 6); j++) {
        const run = line.tokens.slice(i, j);
        const text = run.map((t) => t.text);
        if (text.join(" ") === want || text.join("") === want) return run;
        const ex = extractValue(fieldId, run);
        if (ex && ex.value === want && ex.tokens.length === run.length) return run;
      }
  return [];
}

/** A segment plus a more readable label for display (the words before "label:" that belong to it). */
interface LabelledSegment extends Segment {
  display: OCRToken[];
}
const MAX_LABEL_EXTENSION = 3;

/**
 * `segments()` only knows multi-word labels it recognises, so an unknown label after another value
 * ("Ký hiệu: 1C26TAA Số định danh:") comes out as just "danh". For display, extend such a label
 * with the label-like words immediately before it, but only when those words are clearly bounded by
 * the previous value (a token with digits) or are all of it. Matching still uses the plain label.
 */
function labelledSegments(line: Line): LabelledSegment[] {
  const segs = segments(line);
  return segs.map((seg, i) => {
    const prev = segs[i - 1];
    let display = seg.label;
    if (prev && seg.value.length) {
      const tail: OCRToken[] = [];
      let bounded = false;
      for (let k = prev.value.length - 1; k >= 0 && tail.length < MAX_LABEL_EXTENSION; k--) {
        const tk = prev.value[k]!;
        if (/\d|[,;.]$/.test(tk.text)) {
          bounded = true;
          break;
        }
        tail.unshift(tk);
        if (k === 0) bounded = true;
      }
      if (tail.length && bounded) display = [...tail, ...seg.label];
    }
    return { ...seg, display };
  });
}

const MAX_PREFIX_WORDS = 5;

/**
 * Learn from the example cell: where its value sits and what surrounds it.
 * `value`/`sourceTokenIds` come from the example cell as the user left it.
 */
export function learnFromExample(
  raw: RawExtraction,
  input: { documentId: string; fieldId: FieldId; value: string; sourceTokenIds: readonly string[] },
): LearnedExample {
  const { documentId, fieldId, value } = input;
  const toks = docTokens(raw, documentId);
  const lines = buildLines(toks);
  const byId = new Map(toks.map((t) => [t.id, t]));
  let ex = input.sourceTokenIds.map((id) => byId.get(id)).filter((t): t is OCRToken => !!t);
  let locatedBy: LearnedExample["locatedBy"] = ex.length ? "user_source" : "none";
  if (!ex.length) {
    ex = lookupValueTokens(lines, toks, fieldId, value);
    if (ex.length) locatedBy = "value_lookup";
  }

  const profile = buildLayoutProfile(raw, documentId);
  const top = topRegistry(raw, documentId, fieldId);
  const exIds = ex.map((t) => t.id);
  const registryAgrees =
    !!top && exIds.length > 0 && [...top.tokenIds].sort().join() === [...exIds].sort().join();

  const base: LearnedExample = {
    fieldId,
    documentId,
    value,
    locatedBy,
    sourceTokenIds: exIds,
    page: ex[0]?.page ?? 1,
    valueBox: null,
    rawText: ex.map((t) => t.text).join(" "),
    tokenCount: ex.length,
    wholeSegment: true,
    anchors: [],
    sourcePath: ex.find((t) => t.sourcePath)?.sourcePath ?? null,
    section: null,
    profile,
    registryAgrees,
    source: null,
  };
  if (!ex.length) return base;

  const first = [...ex].sort((a, b) => (a.bbox?.x ?? 0) - (b.bbox?.x ?? 0))[0]!;
  const li = lines.findIndex((l) => l.tokens.some((t) => t.id === first.id));
  const line = li >= 0 ? lines[li] : undefined;
  const size = pageSizeOf(raw, documentId, first.page);
  const box = unionBox(ex);
  base.source = sourceRef(raw, documentId, exIds, line?.text ?? "");
  if (!line || !box || !usable(size)) return base; // structured source: the path is the signal

  base.valueBox = {
    x: box.x / size.width,
    y: box.y / size.height,
    w: box.width / size.width,
    h: box.height / size.height,
  };
  base.section = sectionAt(lines, li);

  const anchors: LearnedAnchor[] = [];
  const exSet = new Set(exIds);
  const firstX = first.bbox?.x ?? 0;
  // 1) Label on the same line, left of the value.
  const seg = labelledSegments(line).find((s) => s.value.some((v) => v.id === first.id));
  let labelTokens: OCRToken[];
  let displayTokens: OCRToken[];
  if (seg && seg.label.length) {
    labelTokens = seg.label;
    displayTokens = seg.display;
    base.wholeSegment = seg.value.every((v) => exSet.has(v.id));
  } else {
    // "Số hóa đơn 0004567": the words immediately before the value, without a colon.
    const before = line.tokens.filter((t) => (t.bbox?.x ?? 0) < firstX && !exSet.has(t.id));
    labelTokens = before.slice(-MAX_PREFIX_WORDS);
    displayTokens = labelTokens;
    base.wholeSegment = line.tokens
      .filter((t) => (t.bbox?.x ?? 0) >= firstX)
      .every((t) => exSet.has(t.id));
  }
  const text = displayTokens.map((t) => t.text).join(" ");
  const key = labelKey(labelTokens.map((t) => t.text).join(" "));
  const lbox = unionBox(labelTokens);
  if (key && lbox)
    anchors.push({
      text,
      key,
      wordCount: labelTokens.length,
      relation: "same_line",
      dx: (box.x - (lbox.x + lbox.width)) / size.width,
      dy: (box.y + box.height / 2 - (lbox.y + lbox.height / 2)) / Math.max(1, line.height),
    });
  // 2) Only when the value has no label of its own on its line: a label on the line above that
  //    overlaps the value's columns ("label over value" layouts).
  const prev = lines[li - 1];
  if (!anchors.length && prev && prev.page === line.page && line.y - prev.y < prev.height * 3) {
    // The label group above: the tokens over the value's columns plus contiguous neighbours on that line.
    const hit = prev.tokens.map(
      (t) => !!t.bbox && t.bbox.x < box.x + box.width && t.bbox.x + t.bbox.width > box.x,
    );
    let lo = hit.indexOf(true);
    let hi = hit.lastIndexOf(true);
    if (lo >= 0) {
      const gap = (a: OCRToken, b: OCRToken) =>
        b.bbox!.x - (a.bbox!.x + a.bbox!.width) < prev.height * 1.5;
      while (lo > 0 && gap(prev.tokens[lo - 1]!, prev.tokens[lo]!)) lo--;
      while (hi < prev.tokens.length - 1 && gap(prev.tokens[hi]!, prev.tokens[hi + 1]!)) hi++;
    }
    const over = lo >= 0 ? prev.tokens.slice(lo, hi + 1) : [];
    const atext = over.map((t) => t.text).join(" ");
    const akey = labelKey(atext);
    const abox = unionBox(over);
    if (akey && abox && over.length <= 6 && !/\d/.test(atext))
      anchors.push({
        text: atext,
        key: akey,
        wordCount: over.length,
        relation: "below_label",
        dx: (box.x - abox.x) / size.width,
        dy: (line.y - prev.y) / Math.max(1, prev.height),
      });
  }
  base.anchors = anchors;
  return base;
}

// ---------------------------------------------------------------- locating in another document

export interface LocateContext {
  layoutSimilarity: number;
  supplierMatch: boolean;
}

export interface Located {
  candidate: FieldCandidate;
  evidence: Evidence;
}

interface Hit {
  tokens: OCRToken[];
  value: string;
  method: MatchMethod;
  confidence: number;
  reasons: Reason[];
  context: string;
}

/** Weights of the evidence components (sum 0.9; the registry-agreement bonus adds 0.1 in smart.ts). */
const W = { anchor: 0.35, shape: 0.2, geometry: 0.15, section: 0.05, layout: 0.1, supplier: 0.05 };

/** Pick the value tokens out of the tokens that follow a matched label. */
function pickValue(
  learned: LearnedExample,
  tokens: OCRToken[],
): { tokens: OCRToken[]; value: string; shape: number } | null {
  if (!tokens.length) return null;
  const field = learned.fieldId;
  const vt = getField(field).valueType;
  const pool =
    vt === "text" && !learned.wholeSegment ? tokens.slice(0, learned.tokenCount) : tokens;
  let r = extractValue(field, pool);
  if (!r && vt === "identifier") {
    // Wider than the registry rule (alphanumeric invoice numbers): accept a token of the learned shape.
    const t = pool[0]!;
    const v = t.text.replace(/[,;.]+$/, "");
    if (shapeSimilarity(learned.rawText, v) >= 0.7) r = { tokens: [t], value: v };
  }
  if (!r || !isValueCompatible(field, r.value)) return null;
  const printed = r.tokens.map((t) => t.text).join(" ");
  const shape = vt === "text" ? 1 : shapeSimilarity(learned.rawText, printed);
  if (shape < 0.5) return null;
  return { tokens: r.tokens, value: r.value, shape };
}

/** Closeness of the value's page position to the example's, in [0,1]; null without geometry. */
function zoneScore(
  learned: LearnedExample,
  tokens: OCRToken[],
  size: PageSize | undefined,
): number | null {
  const b = unionBox(tokens);
  if (!learned.valueBox || !b || !usable(size) || tokens[0]!.page !== learned.page) return null;
  const dx = (b.x / size.width - learned.valueBox.x) / 0.15;
  const dy = (b.y / size.height - learned.valueBox.y) / 0.3;
  return clamp01(1 - Math.hypot(dx, dy));
}

function sectionScore(example: Section, target: Section): number {
  if (example && target) return example === target ? 1 : 0;
  return example === target ? 0.7 : 0.5; // both unknown / one unknown
}

function shapeReason(shape: number): Reason {
  return { code: shape >= 0.85 ? "shape_same" : "shape_close", params: { pct: pct(shape) } };
}

interface ScoreInput {
  learned: LearnedExample;
  ctx: LocateContext;
  size: PageSize | undefined;
  section: Section;
  valueLine: Line;
  labelToks: OCRToken[];
  /** Readable label for the UI (may include a few more words than the matched label). */
  displayToks?: OCRToken[];
  pick: { tokens: OCRToken[]; value: string; shape: number };
  anchor: LearnedAnchor;
  /** Label similarity in [0,1]; 1 = identical label. */
  sim: number;
}

/** Score one label-anchored hit. */
function scoreLabelHit(i: ScoreInput): Hit {
  const { learned, ctx, size, section, valueLine, labelToks, pick, anchor, sim } = i;
  // Relative geometry: where the value sits relative to THIS label vs. in the example.
  const vb = unionBox(pick.tokens);
  const lb = unionBox(labelToks);
  let rel: number | null = null;
  if (vb && lb && usable(size)) {
    const lineH = Math.max(1, valueLine.height);
    const sameLine = anchor.relation === "same_line";
    const dx = (vb.x - (sameLine ? lb.x + lb.width : lb.x)) / size.width;
    const dy = sameLine
      ? (vb.y + vb.height / 2 - (lb.y + lb.height / 2)) / lineH
      : (valueLine.y - (lb.y + lb.height / 2)) / lineH;
    rel = clamp01(1 - Math.hypot((dx - anchor.dx) / 0.12, (dy - anchor.dy) / 1.5) / 2);
  }
  const zone = zoneScore(learned, pick.tokens, size);
  const geometry = 0.4 + 0.4 * (rel ?? 0.5) + 0.2 * (zone ?? 0.5);
  const sec = sectionScore(learned.section, section);
  const mismatch = !!learned.section && !!section && learned.section !== section;
  const anchorScore = sim === 1 ? 1 : sim * 0.9;
  const conf =
    (W.anchor * anchorScore +
      W.shape * pick.shape +
      W.geometry * geometry +
      W.section * sec +
      W.layout * ctx.layoutSimilarity +
      W.supplier * (ctx.supplierMatch ? 1 : 0)) *
    (mismatch ? 0.6 : 1);

  const labelText = cleanLabel((i.displayToks ?? labelToks).map((t) => t.text).join(" "));
  const reasons: Reason[] =
    sim === 1
      ? [{ code: "label_same", params: { label: labelText } }]
      : [
          {
            code: "label_similar",
            params: { label: labelText, expected: cleanLabel(anchor.text), pct: pct(sim) },
          },
        ];
  reasons.push({ code: anchor.relation === "same_line" ? "place_same_line" : "place_below_label" });
  if (rel != null && rel >= 0.7) reasons.push({ code: "place_offset_same" });
  if (zone != null && zone >= 0.7)
    reasons.push({ code: "position_zone", params: { pct: pct(zone) } });
  reasons.push(shapeReason(pick.shape));
  if (learned.section)
    reasons.push({
      code: mismatch ? "section_differs" : sec === 1 ? "section_same" : "section_unknown",
      params: { section: learned.section },
    });
  if (ctx.layoutSimilarity >= LAYOUT_SIMILAR_MIN)
    reasons.push({ code: "layout_similar", params: { pct: pct(ctx.layoutSimilarity) } });
  if (ctx.supplierMatch) reasons.push({ code: "supplier_same" });
  return {
    tokens: pick.tokens,
    value: pick.value,
    method: "learned_label",
    confidence: round2(conf),
    reasons,
    context: valueLine.text,
  };
}

/** Search one document for the value described by `learned`. */
export function locateLearned(
  raw: RawExtraction,
  documentId: string,
  learned: LearnedExample,
  ctx: LocateContext,
): Located | null {
  const field = learned.fieldId;
  const toks = docTokens(raw, documentId);
  const hits: Hit[] = [];

  if (learned.sourcePath) {
    // ---- structured source: same element path
    toks
      .filter((t) => t.sourcePath === learned.sourcePath)
      .forEach((t, i) => {
        const r = extractValue(field, [t]) ?? { tokens: [t], value: t.text };
        if (!isValueCompatible(field, r.value)) return;
        const conf = 0.85 + 0.1 * (ctx.supplierMatch ? 1 : 0) + 0.05 * ctx.layoutSimilarity;
        hits.push({
          tokens: [t],
          value: r.value,
          method: "learned_path",
          confidence: round2(Math.min(1, conf) - (i ? 0.2 : 0)), // repeated element → less certain
          reasons: [
            { code: "xml_path", params: { path: t.sourcePath ?? "" } },
            ...(ctx.supplierMatch ? [{ code: "supplier_same" }] : []),
          ],
          context: t.sourcePath ?? "",
        });
      });
  } else {
    const lines = buildLines(toks);
    const sizeOf = (page: number) => pageSizeOf(raw, documentId, page);
    lines.forEach((line, li) => {
      const size = sizeOf(line.page);
      for (const anchor of learned.anchors) {
        if (anchor.relation === "same_line") {
          const section = sectionAt(lines, li);
          for (const seg of labelledSegments(line)) {
            let labelToks = seg.label;
            let displayToks = seg.display;
            let valueToks = seg.value;
            if (!valueToks.length && labelToks.length > anchor.wordCount) {
              // Colon-less line: label words first, value after them.
              labelToks = seg.label.slice(0, anchor.wordCount);
              displayToks = labelToks;
              valueToks = seg.label.slice(anchor.wordCount);
            }
            const lk = labelKey(labelToks.map((t) => t.text).join(" "));
            if (!lk || !valueToks.length) continue;
            const sim = lk === anchor.key ? 1 : similarity(lk, anchor.key);
            if (sim < LABEL_FUZZY_MIN || (sim < 1 && anchor.key.length < 4)) continue;
            const pick = pickValue(learned, valueToks);
            if (pick)
              hits.push(
                scoreLabelHit({
                  learned,
                  ctx,
                  size,
                  section,
                  valueLine: line,
                  labelToks,
                  displayToks,
                  pick,
                  anchor,
                  sim,
                }),
              );
          }
        } else {
          // Label above the value: find the label words in this line, the value in the next line.
          const next = lines[li + 1];
          if (!next || next.page !== line.page || next.y - line.y > line.height * 3) continue;
          for (let i = 0; i + anchor.wordCount <= line.tokens.length; i++) {
            const labelToks = line.tokens.slice(i, i + anchor.wordCount);
            const lk = labelKey(labelToks.map((t) => t.text).join(" "));
            const sim = lk === anchor.key ? 1 : lk ? similarity(lk, anchor.key) : 0;
            if (sim < LABEL_FUZZY_MIN || (sim < 1 && anchor.key.length < 4)) continue;
            const lb = unionBox(labelToks);
            if (!lb) continue;
            const exW = (learned.valueBox?.w ?? 0) * (size?.width ?? 0);
            const under = next.tokens.filter(
              (t) =>
                t.bbox &&
                t.bbox.x + t.bbox.width > lb.x - 2 &&
                t.bbox.x < lb.x + Math.max(lb.width, exW) * 1.2 + 2,
            );
            const pick = pickValue(learned, under);
            if (pick)
              hits.push(
                scoreLabelHit({
                  learned,
                  ctx,
                  size,
                  section: sectionAt(lines, li + 1),
                  valueLine: next,
                  labelToks,
                  pick,
                  anchor,
                  sim,
                }),
              );
          }
        }
      }
    });

    // ---- no usable label: same zone of a similar layout (never auto-filled; the user reviews it)
    if (
      !hits.some((h) => h.confidence >= REVIEW_CONFIDENCE) &&
      learned.valueBox &&
      ctx.layoutSimilarity >= 0.5
    ) {
      lines.forEach((line, li) => {
        const size = sizeOf(line.page);
        const vb = learned.valueBox;
        const y0 = line.tokens[0]?.bbox?.y;
        if (!vb || !usable(size) || y0 == null || line.page !== learned.page) return;
        if (Math.abs(y0 / size.height - vb.y) > 0.04) return;
        const start = line.tokens.findIndex(
          (t) => t.bbox && Math.abs(t.bbox.x / size.width - vb.x) < 0.12,
        );
        if (start < 0) return;
        const pick = pickValue(learned, line.tokens.slice(start));
        if (!pick) return;
        const zone = zoneScore(learned, pick.tokens, size);
        if (zone == null || zone < 0.4) return;
        const sec = sectionAt(lines, li);
        const conf =
          W.shape * pick.shape +
          W.geometry * zone +
          W.section * sectionScore(learned.section, sec) +
          W.layout * ctx.layoutSimilarity +
          W.supplier * (ctx.supplierMatch ? 1 : 0);
        hits.push({
          tokens: pick.tokens,
          value: pick.value,
          method: "learned_position",
          confidence: round2(conf * (learned.section && sec && learned.section !== sec ? 0.6 : 1)),
          reasons: [
            { code: "position_zone", params: { pct: pct(zone) } },
            shapeReason(pick.shape),
            { code: "layout_similar", params: { pct: pct(ctx.layoutSimilarity) } },
            ...(ctx.supplierMatch ? [{ code: "supplier_same" }] : []),
          ],
          context: line.text,
        });
      });
    }
  }

  // ---- best distinct hit (same tokens → keep the strongest)
  const byTokens = new Map<string, Hit>();
  for (const h of hits) {
    const k = h.tokens.map((t) => t.id).join(",");
    const prev = byTokens.get(k);
    if (!prev || prev.confidence < h.confidence) byTokens.set(k, h);
  }
  const ranked = [...byTokens.values()]
    .filter((h) => h.confidence >= REVIEW_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence);
  const best = ranked[0];
  if (!best) return null;
  const rivals = ranked
    .slice(1)
    .filter((h) => best.confidence - h.confidence < AMBIGUITY_MARGIN && h.value !== best.value);
  const reasons = [...best.reasons];
  if (rivals.length) reasons.push({ code: "ambiguous", params: { count: rivals.length } });
  const tokenIds = best.tokens.map((t) => t.id);
  return {
    candidate: {
      fieldId: field,
      tokenIds,
      value: best.value,
      score: best.confidence,
      reasons: [best.method],
      context: best.context,
    },
    evidence: {
      method: best.method,
      confidence: best.confidence,
      reasons,
      source: sourceRef(raw, documentId, tokenIds, best.context),
      ambiguousWith: rivals.length,
    },
  };
}
