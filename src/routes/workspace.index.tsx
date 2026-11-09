import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { AlertTriangle, FileText, RotateCcw, ShieldCheck, Trash2, UploadCloud, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useI18n, translate } from "@/i18n";
import { LIMITS } from "@/config/limits";
import { uploads, type UploadItem } from "@/extraction/store";
import { useUploads } from "@/extraction/useUploads";
import { cn } from "@/lib/utils";

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
  const items = useUploads();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const r = uploads.add(Array.from(list));
    if (r.rejectedOverLimit) toast.error(t("upload.overLimit", { max: LIMITS.maxFilesPerBatch, count: r.rejectedOverLimit }));
  };
  const usable = items.filter((i) => i.status === "ready" || i.status === "unsupported").length;
  const busy = items.some((i) => i.status === "queued" || i.status === "processing");

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold">{t("workspace.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("workspace.subtitle", { count: LIMITS.maxFilesPerBatch })}</p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "mt-6 flex flex-col items-center rounded-lg border border-dashed border-input bg-paper px-6 py-10 text-center transition-colors",
          over && "border-primary bg-accent/50",
        )}
      >
        <UploadCloud className="size-9 text-muted-foreground" aria-hidden />
        <h2 className="mt-3 text-base font-semibold">{t("upload.dropTitle")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("upload.dropOr")}</p>
        <Button className="mt-2" onClick={() => inputRef.current?.click()}>
          {t("upload.choose")}
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={LIMITS.acceptedExtensions.join(",")}
          className="sr-only"
          aria-label={t("upload.choose")}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="mt-3 text-xs text-muted-foreground">{t("upload.limits", { size: LIMITS.maxFileSizeMB, count: LIMITS.maxFilesPerBatch })}</p>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-primary" aria-hidden /> {t("upload.privacy")}
        </p>
      </div>

      <div className="mt-6 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("upload.listTitle", { count: items.length, max: LIMITS.maxFilesPerBatch })}</h2>
        <div className="flex gap-2">
          {items.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => uploads.clear()}>
              <Trash2 aria-hidden /> {t("upload.clear")}
            </Button>
          )}
          {usable > 0 ? (
            <Button size="sm" asChild disabled={busy}>
              <Link to="/workspace/editor">{t("upload.openEditor")}</Link>
            </Button>
          ) : (
            <Button size="sm" variant="outline" asChild>
              <Link to="/workspace/editor">{t("upload.openSample")}</Link>
            </Button>
          )}
        </div>
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{t("upload.empty")}</p>
      ) : (
        <ul className="mt-2 divide-y rounded-lg border bg-paper" aria-label={t("upload.listTitle", { count: items.length, max: LIMITS.maxFilesPerBatch })}>
          {items.map((it) => (
            <FileRow key={it.id} item={it} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FileRow({ item }: { item: UploadItem }) {
  const { t } = useI18n();
  const r = item.result;
  const tone =
    item.status === "failed" ? "text-destructive" : item.status === "unsupported" ? "text-review-foreground" : item.status === "ready" ? "text-primary" : "text-muted-foreground";
  return (
    <li className="flex items-start gap-3 px-3 py-2.5" data-status={item.status}>
      <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-medium">{item.file.name}</p>
          <span className={cn("shrink-0 text-xs font-medium", tone)}>{t(`upload.status.${item.status}`)}</span>
        </div>
        {item.status === "processing" && (
          <div className="mt-1.5">
            <Progress value={Math.round(item.progress * 100)} className="h-1.5" aria-label={t(`upload.stage.${item.stage ?? "reading"}`)} />
            <p className="tabular mt-1 text-[11px] text-muted-foreground">
              {t(`upload.stage.${item.stage ?? "reading"}`)} · {Math.round(item.progress * 100)}%
            </p>
          </div>
        )}
        {item.error && <p className="mt-0.5 text-xs text-destructive">{t(`upload.errors.${item.error}`, { size: LIMITS.maxFileSizeMB })}</p>}
        {r && (
          <p className="tabular mt-0.5 text-[11px] text-muted-foreground">
            {r.document.source !== "xml" && <>{t("upload.pages", { count: r.document.pages })} · </>}
            {t("upload.tokens", { count: r.tokens.length })}
            {r.document.source === "xml" && <> · {t("upload.fieldsFound", { count: r.candidates.length })}</>}
          </p>
        )}
        {r?.issues.map((is) => (
          <p key={is} className="mt-0.5 flex items-center gap-1 text-[11px] text-review-foreground">
            <AlertTriangle className="size-3" aria-hidden /> {t(`upload.issues.${is}`)}
          </p>
        ))}
      </div>
      <div className="flex shrink-0 gap-1">
        {item.status === "failed" && item.error !== "too_large" && item.error !== "unsupported_type" && (
          <Button size="icon" variant="ghost" className="size-7" onClick={() => uploads.retry(item.id)} aria-label={t("upload.retry")} title={t("upload.retry")}>
            <RotateCcw aria-hidden />
          </Button>
        )}
        <Button size="icon" variant="ghost" className="size-7" onClick={() => uploads.remove(item.id)} aria-label={t("upload.remove")} title={t("upload.remove")}>
          <X aria-hidden />
        </Button>
      </div>
    </li>
  );
}
