import { createFileRoute, Link } from "@tanstack/react-router";
import { UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n, translate } from "@/i18n";
import { LIMITS } from "@/config/limits";

export const Route = createFileRoute("/workspace/")({
  head: () => ({
    meta: [
      { title: translate("vi", "meta.workspaceTitle") },
      { name: "description", content: translate("vi", "meta.workspaceDescription") },
      { property: "og:title", content: translate("vi", "meta.workspaceTitle") },
      { property: "og:description", content: translate("vi", "meta.workspaceDescription") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Workspace,
});

function Workspace() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-semibold">{t("workspace.title")}</h1>
      <p className="mt-2 text-muted-foreground">{t("workspace.subtitle", { count: LIMITS.maxFilesPerBatch })}</p>
      <div className="mt-8 flex flex-col items-center rounded-lg border-2 border-dashed bg-paper px-6 py-16 text-center">
        <UploadCloud className="size-10 text-muted-foreground" aria-hidden />
        <h2 className="mt-4 text-xl font-semibold">{t("workspace.notReadyTitle")}</h2>
        <p className="mt-2 max-w-lg text-sm text-muted-foreground">{t("workspace.notReadyBody")}</p>
        <Button asChild className="mt-6" variant="outline">
          <Link to="/workspace/editor">{t("workspace.openEditor")}</Link>
        </Button>
      </div>
    </div>
  );
}
