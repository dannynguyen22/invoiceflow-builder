import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { DataGrid, PICKER_CLICK_DELAY } from "@/components/editor/DataGrid";
import { CellPicker } from "@/components/editor/CellPicker";
import { DEFAULT_COLUMNS, FIXTURE_RAW } from "@/domain/fixtures";
import { cellKey, createInitialState, rankedCandidates } from "@/editor/engine";
import type { Selection } from "@/editor/useEditor";
import { I18nProvider } from "@/i18n";

function GridHarness({ onOpen, onEdit }: { onOpen: (el: HTMLElement) => void; onEdit: () => void }) {
  const [state] = useState(() => createInitialState(FIXTURE_RAW, DEFAULT_COLUMNS));
  const [sel, setSel] = useState<Selection | null>(null);
  return (
    <DataGrid
      documents={FIXTURE_RAW.documents}
      state={state}
      selection={sel}
      editing={false}
      onSelect={setSel}
      onStartEdit={onEdit}
      onCommitEdit={() => {}}
      onCancelEdit={() => {}}
      onReplaceField={() => {}}
      onAddColumn={() => {}}
      onMoveColumn={() => {}}
      onDropToken={() => {}}
      onOpenPicker={onOpen}
    />
  );
}
const cellEl = (k: string) => document.querySelector(`[data-cell="${k}"]`) as HTMLElement;

describe("single click vs double click", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("single click opens the picker after the delay", () => {
    const onOpen = vi.fn();
    render(<I18nProvider><GridHarness onOpen={onOpen} onEdit={() => {}} /></I18nProvider>);
    fireEvent.click(cellEl("doc-c::col-seller_tax_id"), { detail: 1 });
    expect(onOpen).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(PICKER_CLICK_DELAY + 10));
    expect(onOpen).toHaveBeenCalledWith(cellEl("doc-c::col-seller_tax_id"));
  });
  it("double click edits and never opens the picker", () => {
    const onOpen = vi.fn();
    const onEdit = vi.fn();
    render(<I18nProvider><GridHarness onOpen={onOpen} onEdit={onEdit} /></I18nProvider>);
    const el = cellEl("doc-a::col-seller_name");
    fireEvent.click(el, { detail: 1 });
    fireEvent.click(el, { detail: 2 });
    fireEvent.doubleClick(el);
    act(() => vi.advanceTimersByTime(PICKER_CLICK_DELAY * 3));
    expect(onEdit).toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });
  it("Space opens the picker from the keyboard", () => {
    const onOpen = vi.fn();
    render(<I18nProvider><GridHarness onOpen={onOpen} onEdit={() => {}} /></I18nProvider>);
    const el = cellEl("doc-a::col-invoice_number");
    fireEvent.click(el, { detail: 1 });
    fireEvent.keyDown(el, { key: " " });
    expect(onOpen).toHaveBeenCalledWith(el);
  });
});

describe("CellPicker", () => {
  const state = createInitialState(FIXTURE_RAW, DEFAULT_COLUMNS);
  const cell = state.cells[cellKey("doc-c", "col-seller_tax_id")]!;
  const cands = rankedCandidates(FIXTURE_RAW, "doc-c", "seller_tax_id");
  const setup = () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    const p = { onChoose: vi.fn(), onPreview: vi.fn(), onShowAll: vi.fn(), onEdit: vi.fn(), onClose: vi.fn() };
    render(
      <I18nProvider>
        <CellPicker anchor={anchor} cell={cell} columnField="seller_tax_id" candidates={cands} {...p} />
      </I18nProvider>,
    );
    return p;
  };
  it("lists candidates with context and previews the active one's tokens", () => {
    const p = setup();
    const opts = screen.getAllByRole("option");
    expect(opts).toHaveLength(cands.length);
    expect(opts[0]).toHaveTextContent("8012345678");
    expect(p.onPreview).toHaveBeenLastCalledWith(cands[0]!.tokenIds);
  });
  it("arrow keys move, Enter chooses, Escape closes", () => {
    const p = setup();
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    expect(p.onPreview).toHaveBeenLastCalledWith(cands[1]!.tokenIds);
    fireEvent.click(screen.getAllByRole("option")[1]!);
    expect(p.onChoose).toHaveBeenCalledWith(cands[1]);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(p.onClose).toHaveBeenCalled();
  });
  it("offers 'see all values' and manual edit", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: /Xem tất cả giá trị/ }));
    expect(p.onShowAll).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Sửa thủ công/ }));
    expect(p.onEdit).toHaveBeenCalled();
  });
});
