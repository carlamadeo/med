/** Tesseract and Spanish trained data are loaded only when a page needs OCR. */
import { expose, releaseProxy } from 'comlink';
import type * as Tesseract from 'tesseract.js';

export interface OcrWorkerApi {
  initialize(base: string, progress: (value: number) => void): Promise<void>;
  recognize(image: Blob): Promise<string>;
  sparseMode(): Promise<void>;
}

let worker: Awaited<ReturnType<typeof Tesseract.createWorker>>;
let notify: ((value: number) => void) | undefined;
const api: OcrWorkerApi = {
  async initialize(base, progress) {
    notify = progress;
    const url = (path: string) => new URL(path, base).href;
    const { default: ocr } = await import(/* @vite-ignore */ url('ocr/tesseract.esm.min.js')) as { default: typeof Tesseract };
    worker = await ocr.createWorker('spa', 1, {
      workerPath: url('ocr/worker.min.js'),
      workerBlobURL: false,
      corePath: url('ocr/core/'),
      langPath: url('ocr/lang/'),
      logger: (message) => {
        if (message.status === 'recognizing text') notify?.(message.progress);
      },
    });
  },
  async recognize(image) {
    const { data } = await worker.recognize(image);
    return data.text;
  },
  async sparseMode() {
    await worker.setParameters({ tessedit_pageseg_mode: '11' as Tesseract.PSM });
  },
};

expose({ ...api, [releaseProxy]: () => { notify = undefined; } });
