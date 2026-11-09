// Browser download helper (client-only). Creates an object URL and triggers a save.
// Guarded so it is a no-op during SSR / tests where `document` is unavailable.
export function downloadBlob(data: string | Uint8Array, filename: string, mime: string): void {
  if (typeof document === "undefined") return;
  // Copy into a fresh ArrayBuffer-backed view so the Blob part type is unambiguous.
  const part: BlobPart = typeof data === "string" ? data : new Uint8Array(data).slice().buffer;
  const blob = new Blob([part], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A filesystem-safe, dated default filename stem. */
export function exportFilename(stem = "invoiceflow", ext = "csv"): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  return `${stem}-${date}.${ext}`;
}
