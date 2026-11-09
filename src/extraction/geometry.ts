// Pure geometry helpers shared by the PDF text layer and OCR mapping.
import type { BBox } from "@/domain/types";

type Matrix = [number, number, number, number, number, number];

export function multiply(m1: readonly number[], m2: readonly number[]): Matrix {
  return [
    m1[0]! * m2[0]! + m1[2]! * m2[1]!,
    m1[1]! * m2[0]! + m1[3]! * m2[1]!,
    m1[0]! * m2[2]! + m1[2]! * m2[3]!,
    m1[1]! * m2[2]! + m1[3]! * m2[3]!,
    m1[0]! * m2[4]! + m1[2]! * m2[5]! + m1[4]!,
    m1[1]! * m2[4]! + m1[3]! * m2[5]! + m1[5]!,
  ];
}

/**
 * pdf.js text item → top-left bbox in viewport (scale 1, y-down) coordinates.
 * `viewportTransform` flips the PDF y-up space; `width` is the item's advance in user units.
 */
export function pdfItemBBox(viewportTransform: readonly number[], itemTransform: readonly number[], width: number): BBox {
  const tx = multiply(viewportTransform, itemTransform);
  const fontHeight = Math.hypot(tx[2], tx[3]);
  const scaleX = Math.hypot(viewportTransform[0]!, viewportTransform[1]!);
  return { x: tx[4], y: tx[5] - fontHeight, width: width * scaleX, height: fontHeight };
}

/**
 * Split a text run into whitespace-separated words. Word boxes are proportional to character
 * counts within the run's real box (pdf.js reports geometry per run, not per glyph).
 */
export function splitRun(text: string, box: BBox): { text: string; bbox: BBox }[] {
  const len = text.length;
  if (!len) return [];
  const out: { text: string; bbox: BBox }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({
      text: m[0],
      bbox: { x: box.x + (box.width * m.index) / len, y: box.y, width: (box.width * m[0].length) / len, height: box.height },
    });
  }
  return out;
}

/** Tesseract-style {x0,y0,x1,y1} in pixels → bbox in page units given the render scale. */
export function pixelBoxToPage(b: { x0: number; y0: number; x1: number; y1: number }, scale: number): BBox {
  return { x: b.x0 / scale, y: b.y0 / scale, width: (b.x1 - b.x0) / scale, height: (b.y1 - b.y0) / scale };
}
