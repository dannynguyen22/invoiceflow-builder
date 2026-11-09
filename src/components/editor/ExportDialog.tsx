import { useMemo, useState } from "react";
import { Cloud, CloudUpload, Download, Laptop, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { EditorColumn, RawExtraction } from "@/domain/types";
import type { EditorState } from "@/editor/engine";
import { allIssues } from "@/domain/invoice-checks";
import { buildExportRows, runExport, type ExportScope } from "@/export";
import { useTemplates, type TemplateEntry } from "@/cloud/useTemplates";
import { headerOverridesFor, orderColumnsByTemplate } from "@/export/templates";
import { useI18n } from "@/i18n";

interface Props {
  raw: RawExtraction;
  state: EditorState;
  columns: EditorColumn[];
  disabled?: boolean;
}

/** Validation + options dialog for CSV/XLSX export (PRD §02 Export, §05, §14). */
export function ExportDialog({ raw, state, columns, disabled }: Props) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<ExportScope>("all");
  const [format, setFormat] = useState<"csv" | "xlsx">("xlsx");
  const [delimiter, setDelimiter] = useState<"," | ";" | "\t">(",");
  const [bom, setBom] = useState(true);
  const [templateName, setTemplateName] = useState("");
  const [syncAccount, setSyncAccount] = useState(true);
  // Column order / headers taken from an applied template; applied at export time only.
  const [shape, setShape] = useState<Pick<TemplateEntry, "name" | "fieldOrder" | "headers"> | null>(
    null,
  );
  const tpl = useTemplates(open);

  const applyTemplate = (entry: TemplateEntry) => {
    setFormat(entry.format.type);
    setDelimiter(entry.format.delimiter);
    setBom(entry.format.utf8Bom);
    setShape({ name: entry.name, fieldOrder: entry.fieldOrder, headers: entry.headers });
    toast.success(t("export.templateApplied", { name: entry.name }));
  };

  const onSaveTemplate = async () => {
    const name = templateName.trim();
    if (!name) return;
    const ok = await tpl.save(
      {
        name,
        format: { type: format, delimiter, utf8Bom: bom },
        fieldOrder: (shape ? orderColumnsByTemplate(columns, shape.fieldOrder) : columns).map(
          (c) => c.fieldId,
        ),
        headers: shape?.headers ?? {},
      },
      tpl.canSync && syncAccount ? "account" : "device",
    );
    if (ok) {
      setTemplateName("");
      toast.success(t("export.templateSaved", { name }));
    }
  };

  const onDeleteTemplate = async (entry: TemplateEntry) => {
    if (await tpl.remove(entry)) toast(t("export.templateDeleted"));
  };

  const onCopyToAccount = async (entry: TemplateEntry) => {
    if (await tpl.copyToAccount(entry))
      toast.success(t("export.copiedToAccount", { name: entry.name }));
  };

  const rows = useMemo(() => buildExportRows(raw, state, columns), [raw, state, columns]);
  const validCount = rows.filter((r) => r.valid).length;
  const total = rows.length;
  const issueCount = useMemo(
    () => new Set(allIssues(raw, state).map((i) => i.documentId)).size,
    [raw, state],
  );
  const hasNeedsReview = validCount < total;

  const doExport = () => {
    const exportColumns = shape ? orderColumnsByTemplate(columns, shape.fieldOrder) : columns;
    const result = runExport({
      raw,
      state,
      columns: exportColumns,
      locale,
      scope,
      format: { type: format, delimiter, utf8Bom: bom },
      ...(shape ? { headerOverrides: headerOverridesFor(exportColumns, shape.headers) } : {}),
    });
    if (result.rowCount === 0) {
      toast.error(t("export.emptyScope"));
      return;
    }
    toast.success(t("export.done", { count: result.rowCount, file: result.filename }));
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) toast.dismiss(); // keep toasts from covering the dialog's buttons
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="default"
          className="h-7 px-2"
          disabled={disabled}
          title={t("export.open")}
        >
          <Download aria-hidden /> <span className="hidden sm:inline">{t("export.open")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("export.title")}</DialogTitle>
          <DialogDescription>{t("export.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <p className="rounded bg-accent/60 px-2 py-1.5 text-xs text-muted-foreground">
            {t("export.summaryValid", { valid: validCount, total })}
            {issueCount > 0 && ` ${t("export.summaryIssues", { count: issueCount })}`}
          </p>
          {hasNeedsReview && (
            <p className="rounded bg-review/15 px-2 py-1.5 text-xs text-review-foreground">
              {t("export.warnNeedsReview")}
            </p>
          )}

          <fieldset>
            <legend className="mb-1.5 font-medium">{t("export.scopeTitle")}</legend>
            <RadioGroup value={scope} onValueChange={(v) => setScope(v as ExportScope)}>
              <label className="flex items-center gap-2">
                <RadioGroupItem value="all" /> {t("export.scopeAll", { count: total })}
              </label>
              <label className="flex items-center gap-2">
                <RadioGroupItem value="validated" />{" "}
                {t("export.scopeValidated", { count: validCount })}
              </label>
            </RadioGroup>
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 font-medium">{t("export.formatTitle")}</legend>
            <RadioGroup
              value={format}
              onValueChange={(v) => setFormat(v as "csv" | "xlsx")}
              className="grid-flow-col justify-start gap-4"
            >
              <label className="flex items-center gap-2">
                <RadioGroupItem value="xlsx" /> {t("export.formatXlsx")}
              </label>
              <label className="flex items-center gap-2">
                <RadioGroupItem value="csv" /> {t("export.formatCsv")}
              </label>
            </RadioGroup>
          </fieldset>

          {format === "csv" && (
            <div className="space-y-3">
              <fieldset>
                <legend className="mb-1.5 font-medium">{t("export.delimiterTitle")}</legend>
                <RadioGroup
                  value={delimiter}
                  onValueChange={(v) => setDelimiter(v as "," | ";" | "\t")}
                  className="grid-flow-col justify-start gap-4"
                >
                  <label className="flex items-center gap-2">
                    <RadioGroupItem value="," /> {t("export.delimiterComma")}
                  </label>
                  <label className="flex items-center gap-2">
                    <RadioGroupItem value=";" /> {t("export.delimiterSemicolon")}
                  </label>
                  <label className="flex items-center gap-2">
                    <RadioGroupItem value={"\t"} /> {t("export.delimiterTab")}
                  </label>
                </RadioGroup>
              </fieldset>
              <label className="flex items-center gap-2">
                <Checkbox checked={bom} onCheckedChange={(v) => setBom(v === true)} />
                <span>{t("export.bomLabel")}</span>
              </label>
            </div>
          )}

          <section className="space-y-2 border-t pt-3">
            <h3 className="font-medium">{t("export.templatesTitle")}</h3>
            {shape && (
              <p className="flex flex-wrap items-center gap-2 rounded bg-accent/60 px-2 py-1.5 text-xs">
                <span>{t("export.orderApplied", { name: shape.name })}</span>
                <button
                  type="button"
                  className="text-primary underline underline-offset-2"
                  onClick={() => setShape(null)}
                >
                  {t("export.orderClear")}
                </button>
              </p>
            )}
            {tpl.loading && (
              <p className="text-xs text-muted-foreground">{t("export.loadingTemplates")}</p>
            )}
            {tpl.error && (
              <p
                role="alert"
                className="rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
              >
                {t(`export.cloudError.${tpl.error}`)}
              </p>
            )}
            {tpl.entries.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("export.noTemplates")}</p>
            ) : (
              <ul className="space-y-1">
                {tpl.entries.map((entry) => (
                  <li
                    key={`${entry.location}:${entry.id}`}
                    className="flex items-center gap-2 rounded border px-2 py-1 text-xs"
                  >
                    <span
                      className="shrink-0 text-muted-foreground"
                      title={t(
                        entry.location === "account"
                          ? "export.locationAccount"
                          : "export.locationDevice",
                      )}
                    >
                      {entry.location === "account" ? (
                        <Cloud className="size-3.5" aria-hidden />
                      ) : (
                        <Laptop className="size-3.5" aria-hidden />
                      )}
                      <span className="sr-only">
                        {t(
                          entry.location === "account"
                            ? "export.locationAccount"
                            : "export.locationDevice",
                        )}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1 truncate" title={entry.name}>
                      {entry.name}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {entry.format.type.toUpperCase()}
                      {entry.format.type === "csv" && entry.format.utf8Bom ? " · BOM" : ""}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2"
                      onClick={() => applyTemplate(entry)}
                    >
                      {t("export.apply")}
                    </Button>
                    {entry.location === "device" && tpl.canSync && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1 text-muted-foreground"
                        onClick={() => void onCopyToAccount(entry)}
                        aria-label={t("export.copyToAccount")}
                        title={t("export.copyToAccount")}
                      >
                        <CloudUpload className="size-3.5" aria-hidden />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1 text-muted-foreground"
                      onClick={() => void onDeleteTemplate(entry)}
                      aria-label={t("export.delete")}
                      title={t("export.delete")}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2">
              <Input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder={t("export.templateName")}
                className="h-7 text-xs"
                aria-label={t("export.templateName")}
                maxLength={80}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void onSaveTemplate();
                }}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 px-2 text-xs"
                onClick={() => void onSaveTemplate()}
                disabled={!templateName.trim()}
              >
                <Save aria-hidden /> {t("export.saveTemplate")}
              </Button>
            </div>
            {tpl.canSync && (
              <label className="flex items-start gap-2 text-xs">
                <Checkbox
                  className="mt-0.5"
                  checked={syncAccount}
                  onCheckedChange={(v) => setSyncAccount(v === true)}
                />
                <span>
                  {t("export.syncToAccount")}
                  <span className="block text-[11px] text-muted-foreground">
                    {t("export.syncHint")}
                  </span>
                </span>
              </label>
            )}
            <p className="text-[11px] text-muted-foreground">{t("export.templateHint")}</p>
          </section>

          <p className="text-xs text-muted-foreground">{t("export.identifierNote")}</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t("export.cancel")}
          </Button>
          <Button onClick={doExport}>
            <Download aria-hidden /> {t("export.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
