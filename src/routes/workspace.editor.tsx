import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useI18n, translate } from "@/i18n";
import { FIELD_GROUPS, fieldsInGroup } from "@/domain/fields";
import { DEFAULT_COLUMNS, FIXTURE_INVOICES, fixtureCell } from "@/domain/fixtures";
import { normalizeForSearch } from "@/lib/text";

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

function Editor() {
  const { t, formatNumber } = useI18n();
  const [query, setQuery] = useState("");
  const q = normalizeForSearch(query);

  const groups = useMemo(
    () =>
      FIELD_GROUPS.map((g) => ({
        g,
        fields: fieldsInGroup(g).filter((f) => !q || normalizeForSearch(t(f.labelKey)).includes(q) || f.id.includes(q)),
      })).filter((x) => x.fields.length),
    [q, t],
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex items-center gap-2 border-b bg-review/25 px-4 py-2 text-sm text-review-foreground">
        <Info className="size-4" aria-hidden /> {t("editor.fixtureNotice")} {t("editor.interactionsPending")}
      </div>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_280px]">
        <div className="grid min-h-0 grid-rows-[1fr_220px]">
          <section aria-label={t("editor.gridRegion")} className="min-h-0 overflow-auto bg-paper">
            <div className="px-4 py-2 text-xs text-muted-foreground">{t("editor.invoiceCount", { count: FIXTURE_INVOICES.length })}</div>
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-secondary">
                <tr>
                  {DEFAULT_COLUMNS.map((c) => (
                    <th key={c.id} scope="col" className="border border-grid-line px-3 py-2 text-left font-medium">
                      {t(`fields.${c.fieldId}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FIXTURE_INVOICES.map((inv) => (
                  <tr key={inv.document.id}>
                    {DEFAULT_COLUMNS.map((c) => {
                      const cell = fixtureCell(inv, c);
                      const isAmount = c.fieldId === "total_amount" && cell.value;
                      return (
                        <td
                          key={c.id}
                          className={`tabular border border-grid-line px-3 py-2 ${cell.reviewState === "needs_review" ? "bg-review/30" : ""}`}
                          title={t(`review.${cell.reviewState}`)}
                        >
                          {isAmount ? formatNumber(Number(cell.value)) : cell.value || <span className="text-muted-foreground">{t("editor.emptyCell")}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section aria-label={t("editor.previewRegion")} className="border-t bg-muted p-4">
            <h2 className="text-sm font-semibold">{t("editor.previewRegion")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("editor.previewEmpty")}</p>
          </section>
        </div>
        <aside aria-label={t("editor.fieldsRegion")} className="min-h-0 overflow-auto border-l bg-sidebar p-4">
          <h2 className="text-sm font-semibold">{t("editor.fieldsRegion")}</h2>
          <Input className="mt-3" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("editor.searchFields")} aria-label={t("editor.searchFields")} />
          {groups.length === 0 && <p className="mt-4 text-sm text-muted-foreground">{t("editor.noFieldsFound")}</p>}
          {groups.map(({ g, fields }) => (
            <div key={g} className="mt-4">
              <h3 className="font-sans text-xs font-medium uppercase tracking-wider text-muted-foreground">{t(`fieldGroups.${g}`)}</h3>
              <ul className="mt-1.5 space-y-1">
                {fields.map((f) => (
                  <li key={f.id} className="rounded border bg-paper px-2.5 py-1.5 text-sm">{t(f.labelKey)}</li>
                ))}
              </ul>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
