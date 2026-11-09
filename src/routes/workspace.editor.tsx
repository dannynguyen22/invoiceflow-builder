import { createFileRoute, Link, useHydrated } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Info, Lightbulb, PanelLeft, PanelRight, Redo2, Undo2, Upload, Filter } from "lucide-react";
import { useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DataGrid } from "@/components/editor/DataGrid";
import { FieldsPanel } from "@/components/editor/FieldsPanel";
import { CandidatePanel } from "@/components/editor/CandidatePanel";
import { DocumentPreview } from "@/components/editor/DocumentPreview";
import { KeyboardHelp } from "@/components/editor/KeyboardHelp";
import { CellPicker } from "@/components/editor/CellPicker";
import { ExportDialog } from "@/components/editor/ExportDialog";
import { AutoFillDialog } from "@/components/editor/AutoFillDialog";
import { BatchCorrectionDialog } from "@/components/editor/BatchCorrectionDialog";
import { EditorTips, useTipsDismissed } from "@/components/editor/EditorTips";
import { DEFAULT_COLUMNS, FIXTURE_RAW } from "@/domain/fixtures";
import type { FieldId, RawExtraction } from "@/domain/types";
import { buildRaw } from "@/extraction/store";
import { useUploads } from "@/extraction/useUploads";
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
  setVerified,
  type CommandResult,
} from "@/editor/engine";
import { useEditor, type Selection } from "@/editor/useEditor";
import {
  applyAutoFill,
  applyBatchCorrection,
  planAutoFill,
  planBatchCorrection,
  type AutoFillScope,
  type ErrorSignature,
} from "@/editor/smart";
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

/** Uses the documents processed in this browser session; falls back to labelled sample data. */
function Editor() {
  const items = useUploads();
  const real = useMemo(() => buildRaw(items), [items]);
  const isSample = real.documents.length === 0;
  const raw = isSample ? FIXTURE_RAW : real;
  const pageImages = useMemo(
    () => Object.fromEntries(items.map((i) => [i.id, i.result?.pageImages ?? []])),
    [items],
  );
  // New documents → fresh editor state (the engine state is per document set).
  const key = raw.documents.map((d) => d.id).join("|");
  return <EditorView key={key} raw={raw} isSample={isSample} pageImages={pageImages} />;
}

