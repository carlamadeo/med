import {expect, test} from '@playwright/test';
import {navigateTo} from './nav';

const sessionKey = 'mis-estudios:drive-session:123-test.apps.googleusercontent.com';
const files = [
    {
        id: 'study-1',
        version: '1',
        modifiedTime: '2026-11-12T00:00:00Z',
        trashed: false,
        mimeType: 'application/pdf',
        appProperties: {misEstudios: 'estudio-v1'},
        description: JSON.stringify({
            title: 'Mamografía bilateral',
            date: '2026-11-12',
            types: ['Mamografía'],
            doctor: 'Dra. Pérez',
            portal: 'Hospital Italiano',
            viewer: '',
            reportName: 'mamografia.pdf',
            hasPdf: true
        })
    },
    {
        id: 'study-2',
        version: '1',
        modifiedTime: '2026-11-03T00:00:00Z',
        trashed: false,
        mimeType: 'application/json',
        appProperties: {misEstudios: 'estudio-v1'},
        description: JSON.stringify({
            title: 'Resonancia de rodilla',
            date: '2026-11-03',
            types: ['Resonancia'],
            doctor: 'Dr. Gómez',
            portal: 'Clínica Santa María',
            viewer: 'https://example.com/visor',
            reportName: '',
            hasPdf: false
        })
    },
    {
        id: 'study-3',
        version: '1',
        modifiedTime: '2026-11-02T00:00:00Z',
        trashed: false,
        mimeType: 'image/jpeg',
        appProperties: {misEstudios: 'estudio-v1'},
        description: JSON.stringify({
            title: 'Orden de laboratorio',
            date: '2026-11-02',
            types: ['Laboratorio'],
            doctor: '',
            portal: 'Clínica Santa María',
            viewer: '',
            reportName: 'orden.jpg',
            hasPdf: false
        })
    },
];

test.beforeEach(async ({page}) => {
    await page.route('https://accounts.google.com/**', (route) => route.fulfill({
        body: '',
        contentType: 'text/javascript'
    }));
    await page.route('https://www.googleapis.com/**', (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/drive/v3/about') return route.fulfill({
            json: {
                user: {
                    me: true,
                    permissionId: 'test-account'
                }
            }
        });
        if (url.pathname === '/drive/v3/files') {
            const q = url.searchParams.get('q') ?? '';
            const result = q.includes('estudio-v1') ? files : [];
            return route.fulfill({json: {files: result}});
        }
        return route.fulfill({status: 404, body: ''});
    });
    await page.route('**/types.json', (route) => route.fulfill({json: ['Mamografía', 'Resonancia', 'Laboratorio', 'Consulta']}));
    await page.addInitScript((key) => {
        sessionStorage.setItem(key, JSON.stringify({accessToken: 'synthetic-token', expires: Date.now() + 3600000}));
        localStorage.setItem('mis-estudios-onboarding-seen', 'true');
    }, sessionKey);
});

test('abre en Resumen y navega por las secciones', async ({page}) => {
    await page.goto('/');
    await expect(page.locator('#resumen')).toBeVisible();
    await expect(page.locator('.kpi-card')).toHaveCount(4);
    await expect(page.locator('.study-title').first()).toBeVisible();

    await navigateTo(page, 'portales');
    await expect(page.locator('#portals-title')).toHaveText('Portales e instituciones');

    await navigateTo(page, 'operaciones');
    await expect(page.locator('#operations-title')).toHaveText('Operaciones');

    await navigateTo(page, 'eventos');
    await expect(page.locator('#events-title')).toHaveText('Consultas y recetas');

    await navigateTo(page, 'episodios');
    await expect(page.locator('#episodes-title')).toHaveText('Episodios de salud');

    await navigateTo(page, 'turnos');
    await expect(page.locator('#appointments-title')).toHaveText('Turnos médicos');
});

test('abre el menú móvil y navega a Resumen', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/');
    await expect(page.locator('#sidebar')).toBeHidden();
    await page.locator('#menuBtn').click();
    await expect(page.locator('#sidebar')).toBeVisible();
    await page.locator('#nav-resumen').click();
    await expect(page.locator('#resumen')).toBeVisible();
    await expect(page.locator('.kpi-card')).toHaveCount(4);
});

test('busca en la Biblioteca móvil y muestra la fecha y los iconos de acceso', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/');
    await navigateTo(page, 'cronologia');

    const library = page.getByRole('region', {name: 'Biblioteca'});
    const table = library.getByRole('table');
    const rows = table.locator('tbody tr');
    const search = library.getByRole('searchbox', {name: 'Buscar estudios'});
    await expect(rows).toHaveCount(3);
    await expect(table.getByRole('columnheader', {name: 'Estado'})).toHaveCount(0);
    for (const label of ['Abrir PDF', 'Abrir visor', 'Abrir imagen']) {
        const link = table.getByRole('link', {name: new RegExp(`^${label}`)});
        await expect(link).toBeVisible();
        await expect(link).toHaveText('');
        await expect(link.locator('svg')).toBeVisible();
        const bounds = await link.boundingBox();
        expect(Math.min(bounds?.width ?? 0, bounds?.height ?? 0)).toBeGreaterThanOrEqual(44);
    }
    await expect(table.locator('time[datetime="2026-11-12"]')).toBeVisible();
    await expect(table.getByText('Dr. Gómez', {exact: false})).toBeVisible();
    expect(await table.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

    await library.getByRole('button', {name: 'Mamografía', exact: true}).click();
    await library.getByRole('button', {name: 'Resonancia', exact: true}).click();
    await search.fill('CLINICA SANTA MARIA');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Resonancia de rodilla');

    await search.fill('sin coincidencia');
    await expect(library.getByText('No hay resultados')).toBeVisible();
    await library.getByRole('button', {name: 'Limpiar filtros'}).click();
    await expect(search).toBeFocused();
    await expect(rows).toHaveCount(3);
});
