import type { InvoiceDocument, OCRToken } from "@/domain/types";
import { DND, dragSession } from "@/editor/dnd";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

interface Props {
  document: InvoiceDocument | null;
  tokens: OCRToken[];
  highlighted: Set<string>;
  canAssign: boolean;
  onTokenClick: (tokenId: string) => void;
}

/** Renders the document page with token regions positioned by bbox (page coordinates). */
export function DocumentPreview({ document: doc, tokens, highlighted, canAssign, onTokenClick }: Props) {
  const { t } = useI18n();
  if (!doc) return <p className="p-4 text-sm text-muted-foreground">{t("editor.previewEmpty")}</p>;
  const { width, height } = doc.pageSize;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="truncate text-xs font-semibold text-muted-foreground">{t("editor.previewOf", { name: doc.name })}</h2>
        <span className="tabular shrink-0 text-[11px] text-muted-foreground">{t("editor.pageOf", { page: 1, total: doc.pages })}</span>
      </div>
      <p className="px-3 pt-2 text-[11px] text-muted-foreground">{t("editor.tokenHint")}</p>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="relative mx-auto w-full max-w-[520px] rounded-sm border bg-paper shadow-xs" style={{ aspectRatio: `${width} / ${height}` }}>
          {tokens
            .filter((tk) => tk.page === 1)
            .map((tk) => {
              const hl = highlighted.has(tk.id);
              return (
                <button
                  key={tk.id}
                  type="button"
                  draggable
                  data-token={tk.id}
                  aria-label={t("editor.tokenLabel", { text: tk.text })}
                  aria-pressed={hl}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DND.token, tk.id);
                    e.dataTransfer.effectAllowed = "copy";
                    dragSession.tokenDocumentId = tk.documentId;
                  }}
                  onDragEnd={() => {
                    dragSession.tokenDocumentId = null;
                  }}
                  onClick={() => canAssign && onTokenClick(tk.id)}
                  className={cn(
                    "absolute cursor-grab truncate rounded-[2px] px-0.5 text-left text-[clamp(7px,1.6vw,11px)] leading-none text-foreground/85 hover:bg-primary/10 hover:ring-1 hover:ring-primary/60",
                    hl && "bg-review/35 ring-2 ring-review",
                  )}
                  style={{
                    left: `${(tk.bbox.x / width) * 100}%`,
                    top: `${(tk.bbox.y / height) * 100}%`,
                    width: `${(tk.bbox.width / width) * 100}%`,
                    height: `${(tk.bbox.height / height) * 100}%`,
                  }}
                >
                  {tk.text}
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}
