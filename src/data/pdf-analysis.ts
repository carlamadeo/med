/**
 * Reads a report PDF in the browser: text first (pdf.js), OCR (Tesseract) only for scanned pages and signature
 * stamps. Ported from web/detect.js. pdf.js and Tesseract are loaded as static files from `vendor/` (copied by
 * scripts/vendor.mjs) instead of being bundled: they ship workers, WASM, fonts and language data by URL.
 */
import { extractFields, extractSignatureDoctor, type ExtractedFields } from '@domain/extract';

import type * as PdfJs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type * as Tesseract from 'tesseract.js';

type PdfPage = Awaited<ReturnType<PDFDocumentProxy['getPage']>>;
type Viewport = ReturnType<PdfPage['getViewport']>;
type OcrWorker = Awaited<ReturnType<typeof Tesseract.createWorker>>;
/** [left, bottom, right, top] in PDF user space. */
type Region = [number, number, number, number];
type Transform = [number, number, number, number, number, number];
interface OperatorList {
  fnArray: number[];
  argsArray: unknown[];
}

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_PAGES = 6;
const MAX_OCR_PAGES = 3;
const SCANNED_PAGE_LETTERS = 70;

/** Resolved against the page URL so the app works from any sub-path (GitHub Pages). */
const vendor = (path: string): string => new URL(`${import.meta.env.BASE_URL}vendor/${path}`, document.baseURI).href;

const isTextItem = (item: object): item is TextItem => 'str' in item;

function pageText(items: Array<TextItem | object>): string {
  let text = '';
  let previous: { y: number; end: number } | undefined;
  for (const item of items) {
    if (!isTextItem(item)) continue;
    const x = item.transform[4] as number;
    const y = item.transform[5] as number;
    if (previous && Math.abs(previous.y - y) > 4 && !text.endsWith('\n')) text += '\n';
    else if (previous && x - previous.end > 18 && !text.endsWith('\n')) text += '  ';
    text += item.str;
    if (item.hasEOL) text += '\n';
    previous = { y, end: x + item.width };
  }
  return text;
}

function signatureArea(item: TextItem, viewport: Viewport) {
  const x = item.transform[4] as number;
  const y = item.transform[5] as number;
  const [left = 0, top = 0] = viewport.convertToViewportPoint(x, y);
  const scale = viewport.scale;
  return {
    left: Math.max(0, Math.floor(left - 12 * scale)),
    top: Math.max(0, Math.floor(top + 2 * scale)),
    right: Math.min(viewport.width, Math.ceil(left + (Math.max(item.width, 160) + 10) * scale)),
    bottom: Math.min(viewport.height, Math.ceil(top + 110 * scale)),
  };
}

/** Bounding boxes of images that look like a signature stamp near the foot of the page. */
export function signatureImages(
  operators: OperatorList,
  pdfjs: Pick<typeof PdfJs, 'OPS' | 'Util'>,
  view: number[]
): Region[] {
  const { OPS, Util } = pdfjs;
  const [viewLeft = 0, viewBottom = 0, viewRight = 0, viewTop = 0] = view;
  const stack: Transform[] = [];
  let transform: Transform = [1, 0, 0, 1, 0, 0];
  const regions: Region[] = [];
  const paints: number[] = [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject];
  for (let i = 0; i < operators.fnArray.length; i++) {
    const op = operators.fnArray[i] as number;
    if (op === OPS.save) stack.push(transform);
    else if (op === OPS.restore) transform = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (op === OPS.transform) transform = Util.transform(transform, operators.argsArray[i] as number[]) as Transform;
    else if (paints.includes(op)) {
      const [a, b, c, d, e, f] = transform;
      const left = Math.max(viewLeft, Math.min(e, e + a, e + c, e + a + c));
      const right = Math.min(viewRight, Math.max(e, e + a, e + c, e + a + c));
      const bottom = Math.max(viewBottom, Math.min(f, f + b, f + d, f + b + d));
      const top = Math.min(viewTop, Math.max(f, f + b, f + d, f + b + d));
      const height = viewTop - viewBottom;
      // Look for stamps near the foot of the page, without re-reading full-page scans.
      if (right - left >= 60 && top - bottom >= 15 && top - bottom <= height * 0.4 && top <= viewBottom + height * 0.65) {
        regions.push([left, bottom, right, top]);
      }
    }
  }
  return regions;
}

type RecognizeRegion = { anchor?: TextItem; image?: Region };

async function recognizePage(worker: OcrWorker, pdfjs: typeof PdfJs, page: PdfPage, { anchor, image }: RecognizeRegion = {}) {
  const original = page.getViewport({ scale: 1 });
  const scale = anchor || image ? 4 : Math.min(3, 2100 / Math.max(original.width, original.height));
  const viewport = page.getViewport({ scale });
  const area = anchor
    ? signatureArea(anchor, viewport)
    : { left: 0, top: 0, right: viewport.width, bottom: viewport.height };
  if (image) {
    const [x1 = 0, y1 = 0] = viewport.convertToViewportPoint(image[0], image[1]);
    const [x2 = 0, y2 = 0] = viewport.convertToViewportPoint(image[2], image[3]);
    const padding = 4 * scale;
    area.left = Math.max(0, Math.floor(Math.min(x1, x2) - padding));
    area.top = Math.max(0, Math.floor(Math.min(y1, y2) - padding));
    area.right = Math.min(viewport.width, Math.ceil(Math.max(x1, x2) + padding));
    area.bottom = Math.min(viewport.height, Math.ceil(Math.max(y1, y2) + padding));
  }
  if (area.right <= area.left || area.bottom <= area.top) return '';
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(area.right - area.left);
  canvas.height = Math.ceil(area.bottom - area.top);
  try {
    await page.render({
      canvas,
      viewport,
      annotationMode: pdfjs.AnnotationMode.DISABLE,
      transform: [1, 0, 0, 1, -area.left, -area.top],
    }).promise;
    const { data } = await worker.recognize(canvas);
    return data.text;
  } finally {
    canvas.width = canvas.height = 0;
  }
}

