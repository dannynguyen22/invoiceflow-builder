import { useMemo, useState } from "react";
import { Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { RawExtraction } from "@/domain/types";
import type { EditorState } from "@/editor/engine";
import { planAutoFill, type AutoFillScope } from "@/editor/smart";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  raw: RawExtraction;
  state: EditorState;
  exampleDocumentId: string;
  columnId: string;
  /** Apply the accepted matched/review document ids as one atomic op. */
  onApply: (scope: AutoFillScope, acceptDocumentIds: string[]) => void;
}

/** Preview + confirm for Smart Auto-fill (PRD §06). Each row shows its OWN proposed value. */
export function AutoFillDialog({
  open,
  onOpenChange,
  raw,
  state,
  exampleDocumentId,
  columnId,
  onApply,
}: Props) {
  const { t } = useI18n();
  const [scope, setScope] = useState<AutoFillScope>("same_supplier");
  const column = state.columns.find((c) => c.id === columnId);
  const fieldLabel = column ? t(`fields.${column.fieldId}`) : "";

  const plan = useMemo(
    () => planAutoFill(raw, state, exampleDocumentId, columnId, scope),
    [raw, state, exampleDocumentId, columnId, scope],
  );
  const docName = (id: string) => raw.documents.find((d) => d.id === id)?.name ?? id;

  // Rows the user can accept: matched + review (both have a candidate). Default: accept matched only.
  const acceptable = plan.proposals.filter(
    (p) => p.outcome === "matched" || p.outcome === "review",
  );
  const [accepted, setAccepted] = useState<Set<string>>(() => new Set());
  // Reset accepted when the plan identity changes (scope switch): default to matched rows.
  const planKey = `${scope}:${plan.proposals.map((p) => p.documentId + p.outcome).join(",")}`;
  const [lastKey, setLastKey] = useState(planKey);
  if (planKey !== lastKey) {
    setLastKey(planKey);
    setAccepted(
      new Set(plan.proposals.filter((p) => p.outcome === "matched").map((p) => p.documentId)),
    );
  }

  const toggle = (id: string) => {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const apply = () => {
    const ids = [...accepted];
    if (!ids.length) {
      toast.error(t("autofill.none"));
      return;
    }
    onApply(scope, ids);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="size-4" aria-hidden /> {t("autofill.title")}
          </DialogTitle>
          <DialogDescription>{t("autofill.description", { field: fieldLabel })}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <fieldset>
            <legend className="mb-1.5 font-medium">{t("autofill.scopeTitle")}</legend>
            <RadioGroup
              value={scope}
              onValueChange={(v) => setScope(v as AutoFillScope)}
              className="grid-flow-col justify-start gap-4"
            >
              <label className="flex items-center gap-2">
                <RadioGroupItem value="same_supplier" /> {t("autofill.scopeSupplier")}
              </label>
              <label className="flex items-center gap-2">
                <RadioGroupItem value="similar_layout" /> {t("autofill.scopeLayout")}
              </label>
              <label className="flex items-center gap-2">
                <RadioGroupItem value="batch" /> {t("autofill.scopeBatch")}
              </label>
            </RadioGroup>
          </fieldset>

          <div className="flex flex-wrap gap-3 text-xs">
            <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-emerald-700 dark:text-emerald-400">
              {t("autofill.matched", { count: plan.counts.matched })}
            </span>
            <span className="rounded bg-review/20 px-2 py-0.5 text-review-foreground">
              {t("autofill.review", { count: plan.counts.review })}
            </span>
            <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">
              {t("autofill.notFound", { count: plan.counts.notFound })}
            </span>
          </div>

          <div className="max-h-64 overflow-auto rounded border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr>
                  <th className="w-8 px-2 py-1"></th>
                  <th className="px-2 py-1">{t("autofill.colInvoice")}</th>
                  <th className="px-2 py-1">{t("autofill.colCurrent")}</th>
                  <th className="px-2 py-1">{t("autofill.colProposed")}</th>
                  <th className="px-2 py-1">{t("autofill.colReason")}</th>
                </tr>
              </thead>
              <tbody>
                {acceptable.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-2 py-3 text-center text-muted-foreground">
                      {t("autofill.none")}
                    </td>
                  </tr>
                ) : (
                  acceptable.map((p) => (
                    <tr key={p.documentId} className="border-t">
                      <td className="px-2 py-1">
                        <Checkbox
                          checked={accepted.has(p.documentId)}
                          onCheckedChange={() => toggle(p.documentId)}
                          aria-label={docName(p.documentId)}
                        />
                      </td>
                      <td
                        className="max-w-[10rem] truncate px-2 py-1"
                        title={docName(p.documentId)}
                      >
                        {docName(p.documentId)}
                      </td>
                      <td className="tabular max-w-[8rem] truncate px-2 py-1 text-muted-foreground">
                        {p.currentValue || "—"}
                      </td>
                      <td
                        className={cn(
                          "tabular max-w-[10rem] truncate px-2 py-1 font-medium",
                          p.outcome === "review" && "text-review-foreground",
                        )}
                      >
                        {p.candidate?.value}
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">
                        {p.outcome === "review"
                          ? t("review.needs_review")
                          : t("autofill.matched", { count: 1 }).split(":")[0]}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("autofill.protectedNote")}</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("autofill.cancel")}
          </Button>
          <Button onClick={apply} disabled={accepted.size === 0}>
            {t("autofill.apply", { count: accepted.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
