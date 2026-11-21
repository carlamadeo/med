import {expect, test} from '@playwright/test';
import {navigateTo} from './nav';

test('guarda sin conexión y sincroniza una vez al reconectar la cuenta', async ({page, context}) => {
    const files: Array<Record<string, unknown>> = [];
    let uploads = 0;
    await page.route('https://accounts.google.com/**', route => route.fulfill({body: '', contentType: 'text/javascript'}));
    await page.route('https://www.googleapis.com/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/drive/v3/about') return route.fulfill({json: {user: {me: true, permissionId: 'test-account'}}});
        if (url.pathname === '/drive/v3/files/generateIds') return route.fulfill({json: {ids: ['study-offline']}});
        if (url.pathname === '/drive/v3/files' && route.request().method() === 'GET') {
            const query = url.searchParams.get('q') ?? '';
            if (query.includes('carpeta-v1')) return route.fulfill({json: {files: [{id: 'folder-1'}]}});
            return route.fulfill({json: {files: query.includes('estudio-v1') ? files : []}});
        }
        if (url.pathname === '/upload/drive/v3/files') {
            const data = route.request().postData() ?? '';
            const start = data.indexOf('{');
            const end = data.indexOf('\r\n--mis-estudios-', start);
            const metadata = JSON.parse(data.slice(start, end));
            uploads++;
            const saved = {...metadata, version: '1', modifiedTime: '2026-01-01T00:00:00Z', trashed: false};
            files.push(saved);
            return route.fulfill({json: saved});
        }
        return route.fulfill({status: 404});
    });
    await page.addInitScript(() => {
        sessionStorage.setItem('mis-estudios:drive-session:123-test.apps.googleusercontent.com', JSON.stringify({accessToken: 'synthetic-token', expires: Date.now() + 3600000}));
        localStorage.setItem('mis-estudios-onboarding-seen', 'true');
    });
    await page.goto('/');
    await expect(page.getByRole('heading', {name: 'Resumen', level: 1})).toBeVisible();
    await navigateTo(page, 'cronologia');
    await context.setOffline(true);
    await page.locator('[data-add]').click();
    const editor = page.getByRole('dialog', {name: 'Agregar estudio'});
    await editor.getByRole('textbox', {name: 'Nombre del estudio'}).fill('Estudio pendiente QA');
    await editor.locator('input[name="date"]').fill('2026-01-01');
    await editor.getByRole('combobox', {name: 'Tipos de estudio'}).click();
    await editor.getByRole('option', {name: 'Ecografía', exact: true}).click();
    await editor.getByRole('textbox', {name: /Especialidad/}).fill('Endocrinología pediátrica');
    await editor.getByRole('textbox', {name: 'Nombre del estudio'}).click();
    await editor.getByRole('button', {name: 'Guardar estudio'}).click();
    const row = page.getByRole('row').filter({hasText: 'Estudio pendiente QA'});
    await expect(row).toContainText('Pendiente de sincronización');
    const specialty = page.getByRole('combobox', {name: 'Filtrar por especialidad'});
    await specialty.selectOption({label: 'Endocrinología pediátrica'});
    await expect(row).toContainText('Endocrinología pediátrica');
    expect(uploads).toBe(0);
    await context.setOffline(false);
    await expect(row).not.toContainText('Pendiente de sincronización', {timeout: 15000});
    expect(uploads).toBe(1);
    await page.reload();
    await expect(page.getByRole('heading', {name: 'Resumen', level: 1})).toBeVisible();
    await navigateTo(page, 'cronologia');
    await specialty.selectOption({label: 'Endocrinología pediátrica'});
    await expect(row).toContainText('Endocrinología pediátrica');
    expect(uploads).toBe(1);
});

