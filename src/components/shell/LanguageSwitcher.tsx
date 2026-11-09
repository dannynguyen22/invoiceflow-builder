import { LOCALES, useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div role="group" aria-label={t("locale.label")} className="inline-flex items-center rounded-md border bg-paper p-0.5 text-sm">
      {LOCALES.map((l, i) => (
        <span key={l} className="flex items-center">
          {i > 0 && <span aria-hidden className="px-0.5 text-muted-foreground">|</span>}
          <button
            type="button"
            lang={l}
            aria-pressed={locale === l}
            onClick={() => setLocale(l)}
            className={cn(
              "rounded-sm px-2.5 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              locale === l ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`locale.${l}`)}
          </button>
        </span>
      ))}
    </div>
  );
}
