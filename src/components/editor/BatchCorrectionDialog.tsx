import { useMemo, useState } from "react";
import { ListChecks } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { planBatchCorrection, type ErrorSignature } from "@/editor/smart";
import { useI18n } from "@/i18n";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  raw: RawExtraction;
  state: EditorState;
  referenceDocumentId: string;
  columnId: string;
  signature: ErrorSignature;
  onApply: (signature: ErrorSignature, sameSupplier: boolean, acceptDocumentIds: string[]) => void;
}

/** Preview + confirm for Batch Correction (PRD §07). Shows before/after for every affected cell. */
export function BatchCorrectionDialog({
  open,
  onOpenChange,
  raw,
  state,
  referenceDocumentId,
  columnId,
  signature,
  onApply,
}: Props) {
  const { t } = useI18n();
  const [sameSupplier, setSameSupplier] = useState(true);
  const plan = useMemo(
    () => planBatchCorrection(raw, state, referenceDocumentId, columnId, signature, sameSupplier),
    [raw, state, referenceDocumentId, columnId, signature, sameSupplier],
  );
  const docName = (id: string) => raw.documents.find((d) => d.id === id)?.name ?? id;

  const [accepted, setAccepted] = useState<Set<string>>(() => new Set());
  const planKey = `${sameSupplier}:${plan.proposals.map((p) => p.documentId).join(",")}`;
  const [lastKey, setLastKey] = useState(planKey);
  if (planKey !== lastKey) {
    setLastKey(planKey);
    setAccepted(new Set(plan.proposals.map((p) => p.documentId))); // default: all affected
  }

  const toggle = (id: string) =>
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = () => {
    const ids = [...accepted];
    if (!ids.length) {
      toast.error(t("batch.none"));
      return;
    }
    onApply(signature, sameSupplier, ids);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="size-4" aria-hidden /> {t("batch.title")}
          </DialogTitle>
          <DialogDescription>{t("batch.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <label className="flex items-center gap-2">
            <Checkbox checked={sameSupplier} onCheckedChange={(v) => setSameSupplier(v === true)} />
            <span>{t("batch.signatureSupplier")}</span>
          </label>

          <div className="max-h-64 overflow-auto rounded border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr>
                  <th className="w-8 px-2 py-1"></th>
                  <th className="px-2 py-1">{t("batch.colInvoice")}</th>
                  <th className="px-2 py-1">{t("batch.colBefore")}</th>
                  <th className="px-2 py-1">{t("batch.colAfter")}</th>
                </tr>
              </thead>
              <tbody>
                {plan.proposals.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-2 py-3 text-center text-muted-foreground">
                      {t("batch.none")}
                    </td>
                  </tr>
                ) : (
                  plan.proposals.map((p) => (
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
                      <td className="tabular max-w-[8rem] truncate px-2 py-1 text-destructive line-through">
                        {p.before || "—"}
                      </td>
                      <td className="tabular max-w-[10rem] truncate px-2 py-1 font-medium text-emerald-700 dark:text-emerald-400">
                        {p.after}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("batch.protectedNote")}</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("batch.cancel")}
          </Button>
          <Button onClick={apply} disabled={accepted.size === 0}>
            {t("batch.apply", { count: accepted.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
