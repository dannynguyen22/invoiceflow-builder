import { useEffect, useMemo, useState } from "react";
import { Download, Save, Trash2 } from "lucide-react";
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
import {
  deleteTemplate,
  listTemplates,
  saveTemplate,
  type SavedExportTemplate,
} from "@/export/templates";
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
  const [templates, setTemplates] = useState<SavedExportTemplate[]>([]);
  const [templateName, setTemplateName] = useState("");

  // Load saved templates when the dialog opens (client-only; localStorage).
  useEffect(() => {
    if (open) setTemplates(listTemplates());
  }, [open]);

  const applyTemplate = (tpl: SavedExportTemplate) => {
    setFormat(tpl.format.type);
    setDelimiter(tpl.format.delimiter);
    setBom(tpl.format.utf8Bom);
    toast.success(t("export.templateApplied", { name: tpl.name }));
  };

  const onSaveTemplate = () => {
    const name = templateName.trim();
    if (!name) return;
    saveTemplate({
      name,
      format: { type: format, delimiter, utf8Bom: bom },
      fieldOrder: columns.map((c) => c.fieldId),
      headers: {},
    });
    setTemplates(listTemplates());
    setTemplateName("");
    toast.success(t("export.templateSaved", { name }));
  };

  const onDeleteTemplate = (id: string) => {
    deleteTemplate(id);
    setTemplates(listTemplates());
    toast(t("export.templateDeleted"));
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
    const result = runExport({
      raw,
      state,
      columns,
      locale,
      scope,
      format: { type: format, delimiter, utf8Bom: bom },
    });
    if (result.rowCount === 0) {
      toast.error(t("export.emptyScope"));
      return;
    }
    toast.success(t("export.done", { count: result.rowCount, file: result.filename }));
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
            {templates.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("export.noTemplates")}</p>
            ) : (
              <ul className="space-y-1">
                {templates.map((tpl) => (
                  <li
                    key={tpl.id}
                    className="flex items-center gap-2 rounded border px-2 py-1 text-xs"
                  >
                    <span className="flex-1 truncate" title={tpl.name}>
                      {tpl.name}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {tpl.format.type.toUpperCase()}
                      {tpl.format.type === "csv" && tpl.format.utf8Bom ? " · BOM" : ""}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2"
                      onClick={() => applyTemplate(tpl)}
                    >
                      {t("export.apply")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1 text-muted-foreground"
                      onClick={() => onDeleteTemplate(tpl.id)}
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
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSaveTemplate();
                }}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 px-2 text-xs"
                onClick={onSaveTemplate}
                disabled={!templateName.trim()}
              >
                <Save aria-hidden /> {t("export.saveTemplate")}
              </Button>
            </div>
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
