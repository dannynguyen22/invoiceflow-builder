import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/i18n";

const ROWS: [string, string][] = [
  ["← ↑ → ↓ / Tab", "editor.keyNavigate"],
  ["Space / Alt + ↓", "editor.keyPicker"],
  ["F2 / Enter", "editor.keyEdit"],
  ["Enter", "editor.keyCommit"],
  ["Esc", "editor.keyCancel"],
  ["Ctrl/⌘ + Z", "editor.keyUndo"],
  ["Ctrl/⌘ + Shift + Z / Ctrl + Y", "editor.keyRedo"],
];

export function KeyboardHelp() {
  const { t } = useI18n();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 px-2" aria-label={t("editor.keyboardTitle")}>
          <Keyboard aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <h2 className="text-xs font-semibold">{t("editor.keyboardTitle")}</h2>
        <dl className="mt-2 space-y-1 text-xs">
          {ROWS.map(([k, label]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t(label)}</dt>
              <dd className="tabular rounded bg-secondary px-1.5 font-medium">{k}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
