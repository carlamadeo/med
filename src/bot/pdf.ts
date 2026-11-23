import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CONFIG} from '@core/config';
import {validateDocument} from '@data/pdf-analysis';
import {extractFields, type ExtractedFields} from '@domain/extract';
import {pageText} from '@workers/pdf-text-layout';

const resolve = createRequire(import.meta.url).resolve;
const pdfAssets = new URL('../../', import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs'));

export async function readReport(file: File): Promise<ExtractedFields> {
    if (await validateDocument(file) !== 'application/pdf') throw new Error('El adjunto tiene que ser un PDF.');
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const asset = (path: string) => fileURLToPath(new URL(path, pdfAssets));
    const loading = pdfjs.getDocument({
        data: new Uint8Array(await file.arrayBuffer()), disableFontFace: true, useSystemFonts: false,
        cMapUrl: asset('cmaps/'), cMapPacked: true, standardFontDataUrl: asset('standard_fonts/'),
        wasmUrl: asset('wasm/'), iccUrl: asset('iccs/'),
    });
    let readable: ExtractedFields = {};
    try {
        const pdf = await loading.promise;
        const pages: string[] = [];
        for (let i = 1; i <= Math.min(pdf.numPages, CONFIG.PDF_MAX_PAGES_TEXT); i++) {
            const page = await pdf.getPage(i);
            pages.push(pageText((await page.getTextContent()).items));
        }
        readable = extractFields(pages.join('\f'));
        if (readable.date && readable.types?.length && readable.doctor) return readable;
        const scans = pages.slice(0, CONFIG.PDF_MAX_PAGES_OCR)
            .flatMap((page, i) => page.replace(/[^\p{L}\d]/gu, '').length < CONFIG.SCANNED_THRESHOLD ? [i] : []);
        if (!scans.length) return readable;

        // PDF.js supplies a Node canvas. OCR works with the Spanish language data shipped with the app.
        const factory = pdf.canvasFactory as {
            create(width: number, height: number): {
                canvas: HTMLCanvasElement & { toBuffer(type: 'image/png'): Buffer }
            };
            destroy(image: { canvas: HTMLCanvasElement }): void;
        };
        const {createWorker} = await import('tesseract.js');
        const langPath = join(dirname(resolve('@tesseract.js-data/spa')), '4.0.0');
        const worker = await createWorker('spa', 1, {
            langPath, cacheMethod: 'none', errorHandler: () => {
                // Tesseract rejects the OCR job separately. Avoid throwing from its message handler.
            }
        });
        try {
            for (const i of scans) {
                const page = await pdf.getPage(i + 1);
                const normal = page.getViewport({scale: 1});
                const viewport = page.getViewport({scale: Math.min(2, 1800 / Math.max(normal.width, normal.height))});
                const image = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
                try {
                    await page.render({
                        canvas: image.canvas,
                        viewport,
                        annotationMode: pdfjs.AnnotationMode.DISABLE
                    }).promise;
                    const {data} = await worker.recognize(image.canvas.toBuffer('image/png'));
                    pages[i] += `\n${data.text}`;
                } finally {
                    factory.destroy(image);
                }
            }
        } finally {
            await worker.terminate();
        }
        return extractFields(pages.join('\f'));
    } catch {
        // Preserve the text already extracted if the scan is encrypted or OCR fails.
        return readable;
    } finally {
        await loading.destroy().catch(() => {
        });
    }
}