test('conserva la cola para la cuenta original al conectar otra cuenta', async ({page, context}) => {
    const reservationAccounts: string[] = [];
    await page.route('https://accounts.google.com/**', route => route.fulfill({body: '', contentType: 'text/javascript'}));
    await page.route('https://www.googleapis.com/**', async route => {
        const url = new URL(route.request().url());
        const account = route.request().headers().authorization?.includes('account-b') ? 'account-b' : 'account-a';
        if (url.pathname === '/drive/v3/about') {
            return route.fulfill({json: {user: {me: true, permissionId: account}}});
        }
        if (url.pathname === '/drive/v3/files/generateIds') {
            reservationAccounts.push(account);
            return route.fulfill({status: 503});
        }
        if (url.pathname === '/drive/v3/files') return route.fulfill({json: {files: []}});
        return route.fulfill({status: 404});
    });
    await page.addInitScript(() => {
        const key = 'mis-estudios:drive-session:123-test.apps.googleusercontent.com';
        if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify({accessToken: 'account-a-token', expires: Date.now() + 3600000}));
        localStorage.setItem('mis-estudios-onboarding-seen', 'true');
    });
    await page.goto('/');
    await expect(page.getByRole('heading', {name: 'Resumen', level: 1})).toBeVisible();
    await navigateTo(page, 'cronologia');
    await context.setOffline(true);
    await page.locator('[data-add]').click();
    const editor = page.getByRole('dialog', {name: 'Agregar estudio'});
    await editor.getByRole('textbox', {name: 'Nombre del estudio'}).fill('Ficha privada A');
    await editor.locator('input[name="date"]').fill('2026-01-01');
    await editor.getByRole('combobox', {name: 'Tipos de estudio'}).click();
    await editor.getByRole('option', {name: 'Ecografía', exact: true}).click();
    await editor.getByRole('textbox', {name: 'Nombre del estudio'}).click();
    await editor.getByRole('button', {name: 'Guardar estudio'}).click();
    const pending = page.getByRole('region', {name: 'Cambios pendientes'});
    const originalEntry = pending.getByRole('listitem').filter({hasText: 'Ficha privada A'});
    await expect(originalEntry).toBeVisible();
    await page.getByRole('button', {name: 'Salir'}).click();
    await page.evaluate(() => {
        sessionStorage.setItem('mis-estudios:drive-session:123-test.apps.googleusercontent.com', JSON.stringify({accessToken: 'account-b-token', expires: Date.now() + 3600000}));
    });
    await context.setOffline(false);
    await page.reload();
    await expect(page.getByRole('heading', {name: 'Resumen', level: 1})).toBeVisible();
    await navigateTo(page, 'cronologia');
    await expect(page.getByRole('heading', {name: 'Tu archivo empieza acá'})).toBeVisible();
    await expect(pending).toHaveCount(0);
    await expect(page.getByText('Ficha privada A')).toHaveCount(0);
    await context.setOffline(true);
    await page.getByRole('button', {name: 'Salir'}).click();
    await page.evaluate(() => {
        sessionStorage.setItem('mis-estudios:drive-session:123-test.apps.googleusercontent.com', JSON.stringify({accessToken: 'account-a-token', expires: Date.now() + 3600000}));
    });
    await context.setOffline(false);
    await page.reload();
    await navigateTo(page, 'cronologia');
    await expect(originalEntry).toBeVisible();
    await expect.poll(() => reservationAccounts).toContain('account-a');
    expect(reservationAccounts).not.toContain('account-b');
});

test('conserva el cambio pendiente cuando Drive tiene una revisión más reciente', async ({page, context}) => {
    const description = JSON.stringify({title: 'Ficha original', date: '2026-01-01', types: ['Ecografía'], doctor: '', portal: '', viewer: '', reportName: ''});
    const base = {id: 'study-1', description, name: 'ficha.json', mimeType: 'application/json', version: '1', modifiedTime: '2026-01-01T00:00:00Z', trashed: false, appProperties: {misEstudios: 'estudio-v1'}};
    let attemptedPatches = 0;
    await page.route('https://accounts.google.com/**', route => route.fulfill({body: '', contentType: 'text/javascript'}));
    await page.route('https://www.googleapis.com/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/drive/v3/about') return route.fulfill({json: {user: {me: true, permissionId: 'test-account'}}});
        if (url.pathname === '/drive/v3/files') return route.fulfill({json: {files: (url.searchParams.get('q') ?? '').includes('estudio-v1') ? [base] : []}});
        if (url.pathname === '/drive/v3/files/study-1') {
            if (route.request().method() === 'PATCH') attemptedPatches++;
            return route.fulfill({json: {...base, version: '2'}});
        }
        return route.fulfill({status: 404});
    });
    await page.addInitScript(() => {
        sessionStorage.setItem('mis-estudios:drive-session:123-test.apps.googleusercontent.com', JSON.stringify({accessToken: 'synthetic-token', expires: Date.now() + 3600000}));
        localStorage.setItem('mis-estudios-onboarding-seen', 'true');
    });
    await page.goto('/');
    await expect(page.getByRole('heading', {name: 'Resumen', level: 1})).toBeVisible();
    await navigateTo(page, 'cronologia');
    const edit = page.getByRole('button', {name: 'Editar Ficha original'});
    await expect(edit).toBeVisible();
    await context.setOffline(true);
    await edit.click();
    const editor = page.getByRole('dialog', {name: 'Editar estudio'});
    await editor.getByRole('textbox', {name: 'Nombre del estudio'}).fill('Cambio sin conexión');
    await editor.getByRole('button', {name: 'Guardar cambios'}).click();
    const pending = page.getByRole('region', {name: 'Cambios pendientes'});
    const editedEntry = pending.getByRole('listitem').filter({hasText: 'Cambio sin conexión'});
    await expect(editedEntry).toBeVisible();
    await context.setOffline(false);
    await expect(editedEntry).toContainText('requiere revisión', {timeout: 15000});
    expect(attemptedPatches).toBe(0);
});
