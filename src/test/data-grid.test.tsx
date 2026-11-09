import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { DataGrid } from "@/components/editor/DataGrid";
import { DEFAULT_COLUMNS, FIXTURE_RAW } from "@/domain/fixtures";
import { createInitialState, editCell } from "@/editor/engine";
import type { Selection } from "@/editor/useEditor";
import { I18nProvider } from "@/i18n";

function Harness({ onCommit }: { onCommit: (v: string) => void }) {
  const [state, setState] = useState(() => createInitialState(FIXTURE_RAW, DEFAULT_COLUMNS));
  const [sel, setSel] = useState<Selection | null>(null);
  const [editing, setEditing] = useState(false);
  return (
    <DataGrid
      documents={FIXTURE_RAW.documents}
      state={state}
      selection={sel}
      editing={editing}
      onSelect={(s) => {
        setSel(s);
        setEditing(false);
      }}
      onStartEdit={() => setEditing(true)}
      onCommitEdit={(v) => {
        setEditing(false);
        onCommit(v);
        if (sel) setState((s) => editCell(s, sel.documentId, sel.columnId, v).state);
      }}
      onCancelEdit={() => setEditing(false)}
      onReplaceField={() => {}}
      onAddColumn={() => {}}
      onMoveColumn={() => {}}
      onDropToken={() => {}}
    />
  );
}

const cellEl = (k: string) => document.querySelector(`[data-cell="${k}"]`) as HTMLElement;

describe("DataGrid interactions", () => {
  it("single click selects; double click edits; Enter commits", () => {
    const onCommit = vi.fn();
    render(<I18nProvider><Harness onCommit={onCommit} /></I18nProvider>);
    const k = "doc-a::col-seller_name";
    fireEvent.click(cellEl(k));
    expect(cellEl(k)).toHaveAttribute("aria-selected", "true");
    fireEvent.doubleClick(cellEl(k));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Công ty ABC" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("Công ty ABC");
    expect(cellEl(k)).toHaveTextContent("Công ty ABC");
  });

  it("F2 edits and Esc cancels without committing", () => {
    const onCommit = vi.fn();
    render(<I18nProvider><Harness onCommit={onCommit} /></I18nProvider>);
    const k = "doc-a::col-invoice_number";
    fireEvent.click(cellEl(k));
    fireEvent.keyDown(cellEl(k), { key: "F2" });
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "X" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(cellEl(k)).toHaveTextContent("0001234");
  });

  it("arrow keys move the selection", () => {
    render(<I18nProvider><Harness onCommit={() => {}} /></I18nProvider>);
    fireEvent.click(cellEl("doc-a::col-invoice_number"));
    fireEvent.keyDown(cellEl("doc-a::col-invoice_number"), { key: "ArrowDown" });
    expect(cellEl("doc-b::col-invoice_number")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(cellEl("doc-b::col-invoice_number"), { key: "ArrowRight" });
    expect(cellEl("doc-b::col-invoice_date")).toHaveAttribute("aria-selected", "true");
  });
});
