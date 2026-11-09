import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Info, PanelRight, Redo2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DataGrid } from "@/components/editor/DataGrid";
import { FieldsPanel } from "@/components/editor/FieldsPanel";
import { CandidatePanel } from "@/components/editor/CandidatePanel";
import { DocumentPreview } from "@/components/editor/DocumentPreview";
import { KeyboardHelp } from "@/components/editor/KeyboardHelp";
import { DEFAULT_COLUMNS, FIXTURE_RAW } from "@/domain/fixtures";
import type { FieldId } from "@/domain/types";
import {
  addColumn,
  assignToken,
  cellKey,
  chooseCandidate,
  documentTokens,
  editCell,
  moveColumn,
  rankedCandidates,
  replaceColumnField,
  type CommandResult,
} from "@/editor/engine";
import { useEditor, type Selection } from "@/editor/useEditor";
import { useI18n, translate } from "@/i18n";

export const Route = createFileRoute("/workspace/editor")({
  head: () => ({
    meta: [
      { title: translate("vi", "meta.editorTitle") },
      { name: "description", content: translate("vi", "meta.editorDescription") },
      { property: "og:title", content: translate("vi", "meta.editorTitle") },
      { property: "og:description", content: translate("vi", "meta.editorDescription") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Editor,
});

const raw = FIXTURE_RAW;

function Editor() {
  const { t } = useI18n();
  const { state, run, undo, redo } = useEditor(raw, DEFAULT_COLUMNS);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [editing, setEditing] = useState(false);

  const report = useCallback(
    (r: CommandResult, success?: string) => {
      if (!r.ok) toast.error(t(`errors.${r.error}`));
      else if (success) toast.success(success);
      return r.ok;
    },
    [t],
  );

  // Drop selection if its column disappeared (e.g. undo of add column).
  useEffect(() => {
    if (selection && !state.columns.some((c) => c.id === selection.columnId)) {
      setSelection(null);
      setEditing(false);
    }
  }, [state.columns, selection]);

  const doUndo = useCallback(() => toast(t(undo() ? "editor.undone" : "editor.nothingToUndo")), [undo, t]);
  const doRedo = useCallback(() => toast(t(redo() ? "editor.redone" : "editor.nothingToRedo")), [redo, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        doUndo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        doRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo]);

  const fieldLabel = (f: FieldId) => t(`fields.${f}`);

  const onReplaceField = (columnId: string, fieldId: FieldId) => {
    const r = run((s) => replaceColumnField(s, columnId, fieldId));
    if (!r.ok) {
      report(r);
      return;
    }
    const flagged = Object.values(r.state.cells).filter((c) => c.columnId === columnId && c.reviewState === "needs_review").length;
    toast.success(t("editor.fieldReplaced", { field: fieldLabel(fieldId) }), {
      description: flagged ? t("editor.flaggedCount", { count: flagged }) : undefined,
      action: { label: t("editor.undo"), onClick: () => undo() },
    });
  };
  const onAddColumn = (fieldId: FieldId) => {
    const r = run((s) => addColumn(s, raw, fieldId));
    report(r, t("editor.columnAdded", { field: fieldLabel(fieldId) }));
  };
  const onMoveColumn = (columnId: string, toIndex: number) => report(run((s) => moveColumn(s, columnId, toIndex)));
  const onDropToken = (documentId: string, columnId: string, tokenId: string) => {
    setSelection({ documentId, columnId });
    const r = run((s) => assignToken(s, raw, documentId, columnId, tokenId));
    if (r.ok) report(r, t("editor.valueAssigned", { value: r.state.cells[cellKey(documentId, columnId)]!.value }));
    else report(r);
  };

  const selectedCell = selection ? state.cells[cellKey(selection.documentId, selection.columnId)] ?? null : null;
  const selectedColumn = selection ? state.columns.find((c) => c.id === selection.columnId) ?? null : null;
  const previewDocId = selection?.documentId ?? raw.documents[0]?.id ?? null;
  const previewDoc = raw.documents.find((d) => d.id === previewDocId) ?? null;
  const previewTokens = useMemo(() => (previewDocId ? documentTokens(raw, previewDocId) : []), [previewDocId]);
  const candidates = selection && selectedColumn ? rankedCandidates(raw, selection.documentId, selectedColumn.fieldId) : [];
  const usedFields = useMemo(() => new Set(state.columns.map((c) => c.fieldId)), [state.columns]);

  const fieldsPanel = (
    <FieldsPanel
      usedFields={usedFields}
      canReplace={!!selectedColumn}
      onAdd={onAddColumn}
      onReplaceSelected={(f) => selectedColumn && onReplaceField(selectedColumn.id, f)}
    />
  );

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <div role="toolbar" aria-label={t("editor.toolbarLabel")} className="flex items-center gap-2 border-b bg-paper px-3 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded bg-review/15 px-2 py-1 text-xs text-review-foreground">
          <Info className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {t("editor.fixtureNotice")} {t("editor.interactionsPending")}
          </span>
        </div>
        <span className="hidden text-xs text-muted-foreground sm:inline">{t("editor.invoiceCount", { count: raw.documents.length })}</span>
        <Button size="sm" variant="outline" className="h-7 px-2" onClick={doUndo} disabled={!state.past.length} aria-label={t("editor.undo")} title={t("editor.undo")}>
          <Undo2 aria-hidden />
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2" onClick={doRedo} disabled={!state.future.length} aria-label={t("editor.redo")} title={t("editor.redo")}>
          <Redo2 aria-hidden />
        </Button>
        <KeyboardHelp />
        <Sheet>
          <SheetTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 px-2 lg:hidden">
              <PanelRight aria-hidden /> {t("editor.openFields")}
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-80 p-0">
            <SheetTitle className="sr-only">{t("editor.fieldsRegion")}</SheetTitle>
            {fieldsPanel}
          </SheetContent>
        </Sheet>
      </div>

      <div className="flex min-h-0 flex-1">
        <ResizablePanelGroup orientation="vertical" className="min-w-0 flex-1">
          <ResizablePanel defaultSize="55%" minSize="20%">
            <section aria-label={t("editor.gridRegion")} className="h-full overflow-auto bg-paper">
              <DataGrid
                documents={raw.documents}
                state={state}
                selection={selection}
                editing={editing}
                onSelect={(s) => {
                  setSelection(s);
                  setEditing(false);
                }}
                onStartEdit={() => setEditing(true)}
                onCommitEdit={(v) => {
                  setEditing(false);
                  if (selection) report(run((s) => editCell(s, selection.documentId, selection.columnId, v)));
                }}
                onCancelEdit={() => setEditing(false)}
                onReplaceField={onReplaceField}
                onAddColumn={onAddColumn}
                onMoveColumn={onMoveColumn}
                onDropToken={onDropToken}
              />
            </section>
          </ResizablePanel>
          <ResizableHandle withHandle className="h-1.5 w-full cursor-row-resize bg-border hover:bg-primary/30" />
          <ResizablePanel defaultSize="45%" minSize="15%">
            <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] bg-background md:grid-cols-[minmax(260px,340px)_1fr] md:grid-rows-1">
              <section aria-label={t("editor.candidatesTitle")} className="min-h-0 border-b bg-paper md:border-b-0 md:border-r">
                <CandidatePanel
                  key={selection ? cellKey(selection.documentId, selection.columnId) : "none"}
                  cell={selectedCell}
                  columnField={selectedColumn?.fieldId ?? null}
                  candidates={candidates}
                  tokens={previewTokens}
                  onChooseCandidate={(c) => selection && report(run((s) => chooseCandidate(s, selection.documentId, selection.columnId, c)))}
                  onChooseToken={(id) => selection && onDropToken(selection.documentId, selection.columnId, id)}
                  onEdit={() => setEditing(true)}
                />
              </section>
              <section aria-label={t("editor.previewRegion")} className="min-h-0">
                <DocumentPreview
                  document={previewDoc}
                  tokens={previewTokens}
                  highlighted={new Set(selectedCell?.sourceTokenIds ?? [])}
                  canAssign={!!selection}
                  onTokenClick={(id) => selection && onDropToken(selection.documentId, selection.columnId, id)}
                />
              </section>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
        <aside aria-label={t("editor.fieldsRegion")} className="hidden w-64 shrink-0 border-l bg-sidebar lg:block">
          {fieldsPanel}
        </aside>
      </div>
    </div>
  );
}
