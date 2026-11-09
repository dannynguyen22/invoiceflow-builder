import { useMemo, useState } from "react";
import type { FieldDefinition } from "@/domain/types";
import { GripVertical, MoreHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FIELD_GROUPS, fieldsInGroup } from "@/domain/fields";
import type { FieldId } from "@/domain/types";
import { DND } from "@/editor/dnd";
import { useI18n } from "@/i18n";
import { normalizeForSearch } from "@/lib/text";

interface Props {
  usedFields: Set<FieldId>;
  canReplace: boolean;
  onAdd: (f: FieldId) => void;
  onAddDuplicate: (f: FieldId) => void;
  onReplaceSelected: (f: FieldId) => void;
}

export function FieldsPanel({ usedFields, canReplace, onAdd, onAddDuplicate, onReplaceSelected }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const q = normalizeForSearch(query);
  const groups = useMemo(
    () =>
      FIELD_GROUPS.map((g) => ({
        g,
        fields: fieldsInGroup(g).filter((f) => !q || normalizeForSearch(t(f.labelKey)).includes(q) || f.id.includes(q)),
      })).filter((x) => x.fields.length),
    [q, t],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="p-3 pb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("editor.fieldsRegion")}</h2>
        <Input className="mt-2 h-8 text-sm" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("editor.searchFields")} aria-label={t("editor.searchFields")} />
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{t("editor.fieldDragHint")}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        {groups.length === 0 && <p className="mt-2 text-sm text-muted-foreground">{t("editor.noFieldsFound")}</p>}
        {groups.map(({ g, fields }) => (
          <div key={g} className="mt-3 first:mt-1">
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t(`fieldGroups.${g}`)}</h3>
            <ul className="mt-1.5 space-y-1">
              {fields.map((f) => (
                <li key={f.id}>
                  <FieldItem field={f} used={usedFields.has(f.id)} canReplace={canReplace} onAdd={onAdd} onAddDuplicate={onAddDuplicate} onReplaceSelected={onReplaceSelected} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function FieldItem({ field: f, used, canReplace, onAdd, onAddDuplicate, onReplaceSelected }: { field: FieldDefinition; used: boolean } & Omit<Props, "usedFields">) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    // The row is a native drag source; the menu is anchored to a separate trigger button so
    // the menu's pointerdown handling never blocks dragging. Clicking the row also opens it.
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <div
        draggable
        data-field={f.id}
        onClick={() => setOpen(true)}
        onDragStart={(e) => {
          setOpen(false);
          e.dataTransfer.setData(DND.field, f.id);
          e.dataTransfer.effectAllowed = "copy";
        }}
        className="flex w-full cursor-grab items-center gap-1.5 rounded-md border bg-paper py-0.5 pl-2 pr-0.5 text-[13px] hover:border-primary/50 hover:bg-accent/50 active:cursor-grabbing"
      >
        <GripVertical className="size-3.5 text-muted-foreground/60" aria-hidden />
        <span className="flex-1 select-none">{t(f.labelKey)}</span>
        {used && <span className="size-1.5 rounded-full bg-primary" aria-hidden />}
        <DropdownMenuTrigger
          onClick={(e) => e.stopPropagation()}
          aria-label={t("editor.fieldActions", { field: t(f.labelKey) })}
          className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
        >
          <MoreHorizontal className="size-3.5" aria-hidden />
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent align="start">
        {used ? (
          <DropdownMenuItem onSelect={() => onAddDuplicate(f.id)}>
            {t("editor.addDuplicateColumn")}
            <span className="ml-auto pl-3 text-[11px] text-muted-foreground">{t("editor.duplicateMenuHint")}</span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => onAdd(f.id)}>{t("editor.addColumn")}</DropdownMenuItem>
        )}
        <DropdownMenuItem disabled={!canReplace} onSelect={() => onReplaceSelected(f.id)}>
          {t("editor.replaceSelectedColumn")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
