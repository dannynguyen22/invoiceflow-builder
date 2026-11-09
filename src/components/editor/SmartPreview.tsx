import { useState, type ReactNode } from "react";
import { ArrowRight, Lock } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import type { Reason, SourceRef } from "@/editor/learning";
import type { ProtectionReason } from "@/editor/smart";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { reasonText, sourceText } from "./smart-ui";

/** A titled group of proposals (ready / review / protected). */
export function ProposalGroup({
  title,
  hint,
  tone,
  children,
  extra,
}: {
  title: string;
  hint?: string;
  tone: "ready" | "review" | "protected";
  children?: ReactNode;
  /** Rendered after the list (e.g. the override switch). */
  extra?: ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <header className="flex flex-wrap items-baseline gap-x-2">
        <h3
          className={cn(
            "text-xs font-semibold",
            tone === "ready" && "text-emerald-700 dark:text-emerald-400",
            tone === "review" && "text-review-foreground",
            tone === "protected" && "text-muted-foreground",
          )}
        >
          {title}
        </h3>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </header>
      {children && <ul className="space-y-1.5">{children}</ul>}
      {extra}
    </section>
  );
}

/** Reasons shown before the "+N more" toggle. */
const VISIBLE_REASONS = 4;

interface RowProps {
  name: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  before: string;
  after: string;
  grade: "matched" | "review" | "protected";
  protection?: ProtectionReason | null;
  reasons: Reason[];
  source: SourceRef | null;
  supplierMatch?: boolean;
  layoutPct?: number | null;
}

/** One document's proposal: clear before → after, why, and where on the invoice it came from. */
export function ProposalRow(p: RowProps) {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const reasons = p.reasons.map((r) => reasonText(t, r));
  const shown = showAll ? reasons : reasons.slice(0, VISIBLE_REASONS);
  const hidden = reasons.length - VISIBLE_REASONS;
  const src = sourceText(t, p.source);
  return (
    <li className="rounded-md border bg-background text-xs">
      <label className="flex cursor-pointer items-start gap-2 p-2">
        <Checkbox
          className="mt-0.5"
          checked={p.checked}
          disabled={p.disabled}
          onCheckedChange={p.onToggle}
          aria-label={p.name}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="max-w-full truncate font-medium" title={p.name}>
              {p.name}
            </span>
            <span
              className={cn(
                "rounded px-1.5 py-px text-[11px]",
                p.grade === "matched" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
                p.grade === "review" && "bg-review/20 text-review-foreground",
                p.grade === "protected" && "bg-muted text-muted-foreground",
              )}
            >
              {p.grade === "protected" && p.protection ? (
                <span className="inline-flex items-center gap-1">
                  <Lock className="size-3" aria-hidden /> {t(`smart.protection.${p.protection}`)}
                </span>
              ) : (
                t(`smart.grade.${p.grade}`)
              )}
            </span>
            {p.supplierMatch && (
              <span className="text-[11px] text-muted-foreground">{t("smart.supplierSame")}</span>
            )}
            {p.layoutPct != null && (
              <span className="text-[11px] text-muted-foreground">
                {t("smart.layoutPct", { pct: p.layoutPct })}
              </span>
            )}
          </div>
          <div className="tabular flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">{t("smart.before")}</span>
            <span
              className="max-w-[14rem] truncate rounded bg-destructive/10 px-1.5 py-0.5 text-destructive line-through"
              title={p.before}
            >
              {p.before || t("smart.empty")}
            </span>
            <ArrowRight className="size-3 text-muted-foreground" aria-hidden />
            <span className="text-muted-foreground">{t("smart.after")}</span>
            <span
              className="max-w-[14rem] truncate rounded bg-emerald-500/15 px-1.5 py-0.5 font-medium text-emerald-800 dark:text-emerald-300"
              title={p.after}
            >
              {p.after}
            </span>
          </div>
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">{t("smart.reasons")}: </span>
            {shown.join(" · ")}
            {hidden > 0 && (
              <button
                type="button"
                className="ml-1.5 text-primary underline underline-offset-2"
                onClick={(e) => {
                  e.preventDefault(); // inside the row's <label>: do not toggle the checkbox
                  setShowAll((v) => !v);
                }}
              >
                {showAll ? t("smart.lessReasons") : t("smart.moreReasons", { count: hidden })}
              </button>
            )}
          </p>
          <p className="truncate text-muted-foreground" title={src}>
            <span className="font-medium text-foreground">{t("smart.source")}: </span>
            {src}
          </p>
        </div>
      </label>
    </li>
  );
}

/** Off by default. Reveals protected rows so each can be chosen individually. */
export function OverrideSwitch({
  checked,
  onChange,
  count,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  count: number;
}) {
  const { t } = useI18n();
  if (count === 0) return null;
  return (
    <label className="flex items-start gap-2 rounded-md border border-dashed p-2 text-xs">
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      <span>
        <span className="font-medium">{t("smart.override.label")}</span>
        <span className="block text-muted-foreground">{t("smart.override.hint")}</span>
      </span>
    </label>
  );
}

/** Explicit confirmation before protected cells are overwritten. */
export function OverrideConfirm({
  open,
  count,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("smart.override.confirmTitle", { count })}</AlertDialogTitle>
          <AlertDialogDescription>{t("smart.override.confirmBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("smart.override.confirmCancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {t("smart.override.confirmAction", { count })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
