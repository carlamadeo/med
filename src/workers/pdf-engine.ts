/**
 * Reads a report PDF in the browser: text first (pdf.js), OCR (Tesseract) only for scanned pages and signature
 * stamps. Ported from web/detect.js. pdf.js and Tesseract are loaded as static files from `vendor/` (copied by
 * scripts/vendor.mjs) instead of being bundled: they ship workers, WASM, fonts and language data by URL.
 */
import {extractFields, extractSignatureDoctor, type ExtractedFields} from '@domain/extract';

import {signatureImages} from '@domain/pdf-signatures';
import type {AnalysisProgress} from './protocol';
import type * as PdfJs from 'pdfjs-dist';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import type {TextItem} from 'pdfjs-dist/types/src/display/api';
import {proxy, wrap} from 'comlink';
import type {OcrWorkerApi} from './ocr.worker';

type PdfPage = Awaited<ReturnType<PDFDocumentProxy['getPage']>>;
type Viewport = ReturnType<PdfPage['getViewport']>;

/** [left, bottom, right, top] in PDF user space. */
type Region = [number, number, number, number];

interface OperatorList {
    fnArray: number[];
    argsArray: unknown[];
}


const MAX_TEXT_PAGES = 6;
const MAX_OCR_PAGES = 3;
const SCANNED_PAGE_LETTERS = 70;

/** Resolved against the page URL so the app works from any sub-path (GitHub Pages). */
let vendorBase = '';
const vendor = (path: string): string => new URL(path, vendorBase).href;

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
        previous = {y, end: x + item.width};
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


type RecognizeRegion = { anchor?: TextItem; image?: Region };

async function recognizePage(worker: OcrWorkerApi, pdfjs: typeof PdfJs, page: PdfPage, {
    anchor,
    image
}: RecognizeRegion = {}) {
    const original = page.getViewport({scale: 1});
    const scale = anchor || image ? 4 : Math.min(3, 2100 / Math.max(original.width, original.height));
    const viewport = page.getViewport({scale});
    const area = anchor
        ? signatureArea(anchor, viewport)
        : {left: 0, top: 0, right: viewport.width, bottom: viewport.height};
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
    const canvas = new OffscreenCanvas(Math.ceil(area.right - area.left), Math.ceil(area.bottom - area.top));
    try {
        await page.render({
            canvas: canvas as unknown as HTMLCanvasElement,
            viewport,
            annotationMode: pdfjs.AnnotationMode.DISABLE,
            transform: [1, 0, 0, 1, -area.left, -area.top],
        }).promise;
        return await worker.recognize(await canvas.convertToBlob({type: 'image/png'}));
    } finally {
        canvas.width = canvas.height = 0;
    }
}

/** One job per worker: terminating it aborts PDF parsing, rendering and its OCR child. */
export async function analyzeInWorker(file: File, base: string, onProgress: (event: AnalysisProgress) => void): Promise<ExtractedFields> {
    vendorBase = base;
    const signal = new AbortController().signal;
    signal.throwIfAborted();
    const pdfjs = (await import(/* @vite-ignore */ vendor('pdf/pdf.min.mjs'))) as typeof PdfJs;
    signal.throwIfAborted();
    pdfjs.GlobalWorkerOptions.workerSrc = vendor('pdf/pdf.worker.min.mjs');
    const loading = pdfjs.getDocument({
        data: await file.arrayBuffer(),
        useWorkerFetch: true,
        disableFontFace: true,
        useSystemFonts: false,
        // pdf.js uses this factory for auxiliary canvases; workers have no DOM.
        ownerDocument: {createElement: () => new OffscreenCanvas(1, 1)} as unknown as Document,
        cMapUrl: vendor('pdf/cmaps/'),
        cMapPacked: true,
        standardFontDataUrl: vendor('pdf/standard_fonts/'),
        wasmUrl: vendor('pdf/wasm/'),
        iccUrl: vendor('pdf/iccs/'),
        // The old `isEvalSupported: false` option no longer exists in pdf.js 6 (eval is never used), so it is not passed.
    });
    let ocrThread: Worker | undefined;
    const stop = () => {
        void loading.destroy().catch(() => {
        });
        ocrThread?.terminate();
    };
    signal.addEventListener('abort', stop, {once: true});

    try {
        signal.throwIfAborted();
        const document = await loading.promise;
        const pages: string[] = [];
        const pdfPages: PdfPage[] = [];
        const signatures: Array<{ page: PdfPage; region: RecognizeRegion }> = [];
        for (let number = 1; number <= Math.min(document.numPages, MAX_TEXT_PAGES); number++) {
            signal.throwIfAborted();
            onProgress({stage: 'text', page: number, total: Math.min(document.numPages, MAX_TEXT_PAGES), progress: 0});
            const page = await document.getPage(number);
            pdfPages.push(page);
            const {items} = await page.getTextContent();
            pages.push(pageText(items));
            const anchor = items.find(
                (item): item is TextItem =>
                    isTextItem(item) && /firmad[oa]\s+(?:electr[oó]nicamente|digitalmente)\s+por\s*:/i.test(item.str)
            );
            if (anchor) signatures.push({page, region: {anchor}});
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
                    for (const image of images) signatures.push({page, region: {image}});
                } catch {
                    signal.throwIfAborted();
                    // Failing to inspect the images must not discard what the text already gave us.
                }
                if (signatures.length >= 2) break;
            }
        }
        if (!scanned.length && (found.doctor || !signatures.length)) return found;

        onProgress({stage: 'ocr', page: scanned[0] ?? 1, total: document.numPages, progress: 0});
        let currentPage = scanned[0] ?? 1;
        try {
            ocrThread = new Worker(new URL('./ocr.worker.ts', import.meta.url), {type: 'module', name: 'ocr-analysis'});
            const worker = wrap<OcrWorkerApi>(ocrThread);
            await worker.initialize(base, proxy((progress: number) => {
                onProgress({stage: 'ocr', page: currentPage, total: document.numPages, progress});
            }));
            signal.throwIfAborted();
            for (const number of scanned) {
                currentPage = number;
                signal.throwIfAborted();
                const page = await document.getPage(number);
                pages[number - 1] += '\n' + (await recognizePage(worker, pdfjs, page));
            }
            const result = extractFields(pages.join('\f'));
            if (!result.doctor && signatures.length) {
                await worker.sparseMode();
                const text: string[] = [];
                for (const {page, region} of signatures.slice(0, 2)) {
                    currentPage = page.pageNumber;
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
