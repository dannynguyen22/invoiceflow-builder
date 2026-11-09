// In-memory upload batch (browser only; nothing is persisted or sent anywhere).
// Files are processed one at a time; progress values come from real work reported
// by the parsers/OCR engine. Subscribe with useSyncExternalStore.
import { LIMITS } from "@/config/limits";
import type { FieldCandidate, RawExtraction } from "@/domain/types";
import { ExtractionError, type ExtractionErrorCode } from "./errors";
import { precheck } from "./files";
import { processFile, type ProcessedDocument, type Processor, type Stage } from "./process";

export type UploadStatus = "queued" | "processing" | "ready" | "unsupported" | "failed";

export interface UploadItem {
  id: string;
  file: File;
  status: UploadStatus;
  stage: Stage | null;
  progress: number;
  error: ExtractionErrorCode | null;
  result: ProcessedDocument | null;
}

export interface UploadStore {
  getSnapshot: () => readonly UploadItem[];
  subscribe: (fn: () => void) => () => void;
  add: (files: readonly File[]) => { accepted: number; rejectedOverLimit: number };
  remove: (id: string) => void;
  retry: (id: string) => void;
  clear: () => void;
  /** Resolves when the queue is idle (used by tests). */
  idle: () => Promise<void>;
}

export function createUploadStore(processor: Processor = processFile, maxFiles: number = LIMITS.maxFilesPerBatch): UploadStore {
  let items: readonly UploadItem[] = [];
  const subs = new Set<() => void>();
  let running = false;
  let idleWaiters: (() => void)[] = [];
  let seq = 0;

  const emit = () => subs.forEach((f) => f());
  const patch = (id: string, p: Partial<UploadItem>) => {
    items = items.map((it) => (it.id === id ? { ...it, ...p } : it));
    emit();
  };
  const releaseUrls = (it: UploadItem) => it.result?.pageImages.forEach((u) => URL.revokeObjectURL?.(u));

  async function pump() {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const next = items.find((it) => it.status === "queued");
        if (!next) break;
        patch(next.id, { status: "processing", progress: 0, stage: "reading", error: null });
        try {
          const result = await processor(next.file, next.id, (fraction, stage) => {
            if (!items.some((it) => it.id === next.id)) return;
            patch(next.id, { progress: Math.max(0, Math.min(1, fraction)), stage });
          });
          if (!items.some((it) => it.id === next.id)) {
            result.pageImages.forEach((u) => URL.revokeObjectURL?.(u));
            continue;
          }
          patch(next.id, { status: result.document.status === "unsupported" ? "unsupported" : "ready", progress: 1, stage: null, result });
        } catch (e) {
          patch(next.id, { status: "failed", stage: null, error: e instanceof ExtractionError ? e.code : "unknown" });
        }
      }
    } finally {
      running = false;
      idleWaiters.forEach((f) => f());
      idleWaiters = [];
    }
  }

  return {
    getSnapshot: () => items,
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    add(files) {
      const room = Math.max(0, maxFiles - items.length);
      const taken = files.slice(0, room);
      const added: UploadItem[] = taken.map((file) => {
        const err = precheck(file);
        return {
          id: `up${++seq}-${Date.now().toString(36)}`,
          file,
          status: err ? "failed" : "queued",
          stage: null,
          progress: 0,
          error: err,
          result: null,
        };
      });
      items = [...items, ...added];
      emit();
      void pump();
      return { accepted: taken.length, rejectedOverLimit: files.length - taken.length };
    },
    remove(id) {
      const it = items.find((x) => x.id === id);
      if (it) releaseUrls(it);
      items = items.filter((x) => x.id !== id);
      emit();
    },
    retry(id) {
      const it = items.find((x) => x.id === id);
      if (!it || it.status !== "failed" || precheck(it.file)) return;
      patch(id, { status: "queued", progress: 0, error: null, result: null });
      void pump();
    },
    clear() {
      items.forEach(releaseUrls);
      items = [];
      emit();
    },
    idle: () => (running || items.some((i) => i.status === "queued") ? new Promise((r) => idleWaiters.push(r)) : Promise.resolve()),
  };
}

/** Raw extraction (layer A) from every processed document, in upload order. */
export function buildRaw(items: readonly UploadItem[]): RawExtraction {
  const done = items.filter((i) => i.result && (i.status === "ready" || i.status === "unsupported"));
  const candidates: Record<string, FieldCandidate[]> = {};
  for (const i of done) candidates[i.id] = i.result!.candidates;
  return {
    documents: done.map((i) => i.result!.document),
    tokens: done.flatMap((i) => i.result!.tokens),
    candidates,
  };
}

/** Shared browser session store. */
export const uploads = createUploadStore();
