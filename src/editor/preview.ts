// Pure helpers for the source preview (page navigation + zoom). No React.
import type { OCRToken } from "@/domain/types";

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;
export const ZOOM_STEP = 1.25;

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));
export const clampPage = (page: number, total: number) => Math.min(Math.max(1, total), Math.max(1, Math.round(page)));

/** Pages (1-based, ascending) that contain at least one highlighted token. */
export function pagesWithHighlights(tokens: readonly OCRToken[], highlighted: ReadonlySet<string>): number[] {
  const pages = new Set<number>();
  for (const t of tokens) if (highlighted.has(t.id)) pages.add(t.page);
  return [...pages].sort((a, b) => a - b);
}

/** Page to show for a selection: the first page holding a source token, else the current page. */
export function pageForHighlight(tokens: readonly OCRToken[], highlighted: ReadonlySet<string>, current: number): number {
  const pages = pagesWithHighlights(tokens, highlighted);
  if (!pages.length || pages.includes(current)) return current;
  return pages[0]!;
}

/** Wheel delta → multiplicative zoom, normalised for deltaMode (lines/pages). */
export function wheelZoom(zoom: number, deltaY: number, deltaMode: number): number {
  const dy = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 100 : 1);
  return clampZoom(zoom * Math.exp(-dy * 0.0015));
}
