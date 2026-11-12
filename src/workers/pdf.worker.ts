import { expose } from 'comlink';
import { analyzeInWorker } from './pdf-engine';
import type { PdfWorkerApi } from './protocol';

expose({ analyze: analyzeInWorker } satisfies PdfWorkerApi);