function EditorView({
  raw,
  isSample,
  pageImages,
}: {
  raw: RawExtraction;
  isSample: boolean;
  pageImages: Record<string, string[]>;
}) {
  const { t } = useI18n();
  const { state, run, apply, undo, redo } = useEditor(raw, DEFAULT_COLUMNS);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [editing, setEditing] = useState(false);
  const [autoFillOpen, setAutoFillOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  const [previewOverride, setPreviewOverride] = useState<string[] | null>(null);
  const [tipsDismissed, setTipsDismissed] = useTipsDismissed();
  const candidatesPanel = usePanelRef();
  const [candidatesCollapsed, setCandidatesCollapsed] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const closePicker = useCallback(() => {
    setPickerAnchor((a) => {
      a?.focus();
      return null;
    });
    setPreviewOverride(null);
  }, []);

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

  const doUndo = useCallback(
    () => toast(t(undo() ? "editor.undone" : "editor.nothingToUndo")),
    [undo, t],
  );
  const doRedo = useCallback(
    () => toast(t(redo() ? "editor.redone" : "editor.nothingToRedo")),
    [redo, t],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable))
        return;
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
    const flagged = Object.values(r.state.cells).filter(
      (c) => c.columnId === columnId && c.reviewState === "needs_review",
    ).length;
    toast.success(t("editor.fieldReplaced", { field: fieldLabel(fieldId) }), {
      description: flagged ? t("editor.flaggedCount", { count: flagged }) : undefined,
      action: { label: t("editor.undo"), onClick: () => undo() },
    });
  };
  const onAddColumn = (fieldId: FieldId, allowDuplicate = false) => {
    const r = run((s) => addColumn(s, raw, fieldId, { allowDuplicate }));
    if (!r.ok && r.error === "duplicate_column") {
      // Intentional duplicates stay possible, but only through an explicit second action.
      toast.warning(t("editor.duplicateColumn", { field: fieldLabel(fieldId) }), {
        action: {
          label: t("editor.duplicateAddAnyway"),
          onClick: () => onAddColumn(fieldId, true),
        },
      });
      return;
    }
    report(r, t("editor.columnAdded", { field: fieldLabel(fieldId) }));
  };
  const onMoveColumn = (columnId: string, toIndex: number) =>
    report(run((s) => moveColumn(s, columnId, toIndex)));
  const onDropToken = (documentId: string, columnId: string, tokenId: string) => {
    setSelection({ documentId, columnId });
    const r = run((s) => assignToken(s, raw, documentId, columnId, tokenId));
    if (r.ok)
      report(
        r,
        t("editor.valueAssigned", { value: r.state.cells[cellKey(documentId, columnId)]!.value }),
      );
    else report(r);
  };

  const selectedCell = selection
    ? (state.cells[cellKey(selection.documentId, selection.columnId)] ?? null)
    : null;
  const selectedColumn = selection
    ? (state.columns.find((c) => c.id === selection.columnId) ?? null)
    : null;

  // Smart Auto-fill: learn from the selected cell, propose each other invoice's own value.
  const onApplyAutoFill = (scope: AutoFillScope, acceptIds: string[]) => {
    if (!selection) return;
    const plan = planAutoFill(raw, state, selection.documentId, selection.columnId, scope);
    const next = apply((s) => applyAutoFill(raw, s, plan, acceptIds).state);
    const filled = acceptIds.length;
    toast.success(t("autofill.done", { count: filled }), {
      action: { label: t("autofill.undo"), onClick: () => undo() },
    });
    void next;
  };
  // Batch Correction: fix other cells that share the selected cell's error signature.
  const onApplyBatch = (signature: ErrorSignature, sameSupplier: boolean, acceptIds: string[]) => {
    if (!selection) return;
    const plan = planBatchCorrection(
      raw,
      state,
      selection.documentId,
      selection.columnId,
      signature,
      sameSupplier,
    );
    apply((s) => applyBatchCorrection(raw, s, plan, acceptIds).state);
    toast.success(t("batch.done", { count: acceptIds.length }), {
      action: { label: t("editor.undo"), onClick: () => undo() },
    });
  };
  // The batch signature is the selected cell's first fixable flaw.
  const batchSignature: ErrorSignature = selectedCell?.flags.includes("invalid_format")
    ? "invalid_format"
    : "missing";

  const previewDocId = selection?.documentId ?? raw.documents[0]?.id ?? null;
  const previewDoc = raw.documents.find((d) => d.id === previewDocId) ?? null;
  const previewTokens = useMemo(
    () => (previewDocId ? documentTokens(raw, previewDocId) : []),
    [raw, previewDocId],
  );
  const candidates =
    selection && selectedColumn
      ? rankedCandidates(raw, selection.documentId, selectedColumn.fieldId)
      : [];
  const usedFields = useMemo(() => new Set(state.columns.map((c) => c.fieldId)), [state.columns]);

  const fieldsPanel = (
    <FieldsPanel
      usedFields={usedFields}
      canReplace={!!selectedColumn}
      onAdd={(f) => onAddColumn(f)}
      onAddDuplicate={(f) => onAddColumn(f, true)}
      onReplaceSelected={(f) => selectedColumn && onReplaceField(selectedColumn.id, f)}
    />
  );

  const showAllCandidates = () => {
    closePicker();
    if (candidatesPanel.current?.isCollapsed()) candidatesPanel.current.expand();
    requestAnimationFrame(() => searchRef.current?.focus());
  };
  const toggleCandidates = () => {
    const p = candidatesPanel.current;
    if (!p) return;
    if (p.isCollapsed()) p.expand();
    else p.collapse();
  };
  const highlighted = new Set(previewOverride ?? selectedCell?.sourceTokenIds ?? []);
  const needsReviewCount = useMemo(
    () => Object.values(state.cells).filter((c) => c.reviewState === "needs_review").length,
    [state.cells],
  );

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col">
      <div
        role="toolbar"
        aria-label={t("editor.toolbarLabel")}
        className="flex items-center gap-2 border-b bg-paper px-3 py-1.5"
      >
        {isSample ? (
          <div
            className="flex min-w-0 flex-1 items-center gap-2 rounded bg-review/15 px-2 py-1 text-xs text-review-foreground"
            title={t("editor.fixtureNotice")}
          >
            <Info className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{t("editor.fixtureNotice")}</span>
          </div>
        ) : (
          <div
            className="flex min-w-0 flex-1 items-center gap-2 rounded bg-accent/60 px-2 py-1 text-xs"
            title={t("editor.noCandidatesYet")}
          >
            <Info className="size-3.5 shrink-0 text-primary" aria-hidden />
            <span className="truncate">
              {t("editor.realDataNotice", { count: raw.documents.length })}{" "}
              {t("editor.noCandidatesYet")}
            </span>
          </div>
        )}
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {t("editor.invoiceCount", { count: raw.documents.length })}
        </span>
        <Button size="sm" variant="outline" className="h-7 px-2" asChild>
          <Link
            to="/workspace"
            title={t("editor.backToUpload")}
            aria-label={t("editor.backToUpload")}
          >
            <Upload aria-hidden />
          </Link>
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          onClick={doUndo}
          disabled={!state.past.length}
          aria-label={t("editor.undo")}
          title={t("editor.undo")}
        >
          <Undo2 aria-hidden />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          onClick={doRedo}
          disabled={!state.future.length}
          aria-label={t("editor.redo")}
          title={t("editor.redo")}
        >
          <Redo2 aria-hidden />
        </Button>
        <Button
          size="sm"
          variant={reviewOnly ? "secondary" : "outline"}
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => setReviewOnly((v) => !v)}
          aria-pressed={reviewOnly}
          title={t("review.filterLabel")}
        >
          <Filter aria-hidden />
          <span className="hidden sm:inline">
            {needsReviewCount > 0
              ? t("review.needsReviewCount", { count: needsReviewCount })
              : t("review.allClear")}
          </span>
        </Button>
        <Button
          size="sm"
          variant={candidatesCollapsed ? "outline" : "secondary"}
          className="hidden h-7 px-2 md:inline-flex"
          onClick={toggleCandidates}
          aria-pressed={!candidatesCollapsed}
          aria-label={t("editor.toggleCandidates")}
          title={t("editor.toggleCandidates")}
        >
          <PanelLeft aria-hidden />
        </Button>
        {tipsDismissed && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => setTipsDismissed(false)}
            aria-label={t("tips.show")}
            title={t("tips.show")}
          >
            <Lightbulb aria-hidden />
          </Button>
        )}
        <KeyboardHelp />
        <ExportDialog raw={raw} state={state} columns={state.columns} />
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
      {!tipsDismissed && <EditorTips onDismiss={() => setTipsDismissed(true)} />}

      <div className="flex min-h-0 flex-1">
        <EditorPanels
          collapsedRef={candidatesPanel}
          onCandidatesCollapsed={setCandidatesCollapsed}
          grid={
            <section aria-label={t("editor.gridRegion")} className="h-full overflow-auto bg-paper">
              <DataGrid
                documents={raw.documents}
                state={state}
                selection={selection}
                editing={editing}
                reviewOnly={reviewOnly}
                onSelect={(s) => {
                  setSelection(s);
                  setEditing(false);
                  if (
                    pickerAnchor &&
                    (s.documentId !== selection?.documentId || s.columnId !== selection?.columnId)
                  )
                    closePicker();
                }}
                onOpenPicker={(el) => setPickerAnchor(el)}
                onStartEdit={() => {
                  setPickerAnchor(null);
                  setPreviewOverride(null);
                  setEditing(true);
                }}
                onCommitEdit={(v) => {
                  setEditing(false);
                  if (selection)
                    report(run((s) => editCell(s, selection.documentId, selection.columnId, v)));
                }}
                onCancelEdit={() => setEditing(false)}
                onReplaceField={onReplaceField}
                onAddColumn={(f) => onAddColumn(f)}
                onMoveColumn={onMoveColumn}
                onDropToken={onDropToken}
              />
            </section>
          }
          candidates={
            <section aria-label={t("editor.candidatesTitle")} className="h-full min-h-0 bg-paper">
              <CandidatePanel
                key={selection ? cellKey(selection.documentId, selection.columnId) : "none"}
                cell={selectedCell}
                columnField={selectedColumn?.fieldId ?? null}
                candidates={candidates}
                tokens={previewTokens}
                searchRef={searchRef}
                onChooseCandidate={(c) =>
                  selection &&
                  report(
                    run((s) =>
                      chooseCandidate(s, raw, selection.documentId, selection.columnId, c),
                    ),
                  )
                }
                onToggleVerified={(v) =>
                  selection &&
                  report(
                    run((s) => setVerified(s, selection.documentId, selection.columnId, v)),
                    t(v ? "editor.verified" : "editor.unverifiedToast"),
                  )
                }
                onChooseToken={(id) =>
                  selection && onDropToken(selection.documentId, selection.columnId, id)
                }
                onEdit={() => setEditing(true)}
                onAutoFill={() => selection && selectedCell?.value.trim() && setAutoFillOpen(true)}
                onBatchCorrect={() => selection && setBatchOpen(true)}
              />
            </section>
          }
          preview={
            <section
              aria-label={t("editor.previewRegion")}
              className="h-full min-h-0 min-w-0 bg-background"
            >
              <DocumentPreview
                document={previewDoc}
                tokens={previewTokens}
                pageImages={previewDocId ? pageImages[previewDocId] : undefined}
                highlighted={highlighted}
                canAssign={!!selection}
                onTokenClick={(id) =>
                  selection && onDropToken(selection.documentId, selection.columnId, id)
                }
              />
            </section>
          }
        />
        <aside
          aria-label={t("editor.fieldsRegion")}
          className="hidden w-60 shrink-0 border-l bg-sidebar lg:block"
        >
          {fieldsPanel}
        </aside>
      </div>

      {pickerAnchor && selectedCell && selectedColumn && !editing && (
        <CellPicker
          key={cellKey(selectedCell.documentId, selectedCell.columnId)}
          anchor={pickerAnchor}
          cell={selectedCell}
          columnField={selectedColumn.fieldId}
          candidates={candidates}
          onPreview={setPreviewOverride}
          onChoose={(c) => {
            if (selection)
              report(
                run((s) => chooseCandidate(s, raw, selection.documentId, selection.columnId, c)),
              );
            closePicker();
          }}
          onShowAll={showAllCandidates}
          onEdit={() => {
            setPickerAnchor(null);
            setPreviewOverride(null);
            setEditing(true);
          }}
          onClose={closePicker}
        />
      )}

      {selection && (
        <AutoFillDialog
          open={autoFillOpen}
          onOpenChange={setAutoFillOpen}
          raw={raw}
          state={state}
          exampleDocumentId={selection.documentId}
          columnId={selection.columnId}
          onApply={onApplyAutoFill}
        />
      )}
      {selection && (
        <BatchCorrectionDialog
          open={batchOpen}
          onOpenChange={setBatchOpen}
          raw={raw}
          state={state}
          referenceDocumentId={selection.documentId}
          columnId={selection.columnId}
          signature={batchSignature}
          onApply={onApplyBatch}
        />
      )}
    </div>
  );
}

