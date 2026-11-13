/** Main-thread boundary: validate the attachment, then delegate all PDF work. */
import { proxy, releaseProxy, wrap } from 'comlink';
import type { ExtractedFields } from '@domain/extract';
import type { AnalysisProgress, PdfWorkerApi } from '@workers/protocol';

export { signatureImages } from '@domain/pdf-signatures';
export type { AnalysisProgress } from '@workers/protocol';
export const MAX_PDF_BYTES = 20 * 1024 * 1024;

export async function validatePdf(file: Blob): Promise<void> {
  if (file.size > MAX_PDF_BYTES) throw new Error('El informe supera el límite de 20 MB.');
  if ((await file.slice(0, 5).text()) !== '%PDF-') throw new Error('Elegí un archivo PDF válido.');
}

export async function analyzePdf(
  file: File,
  signal: AbortSignal,
  onScan: () => void,
  onProgress?: (event: AnalysisProgress) => void,
): Promise<ExtractedFields> {
  signal.throwIfAborted();
  await validatePdf(file);
  signal.throwIfAborted();
  const worker = new Worker(new URL('../workers/pdf.worker.ts', import.meta.url), { type: 'module', name: 'pdf-analysis' });
  const api = wrap<PdfWorkerApi>(worker);
  let scanned = false;
  try {
    return await new Promise<ExtractedFields>((resolve, reject) => {
      const stop = () => reject(signal.reason);
      const failed = () => reject(new Error('No pudimos iniciar la lectura del PDF.'));
      signal.addEventListener('abort', stop, { once: true });
      worker.addEventListener('error', failed);
      worker.addEventListener('messageerror', failed);
      const cleanup = () => {
        signal.removeEventListener('abort', stop);
        worker.removeEventListener('error', failed);
        worker.removeEventListener('messageerror', failed);
      };
      const base = new URL(`${import.meta.env.BASE_URL}vendor/`, document.baseURI).href;
      api.analyze(file, base, proxy((event: AnalysisProgress) => {
        if (signal.aborted) return;
        if (event.stage === 'ocr' && !scanned) { scanned = true; onScan(); }
        onProgress?.(event);
      })).then(resolve, reject).finally(cleanup);
      // Abort must also clean up if the worker never answers the outstanding RPC.
      signal.addEventListener('abort', cleanup, { once: true });
    });
  } finally {
    api[releaseProxy]();
    worker.terminate();
  }
}
