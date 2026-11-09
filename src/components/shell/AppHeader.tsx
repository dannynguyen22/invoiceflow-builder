import { Link } from "@tanstack/react-router";
import { FileSpreadsheet } from "lucide-react";
import { useI18n } from "@/i18n";
import { LanguageSwitcher } from "./LanguageSwitcher";

const NAV = [
  { to: "/", key: "nav.home" },
  { to: "/workspace", key: "nav.workspace" },
  { to: "/workspace/editor", key: "nav.editor" },
] as const;

export function AppHeader() {
  const { t } = useI18n();
  return (
    <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:rounded focus:bg-primary focus:px-3 focus:py-1 focus:text-primary-foreground">
        {t("nav.skipToContent")}
      </a>
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
        <Link to="/" className="flex items-center gap-2 font-display text-lg font-semibold text-primary">
          <FileSpreadsheet className="size-5" aria-hidden />
          {t("app.name")}
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: true }}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              activeProps={{ className: "bg-accent text-accent-foreground" }}
            >
              {t(n.key)}
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}