/** Throws a user-facing message for files that are too large or not PDFs. */
export async function validatePdf(file: Blob): Promise<void> {
  if (file.size > MAX_PDF_BYTES) throw new Error('El informe supera el límite de 20 MB.');
  if ((await file.slice(0, 5).text()) !== '%PDF-') throw new Error('Elegí un archivo PDF válido.');
}

/**
 * Extracts date, study types and doctor from a PDF. `onScan` fires once, right before the slow OCR starts.
 * Aborting `signal` stops everything and rejects with the abort reason.
 */
export async function analyzePdf(file: File, signal: AbortSignal, onScan: () => void): Promise<ExtractedFields> {
  await validatePdf(file);
  signal.throwIfAborted();
  const pdfjs = (await import(/* @vite-ignore */ vendor('pdf/pdf.min.mjs'))) as typeof PdfJs;
  signal.throwIfAborted();
  pdfjs.GlobalWorkerOptions.workerSrc = vendor('pdf/pdf.worker.min.mjs');
  const loading = pdfjs.getDocument({
    data: await file.arrayBuffer(),
    cMapUrl: vendor('pdf/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: vendor('pdf/standard_fonts/'),
    wasmUrl: vendor('pdf/wasm/'),
    iccUrl: vendor('pdf/iccs/'),
    // The old `isEvalSupported: false` option no longer exists in pdf.js 6 (eval is never used), so it is not passed.
  });
  let worker: OcrWorker | undefined;
  const stop = () => {
    void loading.destroy().catch(() => {});
    if (worker) void worker.terminate().catch(() => {});
  };
  signal.addEventListener('abort', stop, { once: true });

  try {
    signal.throwIfAborted();
    const document = await loading.promise;
    const pages: string[] = [];
    const pdfPages: PdfPage[] = [];
    const signatures: Array<{ page: PdfPage; region: RecognizeRegion }> = [];
    for (let number = 1; number <= Math.min(document.numPages, MAX_TEXT_PAGES); number++) {
      signal.throwIfAborted();
      const page = await document.getPage(number);
      pdfPages.push(page);
      const { items } = await page.getTextContent();
      pages.push(pageText(items));
      const anchor = items.find(
        (item): item is TextItem =>
          isTextItem(item) && /firmad[oa]\s+(?:electr[oó]nicamente|digitalmente)\s+por\s*:/i.test(item.str)
      );
      if (anchor) signatures.push({ page, region: { anchor } });
    }
    const found = extractFields(pages.join('\f'));
    if (Object.keys(found).length === 3) return found;
    const scanned = pages
      .slice(0, MAX_OCR_PAGES)
      .flatMap((text, index) => (text.replace(/[^\p{L}\d]/gu, '').length < SCANNED_PAGE_LETTERS ? [index + 1] : []));
    if (!found.doctor && signatures.length < 2) {
      for (const page of pdfPages) {
        signal.throwIfAborted();
        if (scanned.includes(page.pageNumber) || signatures.some((item) => item.page === page)) continue;
        try {
          const images = signatureImages((await page.getOperatorList()) as OperatorList, pdfjs, page.view);
          for (const image of images) signatures.push({ page, region: { image } });
        } catch {
          signal.throwIfAborted();
          // Failing to inspect the images must not discard what the text already gave us.
        }
        if (signatures.length >= 2) break;
      }
    }
    if (!scanned.length && (found.doctor || !signatures.length)) return found;

    onScan();
    const ocr = (await import(/* @vite-ignore */ vendor('ocr/tesseract.esm.min.js'))) as {
      default: typeof Tesseract;
    };
    signal.throwIfAborted();
    try {
      worker = await ocr.default.createWorker('spa', 1, {
        workerPath: vendor('ocr/worker.min.js'),
        workerBlobURL: false,
        corePath: vendor('ocr/core/'),
        langPath: vendor('ocr/lang/'),
      });
      signal.throwIfAborted();
      for (const number of scanned) {
        signal.throwIfAborted();
        const page = await document.getPage(number);
        pages[number - 1] += '\n' + (await recognizePage(worker, pdfjs, page));
      }
      const result = extractFields(pages.join('\f'));
      if (!result.doctor && signatures.length) {
        await worker.setParameters({ tessedit_pageseg_mode: '11' as never });
        const text: string[] = [];
        for (const { page, region } of signatures.slice(0, 2)) {
          signal.throwIfAborted();
          text.push(await recognizePage(worker, pdfjs, page, region));
        }
        const doctor = extractSignatureDoctor(text.join('\n'));
        if (doctor) result.doctor = doctor;
      }
      return result;
    } catch {
      signal.throwIfAborted();
      return extractFields(pages.join('\f'));
    }
  } finally {
    signal.removeEventListener('abort', stop);
    stop();
  }
}
