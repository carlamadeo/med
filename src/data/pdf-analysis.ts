/** Main-thread boundary: validate the attachment, then delegate all PDF work. */
import {proxy, releaseProxy, wrap, type Remote} from 'comlink';
import {extractFields, type ExtractedFields} from '@domain/extract';
import type {AnalysisProgress, PdfWorkerApi} from '@workers/protocol';
import type {OcrWorkerApi} from '@workers/ocr.worker';

export {signatureImages} from '@domain/pdf-signatures';
export type {AnalysisProgress} from '@workers/protocol';
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

async function runWorkerTask<Api, Result>(
    workerUrl: URL,
    workerName: string,
    signal: AbortSignal,
    startupError: string,
    run: (api: Remote<Api>, base: string) => Promise<Result>,
): Promise<Result> {
    const worker = new Worker(workerUrl, {type: 'module', name: workerName});
    const api = wrap<Api>(worker);
    try {
        signal.throwIfAborted();
        return await new Promise<Result>((resolve, reject) => {
            const stop = () => reject(signal.reason);
            const failed = () => reject(new Error(startupError));
            signal.addEventListener('abort', stop, {once: true});
            worker.addEventListener('error', failed);
            worker.addEventListener('messageerror', failed);
            const cleanup = () => {
                signal.removeEventListener('abort', stop);
                worker.removeEventListener('error', failed);
                worker.removeEventListener('messageerror', failed);
            };
            const base = new URL(`${import.meta.env.BASE_URL}vendor/`, document.baseURI).href;
            run(api, base).then(resolve, reject).finally(cleanup);
            // Abort must also clean up if the worker never answers the outstanding RPC.
            signal.addEventListener('abort', cleanup, {once: true});
        });
    } finally {
        api[releaseProxy]();
        worker.terminate();
    }
}

export async function validateDocument(file: Blob): Promise<'application/pdf' | 'image/jpeg' | 'image/png'> {
    if (file.size > MAX_DOCUMENT_BYTES) throw new Error('El informe supera el límite de 20 MB.');
    const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if ([37, 80, 68, 70, 45].every((value, index) => bytes[index] === value)) return 'application/pdf';
    if ([255, 216, 255].every((value, index) => bytes[index] === value)) return 'image/jpeg';
    if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
    throw new Error('Elegí un archivo PDF, JPEG o PNG válido.');
}

export async function analyzePdf(
    file: File,
    signal: AbortSignal,
    onScan: () => void,
    onProgress?: (event: AnalysisProgress) => void,
): Promise<ExtractedFields> {
    signal.throwIfAborted();
    const type = await validateDocument(file);
    signal.throwIfAborted();
    if (type !== 'application/pdf') {
        onScan();
        const text = await runWorkerTask<OcrWorkerApi, string>(
            new URL('../workers/ocr.worker.ts', import.meta.url),
            'ocr-analysis',
            signal,
            'No pudimos iniciar la lectura de la imagen.',
            (api, base) =>
                api.initialize(base, proxy((progress: number) => {
                    if (!signal.aborted) onProgress?.({stage: 'ocr', page: 1, total: 1, progress});
                })).then(() => api.recognize(new Blob([file], {type}))),
        );
        return extractFields(text);
    }
    let scanned = false;
    return runWorkerTask<PdfWorkerApi, ExtractedFields>(
        new URL('../workers/pdf.worker.ts', import.meta.url),
        'pdf-analysis',
        signal,
        'No pudimos iniciar la lectura del PDF.',
        (api, base) =>
            api.analyze(file, base, proxy((event: AnalysisProgress) => {
                if (signal.aborted) return;
                if (event.stage === 'ocr' && !scanned) {
                    scanned = true;
                    onScan();
                }
                onProgress?.(event);
            })),
    );
}
