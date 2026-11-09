// Presentation helpers shared by the Auto-fill and Batch Correction previews.
import { useCallback, useState } from "react";
import { dictionaries } from "@/i18n";
import type { Reason, SourceRef } from "@/editor/learning";

type T = (key: string, vars?: Record<string, string | number>) => string;

const KNOWN_REASONS = new Set(Object.keys(dictionaries.vi.smart.reason));

/** Localized sentence for one machine-readable reason. Unknown codes degrade to a generic line. */
export function reasonText(t: T, r: Reason): string {
  const key = KNOWN_REASONS.has(r.code) ? r.code : "reg_other";
  const params: Record<string, string | number> = { ...r.params };
  if (typeof params["section"] === "string")
    params["section"] = t(`smart.section.${params["section"]}`);
  return t(`smart.reason.${key}`, params);
}

/** "Trang 2 · “Số: 0004562”" or the XML element path. */
export function sourceText(t: T, source: SourceRef | null): string {
  if (!source) return "—";
  if (source.sourcePath) return t("smart.sourceXml", { path: source.sourcePath });
  const page = t("smart.sourcePage", { page: source.page });
  return source.context ? `${page} · “${source.context}”` : page;
}

/**
 * Selection of document ids that resets to `defaults` whenever `planKey` changes (new scope, new
 * plan) and keeps the user's choices otherwise.
 */
export function useProposalSelection(planKey: string, defaults: readonly string[]) {
  const [state, setState] = useState<{ key: string; ids: ReadonlySet<string> } | null>(null);
  const ids = state && state.key === planKey ? state.ids : new Set(defaults);
  const toggle = useCallback(
    (id: string) =>
      setState((prev) => {
        const base = prev && prev.key === planKey ? prev.ids : new Set(defaults);
        const next = new Set(base);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return { key: planKey, ids: next };
      }),
    // `defaults` is derived from planKey; depending on the key keeps the callback stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planKey],
  );
  return { ids, toggle };
}
