import { useMemo, useState } from "react";
import { Info, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { LAYOUT_SIMILAR_MIN } from "@/editor/learning";
import {
  canLearnField,
  isOverridable,
  planAutoFill,
  type AutoFillPlan,
  type AutoFillScope,
} from "@/editor/smart";
import { useI18n } from "@/i18n";
import { OverrideConfirm, OverrideSwitch, ProposalGroup, ProposalRow } from "./SmartPreview";
import { sourceText, useProposalSelection } from "./smart-ui";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  raw: RawExtraction;
  state: EditorState;
  exampleDocumentId: string;
  columnId: string;
  /**
   * Apply the chosen rows as one atomic op. `overrideIds` is non-empty only after the user turned on
   * the protected-cell option AND confirmed the overwrite.
   */
  onApply: (plan: AutoFillPlan, acceptDocumentIds: string[], overrideIds: string[]) => void;
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
  const [allowOverride, setAllowOverride] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const column = state.columns.find((c) => c.id === columnId);
  const fieldLabel = column ? t(`fields.${column.fieldId}`) : "";
  const docName = (id: string) => raw.documents.find((d) => d.id === id)?.name ?? id;

  const plan = useMemo(
    () => (open ? planAutoFill(raw, state, exampleDocumentId, columnId, scope) : null),
    [open, raw, state, exampleDocumentId, columnId, scope],
  );
  const rows = plan?.proposals ?? [];
  const ready = rows.filter((p) => p.outcome === "matched");
  const review = rows.filter((p) => p.outcome === "review");
  const protectedRows = rows.filter(isOverridable);
  const notFound = rows.filter((p) => p.outcome === "not_found");

  const planKey = `${scope}|${rows.map((p) => `${p.documentId}:${p.outcome}:${p.candidate?.value ?? ""}`).join(",")}`;
  const { ids, toggle } = useProposalSelection(
    planKey,
    ready.map((p) => p.documentId),
  );
  // Protected rows count only while the override option is on.
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

  const learned = plan?.learned;
  const anchor = learned?.anchors[0];
  const place = learned?.sourcePath
    ? t("autofill.placeXml")
    : anchor
      ? anchor.relation === "same_line"
        ? t("autofill.placeSameLine")
        : t("autofill.placeBelow")
      : null;
  const profile = learned?.profile;
  const unsupported = column ? !canLearnField(column.fieldId) : false;
  const pct = (n: number) => Math.round(n * 100);

  const scopes: { value: AutoFillScope; label: string; hint: string }[] = [
    {
      value: "same_supplier",
      label: t("autofill.scopeSupplier"),
      hint: t("autofill.scopeSupplierHint"),
    },
    {
      value: "similar_layout",
      label: t("autofill.scopeLayout"),
      hint: t("autofill.scopeLayoutHint", { pct: pct(LAYOUT_SIMILAR_MIN) }),
    },
    { value: "batch", label: t("autofill.scopeBatch"), hint: t("autofill.scopeBatchHint") },
  ];

  return (
    <>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-3">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="size-4" aria-hidden /> {t("autofill.title")}
            </DialogTitle>
            <DialogDescription>
              {t("autofill.description", { field: fieldLabel, doc: docName(exampleDocumentId) })}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 text-sm">
            {unsupported && (
              <p className="rounded bg-review/15 px-2 py-1.5 text-xs text-review-foreground">
                {t("autofill.unsupportedField")}
              </p>
            )}

            {learned && (
              <section
                aria-label={t("autofill.learnedTitle")}
                className="rounded-md border bg-accent/40 p-2.5 text-xs"
              >
                <h3 className="mb-1.5 flex items-center gap-1.5 font-semibold">
                  <Info className="size-3.5 text-primary" aria-hidden />{" "}
                  {t("autofill.learnedTitle")}
                </h3>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">{t("autofill.learnedValue")}</dt>
                  <dd className="tabular truncate font-medium" title={learned.value}>
                    {learned.value}
                  </dd>
                  <dt className="text-muted-foreground">{t("autofill.learnedSource")}</dt>
                  <dd className="truncate" title={sourceText(t, learned.source)}>
                    {sourceText(t, learned.source)}
                  </dd>
                  <dt className="text-muted-foreground">{t("autofill.learnedLabel")}</dt>
                  <dd className="truncate" title={anchor?.text}>
                    {anchor
                      ? `“${anchor.text.replace(/[:\s]+$/, "")}”`
                      : t("autofill.learnedNoLabel")}
                  </dd>
                  {place && (
                    <>
                      <dt className="text-muted-foreground">{t("autofill.learnedPlace")}</dt>
                      <dd>{place}</dd>
                    </>
                  )}
                  {learned.section && (
                    <>
                      <dt className="text-muted-foreground">{t("autofill.learnedSection")}</dt>
                      <dd>{t(`smart.section.${learned.section}`)}</dd>
                    </>
                  )}
                  {profile && (
                    <>
                      <dt className="text-muted-foreground">{t("autofill.learnedLayout")}</dt>
                      <dd>
                        {t("autofill.layoutValue", {
                          source: t(`smart.source_type.${profile.source}`),
                          pages: profile.pages,
                          labels:
                            profile.source === "xml" ? profile.paths.length : profile.labels.length,
                        })}
                      </dd>
                    </>
                  )}
                </dl>
                {learned.locatedBy === "none" && (
                  <p className="mt-2 rounded bg-review/15 px-2 py-1 text-review-foreground">
                    {t("autofill.unlocated")}
                  </p>
                )}
                {learned.locatedBy !== "none" && !learned.registryAgrees && (
                  <p className="mt-2 rounded bg-muted px-2 py-1 text-muted-foreground">
                    {t("autofill.registryDiffers")}
                  </p>
                )}
              </section>
            )}

            <fieldset>
              <legend className="mb-1.5 text-xs font-semibold">{t("autofill.scopeTitle")}</legend>
              <RadioGroup
                value={scope}
                onValueChange={(v) => setScope(v as AutoFillScope)}
                className="grid gap-2 sm:grid-cols-3"
              >
                {scopes.map((s) => (
                  <label
                    key={s.value}
                    className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent/40"
                  >
                    <RadioGroupItem value={s.value} className="mt-0.5" />
                    <span>
                      <span className="block font-medium">{s.label}</span>
                      <span className="block text-muted-foreground">{s.hint}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
              {plan && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t("autofill.inScope", { count: rows.length - 1 })}
                  {plan.outOfScope > 0 &&
                    ` ${t("autofill.outOfScope", { count: plan.outOfScope })}`}
                </p>
              )}
            </fieldset>

            {ready.length + review.length + protectedRows.length === 0 && (
              <p className="rounded border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                {t("autofill.none")}
              </p>
            )}

            {ready.length > 0 && (
              <ProposalGroup
                tone="ready"
                title={t("autofill.groupReady", { count: ready.length })}
                hint={t("autofill.groupReadyHint")}
              >
                {ready.map((p) => (
                  <ProposalRow
                    key={p.documentId}
                    name={docName(p.documentId)}
                    checked={ids.has(p.documentId)}
                    onToggle={() => toggle(p.documentId)}
                    before={p.currentValue}
                    after={p.candidate?.value ?? ""}
                    grade="matched"
                    reasons={p.evidence?.reasons ?? []}
                    source={p.evidence?.source ?? null}
                    supplierMatch={p.supplierMatch}
                    layoutPct={pct(p.layoutSimilarity)}
                  />
                ))}
              </ProposalGroup>
            )}

            {review.length > 0 && (
              <ProposalGroup
                tone="review"
                title={t("autofill.groupReview", { count: review.length })}
                hint={t("autofill.groupReviewHint")}
              >
                {review.map((p) => (
                  <ProposalRow
                    key={p.documentId}
                    name={docName(p.documentId)}
                    checked={ids.has(p.documentId)}
                    onToggle={() => toggle(p.documentId)}
                    before={p.currentValue}
                    after={p.candidate?.value ?? ""}
                    grade="review"
                    reasons={p.evidence?.reasons ?? []}
                    source={p.evidence?.source ?? null}
                    supplierMatch={p.supplierMatch}
                    layoutPct={pct(p.layoutSimilarity)}
                  />
                ))}
              </ProposalGroup>
            )}

            {protectedRows.length > 0 && (
              <ProposalGroup
                tone="protected"
                title={t("autofill.groupProtected", { count: protectedRows.length })}
                hint={t("autofill.groupProtectedHint")}
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
                      before={p.currentValue}
                      after={p.candidate?.value ?? ""}
                      grade="protected"
                      protection={p.protection}
                      reasons={p.evidence?.reasons ?? []}
                      source={p.evidence?.source ?? null}
                      supplierMatch={p.supplierMatch}
                      layoutPct={pct(p.layoutSimilarity)}
                    />
                  ))}
              </ProposalGroup>
            )}

            {plan && plan.counts.unchanged > 0 && (
              <p className="text-[11px] text-muted-foreground">
                {t("autofill.unchanged", { count: plan.counts.unchanged })}
              </p>
            )}
            {notFound.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                <span className="font-medium">
                  {t("autofill.groupNotFound", { count: notFound.length })}.{" "}
                </span>
                {t("autofill.notFoundNames", {
                  names: notFound.map((p) => docName(p.documentId)).join(", "),
                })}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">{t("autofill.protectedNote")}</p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => close(false)}>
              {t("autofill.cancel")}
            </Button>
            <Button onClick={apply} disabled={selected.length === 0 || unsupported}>
              {overrideIds.length
                ? t("autofill.applyOverride", {
                    count: selected.length,
                    protected: overrideIds.length,
                  })
                : t("autofill.apply", { count: selected.length })}
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
