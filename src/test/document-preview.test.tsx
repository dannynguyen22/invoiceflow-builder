import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DocumentPreview } from "@/components/editor/DocumentPreview";
import { FIXTURE_RAW } from "@/domain/fixtures";
import { I18nProvider } from "@/i18n";

const doc = FIXTURE_RAW.documents.find((d) => d.id === "doc-b")!;
const tokens = FIXTURE_RAW.tokens.filter((t) => t.documentId === "doc-b");
const page2Token = tokens.find((t) => t.page === 2)!;

const renderPreview = (highlighted: Set<string>) =>
  render(
    <I18nProvider>
      <DocumentPreview document={doc} tokens={tokens} highlighted={highlighted} canAssign onTokenClick={() => {}} />
    </I18nProvider>,
  );

describe("DocumentPreview", () => {
  it("navigates pages and shows only that page's tokens", () => {
    renderPreview(new Set());
    const pageEl = screen.getByTestId("preview-page");
    expect(pageEl.dataset["page"]).toBe("1");
    expect(screen.queryByText(page2Token.text)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Trang sau/ }));
    expect(screen.getByTestId("preview-page").dataset["page"]).toBe("2");
    expect(screen.getByText(page2Token.text)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Trang sau/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("opens the page holding a highlighted token on page 2 and highlights it", () => {
    renderPreview(new Set([page2Token.id]));
    expect(screen.getByTestId("preview-page").dataset["page"]).toBe("2");
    const el = document.querySelector(`[data-token="${page2Token.id}"]`)!;
    expect(el.getAttribute("aria-pressed")).toBe("true");
  });
  it("zooms in and out", () => {
    renderPreview(new Set());
    expect(screen.getByTestId("zoom-level").textContent).toBe("100%");
    fireEvent.click(screen.getByRole("button", { name: "Phóng to" }));
    expect(screen.getByTestId("zoom-level").textContent).toBe("125%");
    fireEvent.click(screen.getByRole("button", { name: "Vừa khung" }));
    expect(screen.getByTestId("zoom-level").textContent).toBe("100%");
  });
});
