import { useEffect, useState } from "react";
import { Lightbulb, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";

const KEY = "invoiceflow.editorTips.dismissed";
const TIPS = ["tips.click", "tips.dblclick", "tips.dragHeader", "tips.dragAdd", "tips.dragToken"] as const;

/** Dismissible one-line guidance; remembered in localStorage (read after hydration). */
export function useTipsDismissed() {
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => setDismissed(localStorage.getItem(KEY) === "1"), []);
  const set = (v: boolean) => {
    setDismissed(v);
    if (v) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  };
  return [dismissed, set] as const;
}

export function EditorTips({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useI18n();
  return (
    <div role="note" aria-label={t("tips.title")} className="flex items-start gap-2 border-b bg-accent/40 px-3 py-1.5 text-[11.5px] leading-snug">
      <Lightbulb className="mt-px size-3.5 shrink-0 text-primary" aria-hidden />
      <ul className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground">
        {TIPS.map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ul>
      <Button size="icon" variant="ghost" className="size-5 shrink-0" onClick={onDismiss} aria-label={t("tips.dismiss")} title={t("tips.dismiss")}>
        <X className="size-3" aria-hidden />
      </Button>
    </div>
  );
}
