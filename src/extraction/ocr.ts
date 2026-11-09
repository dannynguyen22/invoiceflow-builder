// Browser OCR via Tesseract.js running in a Web Worker. All engine assets (worker script,
// WASM core, Vietnamese + English language data) are self-hosted under /ocr, so no
// third-party CDN is contacted and no image ever leaves the browser.
import type { OCRToken } from "@/domain/types";
import { ExtractionError } from "./errors";
import { pixelBoxToPage } from "./geometry";

type TWorker = import("tesseract.js").Worker;
let workerPromise: Promise<TWorker> | null = null;
let progressSink: ((p: number) => void) | null = null;

async function getWorker(onLoad: (p: number) => void): Promise<TWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM } = await import("tesseract.js");
      return createWorker(["vie", "eng"], OEM.LSTM_ONLY, {
        workerPath: "/ocr/worker.min.js",
        corePath: "/ocr",
        langPath: "/ocr/lang",
        gzip: true,
        workerBlobURL: false,
        logger: (m) => {
          if (m.status === "recognizing text") progressSink?.(m.progress);
          else onLoad(m.progress);
        },
      });
    })().catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

export async function terminateOcr() {
  const w = workerPromise;
  workerPromise = null;
  if (w) await (await w).terminate().catch(() => undefined);
}

export interface OcrPageInput {
  image: HTMLCanvasElement | Blob;
  /** Pixels per page unit (render scale) to map pixel boxes back into page coordinates. */
  scale: number;
}

/** Recognise one page; returns word tokens with page, bbox, confidence (0–1) and raw text. */
export async function recognizePage(
  input: OcrPageInput,
  documentId: string,
  page: number,
  idPrefix: string,
  onProgress: (p: number, stage: "loading_ocr" | "ocr") => void,
): Promise<OCRToken[]> {
  let worker: TWorker;
  try {
    worker = await getWorker((p) => onProgress(p, "loading_ocr"));
  } catch {
    throw new ExtractionError("ocr_failed");
  }
  progressSink = (p) => onProgress(p, "ocr");
  try {
    const { data } = await worker.recognize(input.image, {}, { blocks: true, text: false });
    const tokens: OCRToken[] = [];
    let n = 0;
    for (const block of data.blocks ?? [])
      for (const para of block.paragraphs)
        for (const line of para.lines)
          for (const w of line.words) {
            const text = w.text.trim();
            if (!text) continue;
            tokens.push({
              id: `${idPrefix}-o${page}-${++n}`,
              documentId,
              page,
              text,
              bbox: pixelBoxToPage(w.bbox, input.scale),
              confidence: Math.max(0, Math.min(1, w.confidence / 100)),
            });
          }
    return tokens;
  } catch {
    throw new ExtractionError("ocr_failed");
  } finally {
    progressSink = null;
  }
}
