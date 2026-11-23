import type * as PdfJs from 'pdfjs-dist';

export async function renderPdfForPrint(file: File, signal: AbortSignal): Promise<Blob[]> {
    signal.throwIfAborted();
    const base = new URL(`${import.meta.env.BASE_URL}vendor/pdf/`, document.baseURI);
    const libraryUrl = new URL('pdf.min.mjs', base).href;
    const [pdfjs, data] = await Promise.all([
        import(/* @vite-ignore */ libraryUrl) as Promise<typeof PdfJs>,
        file.arrayBuffer(),
    ]);
    signal.throwIfAborted();
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', base).href;
    const loading = pdfjs.getDocument({
        data,
        cMapUrl: new URL('cmaps/', base).href,
        cMapPacked: true,
        standardFontDataUrl: new URL('standard_fonts/', base).href,
        wasmUrl: new URL('wasm/', base).href,
        iccUrl: new URL('iccs/', base).href,
        stopAtErrors: true,
    });
    let destroying: Promise<void> | undefined;
    const destroy = () => destroying ??= loading.destroy().catch(() => {
    });
    const abort = () => {
        void destroy();
    };
    signal.addEventListener('abort', abort, {once: true});
    const canvas = document.createElement('canvas');
    try {
        const report = await loading.promise;
        const pages: Blob[] = [];
        for (let number = 1; number <= report.numPages; number++) {
            signal.throwIfAborted();
            const page = await report.getPage(number);
            const {width, height} = page.getViewport({scale: 1});
            const viewport = page.getViewport({scale: Math.min(2.5, 2500 / Math.max(width, height))});
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            await page.render({canvas, viewport, intent: 'print'}).promise;
            pages.push(await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob(blob => {
                    if (blob) resolve(blob);
                    else reject(new Error('No se pudo preparar una página del PDF.'));
                }, 'image/png');
            }));
            page.cleanup();
        }
        signal.throwIfAborted();
        return pages;
    } finally {
        signal.removeEventListener('abort', abort);
        canvas.width = canvas.height = 0;
        await destroy();
    }
}
