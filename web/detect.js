import { extractFields, extractSignatureDoctor } from './extract.js';

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

function signatureArea(item, viewport) {
  const [,,,, x, y] = item.transform;
  const [left, top] = viewport.convertToViewportPoint(x, y);
  const scale = viewport.scale;
  return {
    left: Math.max(0, Math.floor(left - 12 * scale)),
    top: Math.max(0, Math.floor(top + 2 * scale)),
    right: Math.min(viewport.width, Math.ceil(left + (Math.max(item.width, 160) + 10) * scale)),
    bottom: Math.min(viewport.height, Math.ceil(top + 110 * scale)),
  };
}

export function signatureImages(operators, pdfjs, view) {
  const { OPS, Util } = pdfjs;
  const stack = [];
  let transform = [1, 0, 0, 1, 0, 0];
  const regions = [];
  for (let i = 0; i < operators.fnArray.length; i++) {
    const op = operators.fnArray[i];
    if (op === OPS.save) stack.push(transform);
    else if (op === OPS.restore) transform = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (op === OPS.transform) transform = Util.transform(transform, operators.argsArray[i]);
    else if ([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject].includes(op)) {
      const [a, b, c, d, e, f] = transform;
      const left = Math.max(view[0], Math.min(e, e + a, e + c, e + a + c));
      const right = Math.min(view[2], Math.max(e, e + a, e + c, e + a + c));
      const bottom = Math.max(view[1], Math.min(f, f + b, f + d, f + b + d));
      const top = Math.min(view[3], Math.max(f, f + b, f + d, f + b + d));
      const height = view[3] - view[1];
      // Buscamos sellos en la parte inferior, sin volver a leer escaneos de página completa.
      if (right - left >= 60 && top - bottom >= 15 && top - bottom <= height * 0.4 &&
          top <= view[1] + height * 0.65) regions.push([left, bottom, right, top]);
    }
  }
  return regions;
}

async function recognizePage(worker, pdfjs, page, { anchor, image } = {}) {
  const original = page.getViewport({ scale: 1 });
  const scale = anchor || image ? 4 : Math.min(3, 2100 / Math.max(original.width, original.height));
  const viewport = page.getViewport({ scale });
  const area = anchor ? signatureArea(anchor, viewport) : {
    left: 0, top: 0, right: viewport.width, bottom: viewport.height,
  };
  if (image) {
    const [x1, y1] = viewport.convertToViewportPoint(image[0], image[1]);
    const [x2, y2] = viewport.convertToViewportPoint(image[2], image[3]);
    const padding = 4 * scale;
    area.left = Math.max(0, Math.floor(Math.min(x1, x2) - padding));
    area.top = Math.max(0, Math.floor(Math.min(y1, y2) - padding));
    area.right = Math.min(viewport.width, Math.ceil(Math.max(x1, x2) + padding));
    area.bottom = Math.min(viewport.height, Math.ceil(Math.max(y1, y2) + padding));
  }
  if (area.right <= area.left || area.bottom <= area.top) return '';
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = Math.ceil(area.right - area.left);
  canvas.height = Math.ceil(area.bottom - area.top);
  try {
    await page.render({
      canvas, viewport, annotationMode: pdfjs.AnnotationMode.DISABLE,
      transform: [1, 0, 0, 1, -area.left, -area.top],
    }).promise;
    const { data } = await worker.recognize(canvas);
    return data.text;
  } finally {
    canvas.width = canvas.height = 0;
  }
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
    const pdfPages = [];
    const signatures = [];
    for (let number = 1; number <= Math.min(document.numPages, 6); number++) {
      signal.throwIfAborted();
      const page = await document.getPage(number);
      pdfPages.push(page);
      const { items } = await page.getTextContent();
      pages.push(pageText(items));
      const anchor = items.find((item) => /firmad[oa]\s+(?:electr[oó]nicamente|digitalmente)\s+por\s*:/i.test(item.str));
      if (anchor) signatures.push({ page, region: { anchor } });
    }
    const found = extractFields(pages.join('\f'));
    if (Object.keys(found).length === 3) return found;
    const scanned = pages.slice(0, 3).flatMap((text, index) =>
      text.replace(/[^\p{L}\d]/gu, '').length < 70 ? [index + 1] : []);
    if (!found.doctor && signatures.length < 2) {
      for (const page of pdfPages) {
        signal.throwIfAborted();
        if (scanned.includes(page.pageNumber) || signatures.some((item) => item.page === page)) continue;
        try {
          const images = signatureImages(await page.getOperatorList(), pdfjs, page.view);
          for (const image of images) signatures.push({ page, region: { image } });
        } catch {
          signal.throwIfAborted();
          // Un error al inspeccionar las imágenes no descarta los datos del texto.
        }
        if (signatures.length >= 2) break;
      }
    }
    if (!scanned.length && (found.doctor || !signatures.length)) return found;

    onScan();
    const { default: { createWorker } } = await import('./vendor/ocr/tesseract.esm.min.js');
    signal.throwIfAborted();
    try {
      worker = await createWorker('spa', 1, {
        workerPath: vendor('ocr/worker.min.js'), workerBlobURL: false,
        corePath: vendor('ocr/core/'), langPath: vendor('ocr/lang/'),
      });
      signal.throwIfAborted();
      for (const number of scanned) {
        signal.throwIfAborted();
        const page = await document.getPage(number);
        pages[number - 1] += '\n' + await recognizePage(worker, pdfjs, page);
      }
      const result = extractFields(pages.join('\f'));
      if (!result.doctor && signatures.length) {
        await worker.setParameters({ tessedit_pageseg_mode: '11' });
        const text = [];
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