/**
 * Resizable editor regions. Sizes and the collapsed state of the suggestions panel are
 * remembered in localStorage; rendered only after hydration so SSR markup never mismatches.
 */
const memoryStorage = { getItem: () => null, setItem: () => {} };
const layoutStorage = typeof window === "undefined" ? memoryStorage : window.localStorage;

function EditorPanels({
  grid,
  candidates,
  preview,
  collapsedRef,
  onCandidatesCollapsed,
}: {
  grid: React.ReactNode;
  candidates: React.ReactNode;
  preview: React.ReactNode;
  collapsedRef: ReturnType<typeof usePanelRef>;
  onCandidatesCollapsed: (v: boolean) => void;
}) {
  const hydrated = useHydrated();
  const vertical = useDefaultLayout({ id: "invoiceflow-editor-v", storage: layoutStorage });
  const horizontal = useDefaultLayout({ id: "invoiceflow-editor-h", storage: layoutStorage });
  if (!hydrated) return <div className="min-w-0 flex-1">{grid}</div>;
  return (
    <ResizablePanelGroup
      orientation="vertical"
      className="min-w-0 flex-1"
      defaultLayout={vertical.defaultLayout}
      onLayoutChanged={vertical.onLayoutChanged}
    >
      <ResizablePanel id="grid" defaultSize="62%" minSize="25%">
        {grid}
      </ResizablePanel>
      <ResizableHandle
        withHandle
        className="h-1.5 w-full cursor-row-resize bg-border hover:bg-primary/30"
      />
      <ResizablePanel id="bottom" defaultSize="38%" minSize="15%">
        <ResizablePanelGroup
          orientation="horizontal"
          defaultLayout={horizontal.defaultLayout}
          onLayoutChanged={horizontal.onLayoutChanged}
        >
          <ResizablePanel
            id="candidates"
            panelRef={collapsedRef}
            defaultSize="30%"
            minSize="220px"
            collapsible
            collapsedSize="0%"
            onResize={(size) => onCandidatesCollapsed(size.asPercentage < 1)}
            className="border-r"
          >
            {candidates}
          </ResizablePanel>
          <ResizableHandle
            withHandle
            className="w-1.5 cursor-col-resize bg-border hover:bg-primary/30"
          />
          <ResizablePanel id="preview" defaultSize="70%" minSize="30%">
            {preview}
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
