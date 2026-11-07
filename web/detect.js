import { extractFields } from './extract.js';

const vendor = (path) => new URL('./vendor/' + path, import.meta.url).href;

function pageText(items) {
  let text = '';
  let previous;
  for (const item of items) {
    if (!('str' in item)) continue;
    const [,,,, x, y] = item.transform;
    if (previous && Math.abs(previous.y - y) > 4 && !text.endsWith('\n')) text += '\n';
    else if (previous && x - previous.end > 18 && !text.endsWith('\n')) text += '  ';
    text += item.str;
    if (item.hasEOL) text += '\n';
    previous = { y, end: x + item.width };
  }
  return text;
}

export async function validatePdf(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error('El informe supera el límite de 20 MB.');
  if (await file.slice(0, 5).text() !== '%PDF-') throw new Error('Elegí un archivo PDF válido.');
}

export async function analyzePdf(file, signal, onScan) {
  await validatePdf(file);
  signal.throwIfAborted();
  const pdfjs = await import('./vendor/pdf/pdf.min.mjs');
  signal.throwIfAborted();
  pdfjs.GlobalWorkerOptions.workerSrc = vendor('pdf/pdf.worker.min.mjs');
  const loading = pdfjs.getDocument({
    data: await file.arrayBuffer(),
    cMapUrl: vendor('pdf/cmaps/'), cMapPacked: true,
    standardFontDataUrl: vendor('pdf/standard_fonts/'),
    wasmUrl: vendor('pdf/wasm/'), iccUrl: vendor('pdf/iccs/'),
    isEvalSupported: false,
  });
  let worker;
  const stop = () => {
    void loading.destroy().catch(() => {});
    if (worker) void worker.terminate().catch(() => {});
  };
  signal.addEventListener('abort', stop, { once: true });

  try {
    signal.throwIfAborted();
    const document = await loading.promise;
    const pages = [];
    for (let number = 1; number <= Math.min(document.numPages, 6); number++) {
      signal.throwIfAborted();
      const page = await document.getPage(number);
      pages.push(pageText((await page.getTextContent()).items));
    }
    const found = extractFields(pages.join('\f'));
    if (Object.keys(found).length === 3) return found;
    const scanned = pages.slice(0, 3).flatMap((text, index) =>
      text.replace(/[^\p{L}\d]/gu, '').length < 70 ? [index + 1] : []);
    if (!scanned.length) return found;

    onScan();
    const { default: { createWorker } } = await import('./vendor/ocr/tesseract.esm.min.js');
    signal.throwIfAborted();
    worker = await createWorker('spa', 1, {
      workerPath: vendor('ocr/worker.min.js'), workerBlobURL: false,
      corePath: vendor('ocr/core/'), langPath: vendor('ocr/lang/'),
    });
    for (const number of scanned) {
      signal.throwIfAborted();
      const page = await document.getPage(number);
      const original = page.getViewport({ scale: 1 });
      const scale = Math.min(3, 2100 / Math.max(original.width, original.height));
      const viewport = page.getViewport({ scale });
      const canvas = globalThis.document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      try {
        await page.render({ canvas, viewport, annotationMode: pdfjs.AnnotationMode.DISABLE }).promise;
        const { data } = await worker.recognize(canvas);
        pages[number - 1] += '\n' + data.text;
      } finally {
        canvas.width = canvas.height = 0;
      }
    }
    return extractFields(pages.join('\f'));
  } finally {
    signal.removeEventListener('abort', stop);
    stop();
  }
}
