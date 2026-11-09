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
    <header className="sticky top-0 z-30 border-b bg-paper">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:rounded focus:bg-primary focus:px-3 focus:py-1 focus:text-primary-foreground">
        {t("nav.skipToContent")}
      </a>
      <div className="flex h-12 items-center gap-3 px-4 sm:gap-4">
        <Link to="/" className="flex shrink-0 items-center gap-2 text-[15px] font-semibold text-foreground">
          <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <FileSpreadsheet className="size-3.5" aria-hidden />
          </span>
          <span className="hidden sm:inline">{t("app.name")}</span>
        </Link>
        <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: true }}
              className="whitespace-nowrap rounded-md px-2 py-1 text-[13px] sm:px-2.5 sm:text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              activeProps={{ className: "bg-secondary font-medium text-foreground" }}
            >
              {t(n.key)}
            </Link>
          ))}
        </nav>
        <div className="ml-auto shrink-0">
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}
