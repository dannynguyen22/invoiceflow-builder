import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import vi from "./vi.json";
import en from "./en.json";

export type Locale = "vi" | "en";
export const LOCALES: readonly Locale[] = ["vi", "en"];
/** Always Vietnamese on first visit, regardless of browser locale (PRD §09). */
export const DEFAULT_LOCALE: Locale = "vi";
export const LOCALE_STORAGE_KEY = "invoiceflow.locale";
export const dictionaries = { vi, en } as const;

type Dict = Record<string, unknown>;

export function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const value = key.split(".").reduce<unknown>((o, k) => (o as Dict | undefined)?.[k], dictionaries[locale]);
  if (typeof value !== "string") {
    if (import.meta.env.DEV) console.warn(`[i18n] missing key "${key}" for ${locale}`);
    return key;
  }
  return value.replace(/\{\{(\w+)\}\}/g, (_, v) => String(vars?.[v] ?? `{{${v}}}`));
}

export function readStoredLocale(): Locale {
  try {
    const v = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return v === "en" || v === "vi" ? v : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  formatNumber: (n: number) => string;
  formatDate: (d: Date | string) => string;
}
const I18nContext = createContext<I18nValue | null>(null);

const intlTag = (l: Locale) => (l === "vi" ? "vi-VN" : "en-GB");

export function I18nProvider({ children, initialLocale = DEFAULT_LOCALE }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  // Read the persisted choice after hydration so SSR (always vi) matches first paint.
  useEffect(() => {
    setLocaleState(readStoredLocale());
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, l);
    } catch {
      /* storage unavailable: keep in memory */
    }
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t: (k, v) => translate(locale, k, v),
      formatNumber: (n) => new Intl.NumberFormat(intlTag(locale)).format(n),
      formatDate: (d) => new Intl.DateTimeFormat(intlTag(locale)).format(typeof d === "string" ? new Date(d) : d),
    }),
    [locale, setLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

/** Flatten nested dictionary into dotted keys (used by parity tests). */
export function flattenKeys(obj: Dict, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") Object.assign(out, flattenKeys(v as Dict, key));
    else out[key] = String(v);
  }
  return out;
}
