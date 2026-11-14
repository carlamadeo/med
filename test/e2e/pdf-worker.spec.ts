import {expect, test} from '@playwright/test';

// A self-contained synthetic report. No patient documents or Google credentials are used.
function pdf(objects: string[]) {
    let content = '%PDF-1.4\n';
    const offsets = [0];
    for (const [index, object] of objects.entries()) {
        offsets.push(Buffer.byteLength(content, 'latin1'));
        content += `${index + 1} 0 obj\n${object}\nendobj\n`;
    }
    const xref = Buffer.byteLength(content, 'latin1');
    content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    content += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(content, 'latin1').toString('base64');
}

const text = 'BT /F1 16 Tf 50 750 Td (Estudio: Ecografia) Tj 0 -30 Td (Fecha: 18/03/2024) Tj 0 -30 Td (Medico: Dra. Ana Perez) Tj 0 -30 Td (Informe de control con resultados normales. Documento sintetico para pruebas de lectura.) Tj ET';
const report = pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
]);

test('reads a real PDF through the worker and reports page progress', async ({page}) => {
    await page.goto('/');
    const result = await page.evaluate(async (encoded) => {
        const path = '/src/data/pdf-analysis.ts';
        const {analyzePdf} = await import(path);
        const progress: unknown[] = [];
        const file = new File([Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))], 'report.pdf');
        const fields = await analyzePdf(file, new AbortController().signal, () => {
        }, (event: unknown) => progress.push(event));
        return {fields, progress};
    }, report);
    expect(result.fields).toEqual({date: '2024-03-18', types: ['Ecografía'], doctor: 'Dra. Ana Perez'});
    expect(result.progress).toContainEqual({stage: 'text', page: 1, total: 1, progress: 0});
});

test('aborting stops a worker job promptly', async ({page}) => {
    await page.goto('/');
    const result = await page.evaluate(async (encoded) => {
        const path = '/src/data/pdf-analysis.ts';
        const {analyzePdf} = await import(path);
        const file = new File([Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))], 'report.pdf');
        const controller = new AbortController();
        const job = analyzePdf(file, controller.signal, () => {
        }, () => controller.abort());
        try {
            await job;
            return 'unexpected success';
        } catch (error) {
            return (error as Error).name;
        }
    }, report);
    expect(result).toBe('AbortError');
});

test('reads a PNG image with OCR in a worker', async ({page}) => {
    test.setTimeout(90000);
    await page.goto('/');
    const result = await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 600;
        const context = canvas.getContext('2d')!;
        context.fillStyle = 'white';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = 'black';
        context.font = '40px Arial';
        ['Estudio: Ecografia', 'Fecha: 18/03/2024', 'Medico: Dra. Ana Perez'].forEach((line, index) => context.fillText(line, 70, 100 + index * 90));
        const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
        const path = '/src/data/pdf-analysis.ts';
        const {analyzePdf} = await import(path);
        const progress: Array<{ stage: string }> = [];
        const fields = await analyzePdf(new File([blob], 'informe.png', {type: 'image/png'}), new AbortController().signal, () => {
        }, (event: { stage: string }) => progress.push(event));
        return {fields, progress};
    });
    expect(result.fields.date).toBe('2024-03-18');
    expect(result.fields.types).toEqual(['Ecografía']);
    expect(result.progress.some(event => event.stage === 'ocr')).toBe(true);
});

test('cancels image OCR when the user cancels before recognition', async ({page}) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
        const path = '/src/data/pdf-analysis.ts';
        const {analyzePdf} = await import(path);
        const controller = new AbortController();
        try {
            await analyzePdf(new File([blob], 'informe.png'), controller.signal, () => controller.abort());
            return 'unexpected success';
        } catch (error) {
            return (error as Error).name;
        }
    });
    expect(result).toBe('AbortError');
});

test('recognizes a scanned report with Spanish OCR off the UI thread', async ({page}) => {
    test.setTimeout(90000);
    await page.goto('/');
    const jpeg = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 800;
        const context = canvas.getContext('2d')!;
        context.fillStyle = 'white';
        context.fillRect(0, 0, 1200, 800);
        context.fillStyle = 'black';
        context.font = '40px Arial';
        ['Estudio: Ecografia', 'Fecha: 18/03/2024', 'Medico: Dra. Ana Perez'].forEach((line, index) => context.fillText(line, 70, 100 + index * 90));
        return canvas.toDataURL('image/jpeg', 0.95).split(',')[1]!;
    });
    const image = Buffer.from(jpeg, 'base64').toString('latin1');
    const paint = 'q 595 0 0 397 0 0 cm /Im1 Do Q';
    const scan = pdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 397] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>',
        `<< /Type /XObject /Subtype /Image /Width 1200 /Height 800 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n${image}\nendstream`,
        `<< /Length ${paint.length} >>\nstream\n${paint}\nendstream`,
    ]);
    const result = await page.evaluate(async (encoded) => {
        const path = '/src/data/pdf-analysis.ts';
        const {analyzePdf} = await import(path);
        let ticks = 0;
        const timer = setInterval(() => ticks++, 20);
        const progress: Array<{ stage: string }> = [];
        try {
            const file = new File([Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))], 'scan.pdf');
            const fields = await analyzePdf(file, new AbortController().signal, () => {
            }, (event: { stage: string }) => progress.push(event));
            return {fields, ticks, ocr: progress.some((event) => event.stage === 'ocr')};
        } finally {
            clearInterval(timer);
        }
    }, scan);
    expect(result.fields.date).toBe('2024-03-18');
    expect(result.fields.types).toEqual(['Ecografía']);
    expect(result.ocr).toBe(true);
    expect(result.ticks).toBeGreaterThan(0);
});
