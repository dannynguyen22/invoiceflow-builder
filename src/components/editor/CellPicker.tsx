import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ListFilter, Pencil, X } from "lucide-react";
import type { Cell, FieldCandidate, FieldId } from "@/domain/types";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export const PICKER_TOP_N = 5;
const WIDTH = 320;
const GAP = 4;

interface Props {
  anchor: HTMLElement;
  cell: Cell;
  columnField: FieldId;
  candidates: FieldCandidate[];
  onChoose: (c: FieldCandidate) => void;
  onPreview: (tokenIds: string[] | null) => void;
  onShowAll: () => void;
  onEdit: () => void;
  onClose: () => void;
}

const reasonKey = (c: FieldCandidate) =>
  c.reasons.includes("xml_path") ? "xml" : c.reasons.includes("value_shape") ? "shape" : c.reasons.includes("below_label") ? "below" : "label";

/** Compact candidate popover anchored to a grid cell (fixed position, flips above when needed). */
export function CellPicker({ anchor, cell, columnField, candidates, onChoose, onPreview, onShowAll, onEdit, onClose }: Props) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const list = candidates.slice(0, PICKER_TOP_N);
  const [active, setActive] = useState(() => Math.max(0, list.findIndex((c) => c.value === cell.value)));

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const h = ref.current?.offsetHeight ?? 240;
      const below = r.bottom + GAP + h <= window.innerHeight;
      const top = below ? r.bottom + GAP : Math.max(GAP, r.top - GAP - h);
      const left = Math.min(Math.max(GAP, r.left), window.innerWidth - WIDTH - GAP);
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, list.length]);

  // Focus the active option; close on outside pointer down.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.focus() ?? ref.current?.focus();
  }, [active]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!ref.current?.contains(n) && !anchor.contains(n)) onClose();
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [anchor, onClose]);
  useEffect(() => {
    onPreview(list[active]?.tokenIds ?? null);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onPreview(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (list.length) setActive((a) => (a + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length);
    } else if (e.key === "Tab") {
      // Keep focus inside the popover.
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("button") ?? []);
      const i = items.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length]?.focus();
    } else if (e.key === "F2") {
      e.preventDefault();
      onEdit();
    }
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t("picker.title", { field: t(`fields.${columnField}`) })}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: WIDTH }}
      className="fixed z-50 rounded-md border bg-popover text-popover-foreground shadow-lg outline-none"
    >
      <div className="flex items-start justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold">{t(`fields.${columnField}`)}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {t(`review.${cell.reviewState}`)}
            {cell.flags.length > 0 && <> · {cell.flags.map((f) => t(`flags.${f}`)).join(", ")}</>}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label={t("picker.close")} className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      {list.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">{t("editor.candidatesEmpty")}</p>
      ) : (
        <ul role="listbox" aria-label={t("editor.candidatesTitle")} className="max-h-64 overflow-auto p-1">
          {list.map((c, i) => {
            const current = c.value === cell.value && c.tokenIds.join() === cell.sourceTokenIds.join();
            return (
              <li key={c.tokenIds.join()} role="presentation">
                <button
                  type="button"
                  role="option"
                  data-index={i}
                  aria-selected={i === active}
                  tabIndex={i === active ? 0 : -1}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onClick={() => onChoose(c)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left outline-none",
                    i === active && "bg-accent",
                  )}
                >
                  <span className="flex w-full items-center gap-2">
                    {current ? <Check className="size-3.5 shrink-0 text-primary" aria-label={t("picker.inUse")} /> : <span className="size-3.5 shrink-0" />}
                    <span className="tabular min-w-0 flex-1 truncate text-[13px] font-medium">{c.value}</span>
                    <span className="tabular shrink-0 text-[10px] text-muted-foreground">{t("editor.matchScore", { score: c.score.toFixed(2) })}</span>
                  </span>
                  <span className="flex w-full items-center gap-1.5 pl-5.5 text-[11px] text-muted-foreground">
                    <span className="shrink-0 rounded bg-secondary px-1 leading-4">{t(`picker.reason.${reasonKey(c)}`)}</span>
                    {c.context && <span className="min-w-0 truncate">{c.context}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center justify-between gap-2 border-t px-2 py-1.5">
        <button type="button" onClick={onShowAll} className="flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-primary hover:bg-accent">
          <ListFilter className="size-3.5" aria-hidden /> {t("picker.showAll")}
        </button>
        <button type="button" onClick={onEdit} className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground">
          <Pencil className="size-3.5" aria-hidden /> {t("picker.editManually")}
        </button>
      </div>
    </div>
  );
}
