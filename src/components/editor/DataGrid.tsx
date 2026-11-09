import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FIELD_REGISTRY, getField } from "@/domain/fields";
import type { Cell, FieldId, InvoiceDocument } from "@/domain/types";
import { cellKey, type EditorState } from "@/editor/engine";
import { DND, dragSession, hasType } from "@/editor/dnd";
import type { Selection } from "@/editor/useEditor";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

interface Props {
  documents: readonly InvoiceDocument[];
  state: EditorState;
  selection: Selection | null;
  editing: boolean;
  onSelect: (s: Selection) => void;
  onStartEdit: () => void;
  onCommitEdit: (value: string) => void;
  onCancelEdit: () => void;
  onReplaceField: (columnId: string, fieldId: FieldId) => void;
  onAddColumn: (fieldId: FieldId) => void;
  onMoveColumn: (columnId: string, toIndex: number) => void;
  onDropToken: (documentId: string, columnId: string, tokenId: string) => void;
  /** Open the candidate picker for the selected cell (single click, Space, Alt+↓). */
  onOpenPicker?: (anchor: HTMLElement) => void;
}

/** Delay before a single click opens the picker, so a double click can cancel it. */
export const PICKER_CLICK_DELAY = 220;

export function DataGrid(p: Props) {
  const { t, formatNumber } = useI18n();
  const { columns, cells } = p.state;
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClick = () => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = null;
  };
  useEffect(() => cancelClick, []);

  // Keep keyboard focus on the selected cell.
  useEffect(() => {
    if (!p.selection || p.editing) return;
    const el = tableRef.current?.querySelector<HTMLElement>(
      `[data-cell="${cellKey(p.selection.documentId, p.selection.columnId)}"]`,
    );
    if (el && document.activeElement !== el && tableRef.current?.contains(document.activeElement)) el.focus();
  }, [p.selection, p.editing]);

  const move = (dRow: number, dCol: number) => {
    if (!p.selection) {
      const d = p.documents[0];
      const c = columns[0];
      if (d && c) p.onSelect({ documentId: d.id, columnId: c.id });
      return;
    }
    const r = p.documents.findIndex((d) => d.id === p.selection!.documentId);
    const c = columns.findIndex((x) => x.id === p.selection!.columnId);
    const nr = Math.max(0, Math.min(p.documents.length - 1, r + dRow));
    const nc = Math.max(0, Math.min(columns.length - 1, c + dCol));
    p.onSelect({ documentId: p.documents[nr]!.id, columnId: columns[nc]!.id });
    requestAnimationFrame(() => {
      tableRef.current?.querySelector<HTMLElement>(`[data-cell="${cellKey(p.documents[nr]!.id, columns[nc]!.id)}"]`)?.focus();
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (p.editing) return;
    const map: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (map[e.key] && !e.altKey) {
      e.preventDefault();
      move(...map[e.key]!);
    } else if ((e.key === " " || (e.key === "ArrowDown" && e.altKey)) && p.selection && p.onOpenPicker) {
      e.preventDefault();
      const el = e.target as HTMLElement;
      if (el.dataset["cell"]) p.onOpenPicker(el);
    } else if ((e.key === "F2" || e.key === "Enter") && p.selection) {
      e.preventDefault();
      p.onStartEdit();
    } else if (e.key === "Tab" && p.selection) {
      e.preventDefault();
      move(0, e.shiftKey ? -1 : 1);
    }
  };

  const display = (cell: Cell, fieldId: FieldId) => {
    if (!cell.value) return <span className="text-muted-foreground/70">{t("editor.emptyCell")}</span>;
    if (getField(fieldId).valueType === "amount" && /^\d+$/.test(cell.value)) return formatNumber(Number(cell.value));
    return cell.value;
  };

  return (
    <table ref={tableRef} role="grid" aria-label={t("editor.gridRegion")} onKeyDown={onKeyDown} className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
      <thead className="sticky top-0 z-10 bg-secondary">
        <tr>
          <th scope="col" className="sticky left-0 z-20 h-8 w-10 border-b border-r border-grid-line bg-secondary px-2 text-left text-xs font-medium text-muted-foreground">
            #
          </th>
          {columns.map((col, i) => {
            const label = t(`fields.${col.fieldId}`);
            const isTarget = dropTarget === `h:${col.id}`;
            return (
              <th
                key={col.id}
                scope="col"
                data-column={col.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DND.column, col.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (hasType(e, DND.field) || hasType(e, DND.column)) {
                    e.preventDefault();
                    setDropTarget(`h:${col.id}`);
                  }
                }}
                onDragLeave={() => setDropTarget((d) => (d === `h:${col.id}` ? null : d))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropTarget(null);
                  const field = e.dataTransfer.getData(DND.field) as FieldId;
                  const moved = e.dataTransfer.getData(DND.column);
                  if (field) p.onReplaceField(col.id, field);
                  else if (moved) p.onMoveColumn(moved, i);
                }}
                className={cn(
                  "h-8 min-w-36 cursor-grab border-b border-r border-grid-line px-0 text-left text-xs font-medium text-muted-foreground",
                  p.selection?.columnId === col.id && "bg-accent/60 text-accent-foreground",
                  isTarget && "bg-accent shadow-[inset_0_-2px_0_var(--primary)]",
                )}
              >
                <div className="flex h-full items-center">
                  <span className="flex-1 truncate px-3">{label}</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger className="mr-1 rounded p-1 hover:bg-background" aria-label={t("editor.columnMenu", { field: label })}>
                      <ChevronDown className="size-3.5" aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>{t("editor.changeField")}</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="max-h-80 overflow-auto">
                          {FIELD_REGISTRY.map((f) => (
                            <DropdownMenuItem key={f.id} disabled={f.id === col.fieldId} onSelect={() => p.onReplaceField(col.id, f.id)}>
                              {t(f.labelKey)}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem disabled={i === 0} onSelect={() => p.onMoveColumn(col.id, i - 1)}>
                        {t("editor.moveLeft")}
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={i === columns.length - 1} onSelect={() => p.onMoveColumn(col.id, i + 1)}>
                        {t("editor.moveRight")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </th>
            );
          })}
          <th
            scope="col"
            onDragOver={(e) => {
              if (hasType(e, DND.field)) {
                e.preventDefault();
                setDropTarget("add");
              }
            }}
            onDragLeave={() => setDropTarget((d) => (d === "add" ? null : d))}
            onDrop={(e) => {
              e.preventDefault();
              setDropTarget(null);
              const field = e.dataTransfer.getData(DND.field) as FieldId;
              if (field) p.onAddColumn(field);
            }}
            className={cn("h-8 min-w-44 border-b border-grid-line px-1 text-left text-xs font-medium", dropTarget === "add" && "bg-accent")}
          >
            <DropdownMenu>
              <DropdownMenuTrigger
                title={t("editor.addColumnZone")}
                className="flex h-6 w-full items-center gap-1 rounded border border-dashed border-input px-2 text-muted-foreground hover:border-primary hover:text-primary"
              >
                <Plus className="size-3.5" aria-hidden /> {t("editor.addColumn")}
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-80 overflow-auto">
                {FIELD_REGISTRY.map((f) => (
                  <DropdownMenuItem key={f.id} onSelect={() => p.onAddColumn(f.id)}>
                    {t(f.labelKey)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </th>
        </tr>
      </thead>
      <tbody>
        {p.documents.map((doc, r) => (
          <tr key={doc.id} className="group">
            <th scope="row" className="sticky left-0 z-[1] h-8 border-b border-r border-grid-line bg-paper px-2 text-left text-xs font-normal text-muted-foreground tabular">
              {r + 1}
            </th>
            {columns.map((col) => {
              const k = cellKey(doc.id, col.id);
              const cell = cells[k];
              if (!cell) return <td key={col.id} className="border-b border-r border-grid-line" />;
              const selected = p.selection?.documentId === doc.id && p.selection.columnId === col.id;
              const dz = dropTarget === `c:${k}`;
              const crossDoc = dz && dragSession.tokenDocumentId !== null && dragSession.tokenDocumentId !== doc.id;
              return (
                <td
                  key={col.id}
                  role="gridcell"
                  data-cell={k}
                  data-review={cell.reviewState}
                  aria-selected={selected}
                  tabIndex={selected || (!p.selection && r === 0 && col === columns[0]) ? 0 : -1}
                  title={cell.flags.map((f) => t(`flags.${f}`)).join(" · ") || t(`review.${cell.reviewState}`)}
                  onClick={(e) => {
                    p.onSelect({ documentId: doc.id, columnId: col.id });
                    cancelClick();
                    if (e.detail > 1 || !p.onOpenPicker || (selected && p.editing)) return;
                    const el = e.currentTarget;
                    clickTimer.current = setTimeout(() => p.onOpenPicker?.(el), PICKER_CLICK_DELAY);
                  }}
                  onDoubleClick={() => {
                    cancelClick();
                    p.onSelect({ documentId: doc.id, columnId: col.id });
                    p.onStartEdit();
                  }}
                  onDragOver={(e) => {
                    if (!hasType(e, DND.token)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = dragSession.tokenDocumentId === doc.id ? "copy" : "none";
                    setDropTarget(`c:${k}`);
                  }}
                  onDragLeave={() => setDropTarget((d) => (d === `c:${k}` ? null : d))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDropTarget(null);
                    const tok = e.dataTransfer.getData(DND.token);
                    if (tok) p.onDropToken(doc.id, col.id, tok);
                  }}
                  className={cn(
                    "tabular relative h-8 max-w-72 truncate whitespace-nowrap border-b border-r border-grid-line px-3 outline-none group-hover:bg-secondary/50",
                    cell.reviewState === "needs_review" && "bg-review/15 shadow-[inset_2px_0_0_var(--review)]",
                    cell.reviewState === "confirmed" && "shadow-[inset_2px_0_0_var(--confirmed)]",
                    selected && "bg-accent/40 ring-2 ring-inset ring-selected",
                    dz && !crossDoc && "bg-accent ring-2 ring-inset ring-primary",
                    crossDoc && "bg-destructive/10 ring-2 ring-inset ring-destructive",
                  )}
                >
                  {selected && p.editing ? (
                    <CellEditor
                      initial={cell.value}
                      label={t("editor.editInputLabel", { field: t(`fields.${col.fieldId}`) })}
                      onCommit={p.onCommitEdit}
                      onCancel={p.onCancelEdit}
                    />
                  ) : (
                    display(cell, col.fieldId)
                  )}
                </td>
              );
            })}
            <td className="border-b border-grid-line" />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CellEditor({ initial, label, onCommit, onCancel }: { initial: string; label: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const done = useRef(false);
  return (
    <input
      autoFocus
      aria-label={label}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          done.current = true;
          onCommit(v);
        } else if (e.key === "Escape") {
          done.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (!done.current) onCommit(v);
      }}
      className="absolute inset-0 h-full w-full bg-paper px-3 text-[13px] outline-none ring-2 ring-inset ring-primary"
    />
  );
}
