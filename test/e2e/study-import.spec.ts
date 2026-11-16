import {expect, test} from '@playwright/test';
import {navigateTo} from './nav';

test('allows reviewing a batch containing a PDF and an invalid file', async ({page}) => {
    await page.route('https://accounts.google.com/**', route => route.fulfill({body: '', contentType: 'text/javascript'}));
    await page.route('https://www.googleapis.com/**', route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/drive/v3/about') return route.fulfill({json: {user: {me: true, permissionId: 'test-account'}}});
        if (url.pathname === '/drive/v3/files') return route.fulfill({json: {files: []}});
        return route.fulfill({status: 404});
    });
    await page.addInitScript(() => {
        sessionStorage.setItem('mis-estudios:drive-session:123-test.apps.googleusercontent.com', JSON.stringify({accessToken: 'synthetic-token', expires: Date.now() + 3600000}));
        localStorage.setItem('mis-estudios-onboarding-seen', 'true');
    });
    const content = 'BT /F1 16 Tf 50 750 Td (Estudio: Ecografia) Tj 0 -30 Td (Fecha: 18/03/2020) Tj ET';
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    await page.goto('/');
    await navigateTo(page, 'cronologia');
    await page.getByRole('button', {name: 'Importar estudios'}).click();
    const dialog = page.getByRole('dialog', {name: 'Importar estudios'});
    await dialog.locator('input[type=file]').setInputFiles([{name: 'estudio.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf)}, {name: 'incorrecto.pdf', mimeType: 'application/pdf', buffer: Buffer.from('invalid')}]);
    await expect(dialog.getByText('No se pudo abrir el PDF.')).toBeVisible();
    await expect(dialog.getByLabel('Fecha').first()).toHaveValue('2020-03-18');
    await expect(dialog.getByText('1 estudios listos para guardar')).toBeVisible();
    for (const width of [320, 390]) {
        await page.setViewportSize({width, height: 700});
        for (const theme of ['light', 'dark']) {
            if (await page.locator('html').getAttribute('data-theme') !== theme) {
                await page.getByRole('button', {name: /Cambiar a modo/}).click({force: true});
            }
            await expect(dialog.getByRole('button', {name: 'Guardar estudios seleccionados'})).toBeInViewport();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        }
    }
});

test('saves the complete multipage PDF in the selected account', async ({page, browserName}) => {
    test.skip(browserName === 'webkit', 'WebKit does not expose this multipart request body to Playwright.');
    const content = 'BT /F1 16 Tf 50 750 Td (Estudio: Ecografia) Tj 0 -30 Td (Fecha: 18/03/2020) Tj ET';
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
        '<< /Length 0 >>\nstream\n\nendstream',
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const original = Buffer.from(pdf);
    const stored: Buffer[] = [];
    const savedDescriptions: string[] = [];
    let nextId = 0;
    await page.route('https://accounts.google.com/**', route => route.fulfill({body: '', contentType: 'text/javascript'}));
    await page.route('https://www.googleapis.com/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/drive/v3/about') return route.fulfill({json: {user: {me: true, permissionId: 'test-account'}}});
        if (url.pathname === '/drive/v3/files/generateIds') return route.fulfill({json: {ids: [`study-${++nextId}`]}});
        if (url.pathname === '/drive/v3/files' && route.request().method() === 'GET') {
            const query = url.searchParams.get('q') ?? '';
            if (query.includes('folder')) return route.fulfill({json: {files: [{id: 'folder-1'}]}});
            return route.fulfill({json: {files: []}});
        }
        if (url.pathname === '/upload/drive/v3/files') {
            const bytes = route.request().postDataBuffer()!;
            const start = bytes.indexOf(Buffer.from('%PDF-'));
            const end = bytes.indexOf(Buffer.from('\r\n--mis-estudios-', 'utf8'), start);
            stored.push(bytes.subarray(start, end));
            const metadata = JSON.parse(bytes.subarray(bytes.indexOf('{'), bytes.indexOf('\r\n--mis-estudios-', bytes.indexOf('{'))).toString());
            savedDescriptions.push(metadata.description);
            return route.fulfill({json: {id: metadata.id, name: metadata.name, description: metadata.description, mimeType: 'application/pdf', version: '1', modifiedTime: '2020-01-01T00:00:00Z', appProperties: {misEstudios: 'estudio-v1'}}});
        }
        return route.fulfill({status: 404});
    });
    await page.addInitScript(() => {
        sessionStorage.setItem('mis-estudios:drive-session:123-test.apps.googleusercontent.com', JSON.stringify({accessToken: 'synthetic-token', expires: Date.now() + 3600000}));
        localStorage.setItem('mis-estudios-onboarding-seen', 'true');
    });
    await page.goto('/');
    await navigateTo(page, 'cronologia');
    await page.getByRole('button', {name: 'Importar estudios'}).click();
    const dialog = page.getByRole('dialog', {name: 'Importar estudios'});
    const second = Buffer.concat([original, Buffer.from('\n')]);
    await dialog.locator('input[type=file]').setInputFiles([{name: 'multipagina.pdf', mimeType: 'application/pdf', buffer: original}, {name: 'segundo.pdf', mimeType: 'application/pdf', buffer: second}]);
    await expect(dialog.getByText('2 estudios listos para guardar')).toBeVisible();
    await dialog.getByRole('button', {name: 'Guardar estudios seleccionados'}).click();
    await expect(dialog.getByText('Guardado', {exact: true})).toHaveCount(2);
    expect(stored).toEqual([original, second]);
    expect(savedDescriptions.map(description => JSON.parse(description).date)).toEqual(['2020-03-18', '2020-03-18']);
});
