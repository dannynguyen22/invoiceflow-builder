// Native PDF text extraction with PDF.js (in its own worker). Pages without a usable text
// layer (scans) are rendered and sent to browser OCR. Every page is rendered to an image
// for the source preview. Scripting/eval are disabled; nothing is fetched remotely.
import type { OCRToken, PageSize } from "@/domain/types";
import { ExtractionError } from "./errors";
import { pdfItemBBox, splitRun } from "./geometry";
import { recognizePage } from "./ocr";

/** A page with fewer non-space characters than this is treated as scanned. */
export const MIN_TEXT_CHARS = 8;
const RENDER_SCALE = 2;

export interface PdfExtraction {
  pageSizes: PageSize[];
  tokens: OCRToken[];
  pageImages: string[];
  ocrPages: number[];
}

let configured: Promise<typeof import("pdfjs-dist")> | null = null;
function loadPdfjs() {
  configured ??= (async () => {
    const pdfjs = await import("pdfjs-dist");
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    return pdfjs;
  })();
  return configured;
}

function canvasToBlobUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error("render"))), "image/jpeg", 0.85),
  );
}

export async function extractPdf(
  data: ArrayBuffer,
  documentId: string,
  onProgress: (fraction: number, stage: "parsing" | "loading_ocr" | "ocr") => void,
): Promise<PdfExtraction> {
  const pdfjs = await loadPdfjs();
  let pdf: import("pdfjs-dist").PDFDocumentProxy;
  try {
    pdf = await pdfjs.getDocument({
      data: new Uint8Array(data),
      enableXfa: false,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      wasmUrl: "/pdfjs/wasm/",
      iccUrl: "/pdfjs/iccs/",
    }).promise;
  } catch (e) {
    if ((e as { name?: string })?.name === "PasswordException") throw new ExtractionError("pdf_encrypted");
    throw new ExtractionError("pdf_invalid");
  }

  const out: PdfExtraction = { pageSizes: [], tokens: [], pageImages: [], ocrPages: [] };
  const total = pdf.numPages;
  try {
    for (let p = 1; p <= total; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      out.pageSizes.push({ width: viewport.width, height: viewport.height });

      const content = await page.getTextContent();
      const pageTokens: OCRToken[] = [];
      let n = 0;
      let chars = 0;
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        chars += item.str.replace(/\s/g, "").length;
        const box = pdfItemBBox(viewport.transform, item.transform, item.width);
        for (const w of splitRun(item.str, box))
          pageTokens.push({ id: `${documentId}-p${p}-${++n}`, documentId, page: p, text: w.text, bbox: w.bbox, confidence: 1 });
      }

      // Render for preview (and OCR when the page has no real text layer).
      const canvas = document.createElement("canvas");
      const rv = page.getViewport({ scale: RENDER_SCALE });
      canvas.width = Math.ceil(rv.width);
      canvas.height = Math.ceil(rv.height);
      await page.render({ canvas, viewport: rv }).promise;
      out.pageImages.push(await canvasToBlobUrl(canvas));

      if (chars < MIN_TEXT_CHARS) {
        out.ocrPages.push(p);
        const ocr = await recognizePage({ image: canvas, scale: RENDER_SCALE }, documentId, p, documentId, (f, stage) =>
          onProgress((p - 1 + (stage === "ocr" ? f : 0)) / total, stage),
        );
        out.tokens.push(...ocr);
      } else out.tokens.push(...pageTokens);
      page.cleanup();
      onProgress(p / total, "parsing");
    }
  } finally {
    await pdf.loadingTask.destroy();
  }
  return out;
}
