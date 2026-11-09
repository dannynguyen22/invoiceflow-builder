// UX safety of the Auto-fill / Batch Correction previews: safe defaults, protected rows hidden until
// explicitly enabled, and a confirmation step before anything protected is overwritten.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AutoFillDialog } from "@/components/editor/AutoFillDialog";
import { BatchCorrectionDialog } from "@/components/editor/BatchCorrectionDialog";
import { cellKey, editCell, evaluate, type EditorState } from "@/editor/engine";
import { I18nProvider, translate } from "@/i18n";
import { build, INV, TAX, templateX, V, withExample } from "./helpers/invoices";
import { createInitialState } from "@/editor/engine";

const vt = (k: string, v?: Record<string, string | number>) => translate("vi", k, v);
const raw = build([
  { id: "a", rows: templateX(V(1)) },
  { id: "b", rows: templateX(V(2)) },
  { id: "c", rows: templateX(V(3)) },
  { id: "d", rows: templateX(V(4)) },
]);

function scenario(): EditorState {
  let st = withExample(raw, [INV], "a", "c-num", "0004561");
  st = editCell(st, "b", "c-num", "TYPED-BY-HAND").state; // manual → protected
  const k = cellKey("c", "c-num");
  st = {
    ...st,
    cells: {
      ...st.cells,
      [k]: evaluate({ ...st.cells[k]!, value: "OLD", provenance: "extracted" }, "invoice_number"),
    },
  };
  return st;
}
const wrap = (ui: React.ReactNode) => render(<I18nProvider>{ui}</I18nProvider>);

describe("AutoFillDialog", () => {
  const props = (onApply = vi.fn()) => ({
    open: true,
    onOpenChange: () => {},
    raw,
    state: scenario(),
    exampleDocumentId: "a",
    columnId: "c-num",
    onApply,
  });

  it("explains what was learned, selects only well-matched rows, and shows reasons and sources", () => {
    wrap(<AutoFillDialog {...props()} />);
    expect(screen.getByText(vt("autofill.learnedTitle"))).toBeInTheDocument();
    expect(screen.getByText("“Số định danh”")).toBeInTheDocument(); // learned label
    // Default scope is the example's supplier: only c shares it, and it is pre-selected.
    expect(screen.getByRole("button", { name: vt("autofill.apply", { count: 1 }) })).toBeEnabled();
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(vt("autofill.scopeBatch")) }));
    expect(screen.getByRole("button", { name: vt("autofill.apply", { count: 2 }) })).toBeEnabled();
    const row = screen.getByText("d.pdf").closest("li")!;
    expect(within(row).getByText(/Trang 1 · “Số định danh: 0004564”/)).toBeInTheDocument(); // source line shown
    expect(within(row).getByText(/Nhãn “Số định danh” giống ví dụ/)).toBeInTheDocument(); // reason
  });

  it("keeps protected rows out of the list until the override switch is on", () => {
    wrap(<AutoFillDialog {...props()} />);
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(vt("autofill.scopeBatch")) }));
    expect(screen.getByText(vt("autofill.groupProtected", { count: 1 }))).toBeInTheDocument();
    expect(screen.queryByText("TYPED-BY-HAND")).toBeNull();
    fireEvent.click(screen.getByRole("switch"));
    const row = screen.getByText("TYPED-BY-HAND").closest("li")!;
    const box = within(row).getByRole("checkbox");
    expect(box).not.toBeChecked(); // revealed, but never pre-selected
  });

  it("applies without confirmation when nothing protected is selected", () => {
    const onApply = vi.fn();
    wrap(<AutoFillDialog {...props(onApply)} />);
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(vt("autofill.scopeBatch")) }));
    fireEvent.click(screen.getByRole("button", { name: vt("autofill.apply", { count: 2 }) }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const [, ids, overrides] = onApply.mock.calls[0]!;
    expect([...ids].sort()).toEqual(["c", "d"]);
    expect(overrides).toEqual([]);
  });

  it("asks for explicit confirmation before overwriting a protected cell", () => {
    const onApply = vi.fn();
    wrap(<AutoFillDialog {...props(onApply)} />);
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(vt("autofill.scopeBatch")) }));
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(within(screen.getByText("TYPED-BY-HAND").closest("li")!).getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", {
        name: vt("autofill.applyOverride", { count: 3, protected: 1 }),
      }),
    );
    expect(onApply).not.toHaveBeenCalled(); // nothing happens until confirmed
    const confirm = screen.getByRole("alertdialog");
    expect(
      within(confirm).getByText(vt("smart.override.confirmTitle", { count: 1 })),
    ).toBeInTheDocument();
    fireEvent.click(
      within(confirm).getByRole("button", { name: vt("smart.override.confirmCancel") }),
    );
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: vt("autofill.applyOverride", { count: 3, protected: 1 }),
      }),
    );
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: vt("smart.override.confirmAction", { count: 1 }),
      }),
    );
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]![2]).toEqual(["b"]);
  });
});

describe("BatchCorrectionDialog", () => {
  function flawedState(): EditorState {
    let st = createInitialState(raw, [TAX]);
    for (const [doc, provenance] of [
      ["b", "manual"],
      ["c", "extracted"],
    ] as const) {
      const k = cellKey(doc, "c-tax");
      st = {
        ...st,
        cells: {
          ...st.cells,
          [k]: evaluate({ ...st.cells[k]!, value: "BAD", provenance }, "seller_tax_id"),
        },
      };
    }
    return st;
  }
  const open = (onApply = vi.fn()) =>
    wrap(
      <BatchCorrectionDialog
        open
        onOpenChange={() => {}}
        raw={raw}
        state={flawedState()}
        referenceDocumentId="a"
        columnId="c-tax"
        signature="invalid_format"
        onApply={onApply}
      />,
    );

  it("shows before → after per cell with a source, and protects hand-typed cells by default", () => {
    const onApply = vi.fn();
    open(onApply);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /sai|same|nhà cung cấp/i, checked: true }),
    ); // supplier filter off → all docs
    const row = screen.getByText("c.pdf").closest("li")!;
    expect(within(row).getByText("BAD")).toBeInTheDocument(); // before
    expect(within(row).getByText(/Trang 1/)).toBeInTheDocument(); // source reference
    expect(screen.queryByText("b.pdf")).toBeNull(); // manual cell hidden behind the override switch
    expect(screen.getByText(vt("batch.groupProtected", { count: 1 }))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: vt("batch.apply", { count: 1 }) }));
    expect(onApply.mock.calls[0]![2]).toEqual([]);
  });
});
