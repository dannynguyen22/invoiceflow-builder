import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InvoiceDocument, OCRToken } from "@/domain/types";
import { DND, dragSession } from "@/editor/dnd";
import { clampPage, clampZoom, pageForHighlight, pagesWithHighlights, wheelZoom, ZOOM_STEP } from "@/editor/preview";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

interface Props {
  document: InvoiceDocument | null;
  tokens: OCRToken[];
  /** Rendered page images (object URLs), index 0 = page 1. Absent for fixtures and XML. */
  pageImages?: readonly string[] | undefined;
  highlighted: Set<string>;
  canAssign: boolean;
  onTokenClick: (tokenId: string) => void;
}

function startTokenDrag(e: React.DragEvent, tk: OCRToken) {
  e.dataTransfer.setData(DND.token, tk.id);
  e.dataTransfer.effectAllowed = "copy";
  dragSession.tokenDocumentId = tk.documentId;
}
const endTokenDrag = () => {
  dragSession.tokenDocumentId = null;
};

/** Source preview: page navigation, zoom, and token regions positioned by bbox on every page. */
export function DocumentPreview({ document: doc, tokens, pageImages, highlighted, canAssign, onTokenClick }: Props) {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(480);
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ px: number; py: number; k: number } | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const total = doc?.pages ?? 1;
  const hlKey = [...highlighted].join(",");
  const hlPages = useMemo(() => pagesWithHighlights(tokens, highlighted), [tokens, hlKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // New document → page 1. New selection → jump to the page holding its source tokens.
  useEffect(() => setPage(1), [doc?.id]);
  useEffect(() => setPage((p) => pageForHighlight(tokens, highlighted, clampPage(p, total))), [hlKey, doc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFitWidth(Math.max(240, Math.min(720, el.clientWidth - 24))));
    ro.observe(el);
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const next = wheelZoom(zoomRef.current, e.deltaY, e.deltaMode);
      anchor.current = { px: e.clientX - rect.left, py: e.clientY - rect.top, k: next / zoomRef.current };
      setZoom(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  }, [doc?.id]);

  // Keep the point under the cursor stationary while zooming.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = anchor.current;
    if (!el || !a) return;
    el.scrollLeft = (el.scrollLeft + a.px) * a.k - a.px;
    el.scrollTop = (el.scrollTop + a.py) * a.k - a.py;
    anchor.current = null;
  }, [zoom]);

  if (!doc) return <p className="p-4 text-sm text-muted-foreground">{t("editor.previewEmpty")}</p>;

  const structured = doc.source === "xml";
  const size = doc.pageSizes[page - 1] ?? doc.pageSizes[0] ?? { width: 600, height: 800 };
  const displayW = fitWidth * zoom;
  const scale = displayW / size.width;
  const image = pageImages?.[page - 1];
  const pageTokens = tokens.filter((tk) => tk.page === page && tk.bbox);

  const zoomBy = (k: number) => setZoom((z) => clampZoom(z * k));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b px-3 py-1.5">
        <h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground">{t("editor.previewOf", { name: doc.name })}</h2>
        {!structured && (
          <div className="flex items-center gap-1" role="group" aria-label={t("preview.controls")}>
            <Button size="icon" variant="ghost" className="size-7" disabled={page <= 1} onClick={() => setPage((p) => clampPage(p - 1, total))} aria-label={t("preview.prevPage")}>
              <ChevronLeft aria-hidden />
            </Button>
            <span className="tabular min-w-14 text-center text-[11px] text-muted-foreground" aria-live="polite">
              {t("editor.pageOf", { page, total })}
            </span>
            <Button size="icon" variant="ghost" className="size-7" disabled={page >= total} onClick={() => setPage((p) => clampPage(p + 1, total))} aria-label={t("preview.nextPage")}>
              <ChevronRight aria-hidden />
            </Button>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            <Button size="icon" variant="ghost" className="size-7" onClick={() => zoomBy(1 / ZOOM_STEP)} aria-label={t("preview.zoomOut")}>
              <ZoomOut aria-hidden />
            </Button>
            <span className="tabular w-10 text-center text-[11px] text-muted-foreground" data-testid="zoom-level">
              {Math.round(zoom * 100)}%
            </span>
            <Button size="icon" variant="ghost" className="size-7" onClick={() => zoomBy(ZOOM_STEP)} aria-label={t("preview.zoomIn")}>
              <ZoomIn aria-hidden />
            </Button>
            <Button size="icon" variant="ghost" className="size-7" onClick={() => setZoom(1)} aria-label={t("preview.zoomReset")}>
              <Maximize aria-hidden />
            </Button>
          </div>
        )}
      </div>
      {!structured && hlPages.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 px-3 pt-1.5 text-[11px] text-muted-foreground">
          <span>{t("preview.sourceOnPages")}</span>
          {hlPages.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPage(p)}
              className={cn("tabular rounded border px-1.5 leading-5 hover:border-primary/60", p === page && "border-review bg-review/20 text-foreground")}
            >
              {p}
            </button>
          ))}
        </div>
      )}
      <p className="px-3 pt-1.5 text-[11px] text-muted-foreground">{t(structured ? "preview.xmlHint" : "editor.tokenHint")}</p>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-3">
        {structured ? (
          <ul className="space-y-0.5" aria-label={t("preview.xmlList")}>
            {tokens.map((tk) => (
              <li key={tk.id}>
                <button
                  type="button"
                  draggable
                  data-token={tk.id}
                  aria-pressed={highlighted.has(tk.id)}
                  aria-label={t("editor.tokenLabel", { text: tk.text })}
                  onDragStart={(e) => startTokenDrag(e, tk)}
                  onDragEnd={endTokenDrag}
                  onClick={() => canAssign && onTokenClick(tk.id)}
                  className={cn(
                    "flex w-full cursor-grab items-baseline gap-2 rounded px-1.5 py-0.5 text-left text-xs hover:bg-accent/60",
                    highlighted.has(tk.id) && "bg-review/30 ring-1 ring-review",
                  )}
                >
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{tk.sourcePath}</span>
                  <span className="tabular truncate">{tk.text}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div
            className="relative mx-auto rounded-sm border bg-paper shadow-xs"
            style={{ width: displayW, height: size.height * scale }}
            data-testid="preview-page"
            data-page={page}
          >
            {image && <img src={image} alt={t("preview.pageImage", { page })} className="absolute inset-0 size-full select-none" draggable={false} />}
            {pageTokens.map((tk) => {
              const hl = highlighted.has(tk.id);
              const b = tk.bbox!;
              return (
                <button
                  key={tk.id}
                  type="button"
                  draggable
                  data-token={tk.id}
                  aria-label={t("editor.tokenLabel", { text: tk.text })}
                  aria-pressed={hl}
                  onDragStart={(e) => startTokenDrag(e, tk)}
                  onDragEnd={endTokenDrag}
                  onClick={() => canAssign && onTokenClick(tk.id)}
                  className={cn(
                    "absolute cursor-grab truncate rounded-[2px] px-0.5 text-left leading-none hover:bg-primary/10 hover:ring-1 hover:ring-primary/60",
                    image ? "text-transparent" : "text-foreground/85",
                    hl && "bg-review/35 ring-2 ring-review",
                  )}
                  style={{
                    left: b.x * scale,
                    top: b.y * scale,
                    width: b.width * scale,
                    height: b.height * scale,
                    fontSize: Math.max(6, b.height * scale * 0.7),
                  }}
                >
                  {tk.text}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
