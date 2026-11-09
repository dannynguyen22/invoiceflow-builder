import { useMemo, useState } from "react";
import { Info, ListChecks } from "lucide-react";
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
import { planBatchCorrection, type BatchPlan, type ErrorSignature } from "@/editor/smart";
import { useI18n } from "@/i18n";
import { OverrideConfirm, OverrideSwitch, ProposalGroup, ProposalRow } from "./SmartPreview";
import { useProposalSelection } from "./smart-ui";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  raw: RawExtraction;
  state: EditorState;
  referenceDocumentId: string;
  columnId: string;
  signature: ErrorSignature;
  /** `overrideIds` is non-empty only after the user enabled and confirmed protected-cell overrides. */
  onApply: (plan: BatchPlan, acceptDocumentIds: string[], overrideIds: string[]) => void;
}

/** Preview + confirm for Batch Correction (PRD §07). Shows before/after, reasons and source per cell. */
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
  const [allowOverride, setAllowOverride] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const docName = (id: string) => raw.documents.find((d) => d.id === id)?.name ?? id;

  const plan = useMemo(
    () =>
      open
        ? planBatchCorrection(raw, state, referenceDocumentId, columnId, signature, sameSupplier)
        : null,
    [open, raw, state, referenceDocumentId, columnId, signature, sameSupplier],
  );
  const ready = plan?.proposals.filter((p) => p.outcome === "matched") ?? [];
  const review = plan?.proposals.filter((p) => p.outcome === "review") ?? [];
  const protectedRows = plan?.protectedProposals ?? [];

  const planKey = `${sameSupplier}|${[...(plan?.proposals ?? []), ...protectedRows]
    .map((p) => `${p.documentId}:${p.outcome}:${p.after}`)
    .join(",")}`;
  const { ids, toggle } = useProposalSelection(
    planKey,
    ready.map((p) => p.documentId),
  );
  const protectedIds = new Set(protectedRows.map((p) => p.documentId));
  const selected = [...ids].filter((id) => allowOverride || !protectedIds.has(id));
  const overrideIds = selected.filter((id) => protectedIds.has(id));

  const close = (o: boolean) => {
    if (!o) {
      setAllowOverride(false);
      setConfirming(false);
    }
    onOpenChange(o);
  };
  const commit = () => {
    if (!plan) return;
    onApply(plan, selected, overrideIds);
    close(false);
  };
  const apply = () => (overrideIds.length ? setConfirming(true) : commit());
  const empty = ready.length + review.length + protectedRows.length === 0;

  return (
    <>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-3">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListChecks className="size-4" aria-hidden /> {t("batch.title")}
            </DialogTitle>
            <DialogDescription>
              {t("batch.description", { signature: t(`batch.signature.${signature}`) })}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 text-sm">
            {plan && (
              <p className="flex items-start gap-1.5 rounded-md border bg-accent/40 p-2.5 text-xs">
                <Info className="mt-px size-3.5 shrink-0 text-primary" aria-hidden />
                <span>
                  {plan.mode === "corrected" ? t("batch.modeCorrected") : t("batch.modeFlagged")}
                </span>
              </p>
            )}
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={sameSupplier}
                onCheckedChange={(v) => setSameSupplier(v === true)}
              />
              <span>{t("batch.signatureSupplier")}</span>
            </label>

            {empty && (
              <p className="rounded border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                {t("batch.none")}
              </p>
            )}

            {ready.length > 0 && (
              <ProposalGroup
                tone="ready"
                title={t("batch.groupReady", { count: ready.length })}
                hint={t("batch.groupReadyHint")}
              >
                {ready.map((p) => (
                  <ProposalRow
                    key={p.documentId}
                    name={docName(p.documentId)}
                    checked={ids.has(p.documentId)}
                    onToggle={() => toggle(p.documentId)}
                    before={p.before}
                    after={p.after}
                    grade="matched"
                    reasons={p.evidence.reasons}
                    source={p.evidence.source}
                    supplierMatch={p.supplierMatch}
                  />
                ))}
              </ProposalGroup>
            )}

            {review.length > 0 && (
              <ProposalGroup
                tone="review"
                title={t("batch.groupReview", { count: review.length })}
                hint={t("batch.groupReviewHint")}
              >
                {review.map((p) => (
                  <ProposalRow
                    key={p.documentId}
                    name={docName(p.documentId)}
                    checked={ids.has(p.documentId)}
                    onToggle={() => toggle(p.documentId)}
                    before={p.before}
                    after={p.after}
                    grade="review"
                    reasons={p.evidence.reasons}
                    source={p.evidence.source}
                    supplierMatch={p.supplierMatch}
                  />
                ))}
              </ProposalGroup>
            )}

            {protectedRows.length > 0 && (
              <ProposalGroup
                tone="protected"
                title={t("batch.groupProtected", { count: protectedRows.length })}
                hint={t("batch.groupProtectedHint")}
                extra={
                  <OverrideSwitch
                    checked={allowOverride}
                    onChange={setAllowOverride}
                    count={protectedRows.length}
                  />
                }
              >
                {allowOverride &&
                  protectedRows.map((p) => (
                    <ProposalRow
                      key={p.documentId}
                      name={docName(p.documentId)}
                      checked={ids.has(p.documentId)}
                      onToggle={() => toggle(p.documentId)}
                      before={p.before}
                      after={p.after}
                      grade="protected"
                      protection={p.protection}
                      reasons={p.evidence.reasons}
                      source={p.evidence.source}
                      supplierMatch={p.supplierMatch}
                    />
                  ))}
              </ProposalGroup>
            )}
            <p className="text-[11px] text-muted-foreground">{t("batch.protectedNote")}</p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => close(false)}>
              {t("batch.cancel")}
            </Button>
            <Button onClick={apply} disabled={selected.length === 0}>
              {overrideIds.length
                ? t("batch.applyOverride", {
                    count: selected.length,
                    protected: overrideIds.length,
                  })
                : t("batch.apply", { count: selected.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <OverrideConfirm
        open={confirming}
        count={overrideIds.length}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          commit();
        }}
      />
    </>
  );
}
