import { useMemo, useState } from "react";
import { CheckCircle2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Cell, FieldCandidate, FieldId, OCRToken } from "@/domain/types";
import { useI18n } from "@/i18n";
import { normalizeForSearch } from "@/lib/text";
import { cn } from "@/lib/utils";

interface Props {
  cell: Cell | null;
  columnField: FieldId | null;
  candidates: FieldCandidate[];
  tokens: OCRToken[];
  onChooseCandidate: (c: FieldCandidate) => void;
  onChooseToken: (tokenId: string) => void;
  onEdit: () => void;
  onToggleVerified: (verified: boolean) => void;
}

const TOP_N = 5;

export function CandidatePanel({ cell, columnField, candidates, tokens, onChooseCandidate, onChooseToken, onEdit, onToggleVerified }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const q = normalizeForSearch(query);
  const filtered = useMemo(() => tokens.filter((tk) => !q || normalizeForSearch(tk.text).includes(q)), [tokens, q]);

  if (!cell || !columnField)
    return <p className="p-4 text-sm text-muted-foreground">{t("editor.selectCellHint")}</p>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`fields.${columnField}`)}</h2>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onEdit}>
            <Pencil aria-hidden /> {t("editor.editCell")}
          </Button>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">{t("editor.currentValue")}</p>
        <p className="tabular truncate text-sm font-medium">{cell.value || <span className="text-muted-foreground">{t("editor.emptyCell")}</span>}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t("editor.sourceTitle")}: {t(`provenance.${cell.provenance}`)} · {t(`review.${cell.reviewState}`)}
        </p>
        {cell.flags.length > 0 && (
          <ul className="mt-1.5 flex flex-wrap gap-1">
            {cell.flags.map((f) => (
              <li key={f} className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", f === "invalid_format" ? "bg-destructive/10 text-destructive" : "bg-review/20 text-review-foreground")}>
                {t(`flags.${f}`)}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex items-center gap-2">
          <Button
            size="sm"
            variant={cell.verified ? "secondary" : "default"}
            className="h-7 px-2 text-xs"
            disabled={!cell.verified && cell.reviewState === "needs_review"}
            onClick={() => onToggleVerified(!cell.verified)}
            aria-pressed={cell.verified}
          >
            <CheckCircle2 aria-hidden /> {t(cell.verified ? "editor.unverify" : "editor.verify")}
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">{t("editor.verifyHint")}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{t("editor.editHint")}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <h3 className="text-xs font-semibold">{t("editor.candidatesTitle")}</h3>
        {candidates.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">{t("editor.candidatesEmpty")}</p>
        ) : (
          <ul className="mt-1.5 space-y-1" aria-label={t("editor.candidatesTitle")}>
            {candidates.slice(0, TOP_N).map((c) => {
              const active = c.value === cell.value && c.tokenIds.join() === cell.sourceTokenIds.join();
              return (
                <li key={c.tokenIds.join()}>
                  <button
                    type="button"
                    onClick={() => onChooseCandidate(c)}
                    className={cn("flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1 text-left text-[13px] hover:border-primary/60 hover:bg-accent/50", active && "border-primary bg-accent/60")}
                  >
                    <span className="tabular truncate">{c.value}</span>
                    <span className="tabular shrink-0 text-[11px] text-muted-foreground">{t("editor.matchScore", { score: c.score.toFixed(2) })}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-1 text-[10px] text-muted-foreground">{t("editor.scoreNote")}</p>

        <h3 className="mt-3 text-xs font-semibold">{t("editor.allText")}</h3>
        <Input className="mt-1.5 h-7 text-xs" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("editor.searchText")} aria-label={t("editor.searchText")} />
        {filtered.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">{t("editor.noTextFound")}</p>
        ) : (
          <ul className="mt-1.5 space-y-0.5">
            {filtered.map((tk) => (
              <li key={tk.id}>
                <button type="button" onClick={() => onChooseToken(tk.id)} className="tabular w-full truncate rounded px-2 py-0.5 text-left text-xs hover:bg-accent/60" title={t("editor.useValue")}>
                  {tk.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
