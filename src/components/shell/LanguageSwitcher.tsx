import { LOCALES, useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div role="group" aria-label={t("locale.label")} className="inline-flex items-center gap-0.5 rounded-md border bg-secondary p-0.5 text-xs">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={locale === l}
          onClick={() => setLocale(l)}
          className={cn(
            "rounded px-2 py-1 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
            locale === l ? "bg-paper text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span className="hidden sm:inline">{t(`locale.${l}`)}</span>
          <span className="sm:hidden" aria-label={t(`locale.${l}`)}>{l.toUpperCase()}</span>
        </button>
      ))}
    </div>
  );
}
