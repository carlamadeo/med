import {expect, test} from '@playwright/test';
import {navigateTo} from './nav';
import {pdf} from './pdf-fixture';

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
            specialty: 'Endocrinología',
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
            specialty: 'ENDOCRINOLOGIA',
            date: '2026-11-03',
            types: ['Resonancia', 'Mamografía'],
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
        if (!new URLSearchParams(location.search).has('sin-sesion')) {
            sessionStorage.setItem(key, JSON.stringify({accessToken: 'synthetic-token', expires: Date.now() + 3600000}));
        }
        localStorage.setItem('mis-estudios-onboarding-seen', 'true');
    }, sessionKey);
});

test('muestra la pantalla de acceso completa en un móvil de 320 píxeles', async ({page}) => {
    await page.setViewportSize({width: 320, height: 700});
    await page.goto('/?sin-sesion');
    await expect(page.getByRole('heading', {name: 'Abrí tu archivo'})).toBeVisible();
    const demo = page.getByRole('button', {name: 'Probar en modo local (sin cuenta)'});
    await expect(demo).toBeVisible();
    expect(await demo.evaluate(button => button.scrollWidth - button.clientWidth)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
});

test('abre en Resumen y navega por las secciones', async ({page}) => {
    await page.goto('/');
    await expect(page.locator('#resumen')).toBeVisible();
    await expect(page.locator('.kpi-card')).toHaveCount(4);
    await expect(page.getByRole('heading', {name: 'Actividad de salud'})).toBeVisible();

    await navigateTo(page, 'portales');
    await expect(page.locator('#portals-title')).toHaveText('Portales e instituciones');

    await navigateTo(page, 'medicos');
    const doctors = page.getByRole('region', {name: 'Estudios por profesional'});
    await doctors.getByRole('searchbox', {name: 'Buscar profesionales'}).fill('perez');
    await expect(doctors.getByRole('heading', {level: 3})).toHaveText(['Dra. Pérez']);
    await doctors.getByRole('button', {name: 'Ver estudios de Dra. Pérez'}).click();
    await expect(page.locator('.library-table .study-title')).toHaveText(['Mamografía bilateral']);

    await navigateTo(page, 'operaciones');
    await expect(page.locator('#operations-title')).toHaveText('Operaciones');

    await navigateTo(page, 'episodios');
    await expect(page.locator('#episodes-title')).toHaveText('Episodios de salud');

    await navigateTo(page, 'turnos');
    await expect(page.locator('#appointments-title')).toHaveText('Turnos, consultas y recetas');
    await expect(page.locator('#events-title')).toHaveText('Consultas y recetas sin turno');
    await expect(page.locator('#nav-eventos')).toHaveCount(0);
});

test('abre el menú móvil y navega a Resumen', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/');
    await expect(page.locator('#resumen')).toBeVisible();
    await expect(page.locator('#sidebar')).toBeHidden();
    await page.locator('#menuBtn').click();
    await expect(page.locator('#sidebar')).toBeVisible();
    const menu = page.getByRole('dialog', {name: 'Navegación principal'});
    const closeMenu = menu.getByRole('button', {name: 'Cerrar menú'});
    await expect(page.locator('.app-main')).toHaveAttribute('inert', '');
    await expect(closeMenu).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(page.locator('#menuBtn')).toBeFocused();
    await page.locator('#menuBtn').click();
    await expect(closeMenu).toBeFocused();
    await menu.getByRole('button', {name: 'Resumen'}).click();
    await expect(menu).toBeHidden();
    await expect(page.locator('#resumen')).toBeVisible();
    await expect(page.locator('.kpi-card')).toHaveCount(4);
});

test('muestra un Resumen de solo lectura y permite buscar desde Biblioteca', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/');
    await expect(page.getByRole('heading', {name: 'Actividad de salud'})).toBeVisible();
    await expect(page.getByRole('heading', {name: 'Estudios recientes'})).toHaveCount(0);
    await expect(page.getByText('No hay turnos próximos.')).toBeVisible();
    await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('searchbox')).toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Buscar en el archivo'})).toHaveCount(0);
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('combobox', {name: 'Buscar estudios, portales y turnos'})).toHaveCount(0);
    await page.keyboard.press('n');
    await expect(page.getByRole('dialog', {name: 'Agregar estudio'})).toHaveCount(0);

    await navigateTo(page, 'cronologia');
    const library = page.getByRole('searchbox', {name: 'Buscar estudios'});
    await library.fill('rodilla');
    await expect(page.locator('.library-table .study-title')).toHaveText(['Resonancia de rodilla']);
});

test('permite desplazarse solo de arriba abajo al agendar un turno en móvil', async ({page}) => {
    await page.setViewportSize({width: 320, height: 700});
    await page.goto('/');
    await expect(page.locator('#resumen')).toBeVisible();
    await navigateTo(page, 'turnos');
    await page.getByRole('button', {name: 'Nuevo turno'}).click();

    const dialog = page.getByRole('dialog', {name: 'Agendar turno'});
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('overflow-x', 'hidden');
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

    const save = dialog.getByRole('button', {name: 'Guardar turno'});
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport({ratio: 1});
    expect(await dialog.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
});

test('busca turnos en móvil con texto de 16 píxeles y conserva la escala al salir', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/');
    await expect(page.locator('#resumen')).toBeVisible();
    await navigateTo(page, 'turnos');

    const search = page.getByRole('searchbox', {name: 'Buscar turnos, consultas y recetas'});
    await search.click();
    await expect(search).toBeFocused();
    await expect(search).toHaveCSS('font-size', '16px');
    await search.fill('turno de prueba');
    await search.blur();
    await expect(search).not.toBeFocused();
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
});

test('guarda un turno en móvil y muestra la ficha sin recortes', async ({page}) => {
    await page.setViewportSize({width: 320, height: 700});
    await page.goto('/?sin-sesion');
    await page.getByRole('button', {name: 'Probar en modo local (sin cuenta)'}).click();
    await navigateTo(page, 'turnos');
    await page.getByRole('button', {name: 'Nuevo turno'}).click();

    const dialog = page.getByRole('dialog', {name: 'Agendar turno'});
    const professional = dialog.getByLabel('Profesional');
    const reason = dialog.getByLabel('Motivo de la consulta');
    const name = 'ProfesionalDePrueba'.repeat(5);
    const longReason = 'MotivoDePrueba'.repeat(10);
    await dialog.getByLabel('Fecha').fill('2024-03-01');
    await dialog.getByLabel('Hora', {exact: true}).fill('10:30');
    await professional.fill(name);
    await expect(professional).toHaveCSS('font-size', '16px');
    await reason.fill(longReason);
    await expect(reason).toHaveCSS('font-size', '16px');
    await dialog.getByRole('button', {name: 'Guardar turno'}).click();
    await expect(dialog).toBeHidden();

    const card = page.locator('.appointment-card').filter({hasText: name});
    await expect(card).toContainText(longReason);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
});

test('busca en la Biblioteca móvil y muestra la fecha y las acciones de acceso', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/');
    await expect(page.locator('#resumen')).toBeVisible();
    await navigateTo(page, 'cronologia');

    const library = page.getByRole('region', {name: 'Biblioteca'});
    const table = library.getByRole('table');
    const rows = table.locator('tbody tr:not(.year-divider-row)');
    const search = library.getByRole('searchbox', {name: 'Buscar estudios'});
    await expect(rows).toHaveCount(3);
    await expect(table.getByRole('columnheader', {name: 'Estado'})).toHaveCount(0);
    for (const [label, icon] of [
        ['Abrir informe de Mamografía bilateral', '#i-file'],
        ['Abrir visor de Resonancia de rodilla', '#i-image'],
        ['Abrir informe de Orden de laboratorio', '#i-file'],
    ]) {
        const link = table.getByRole('link', {name: new RegExp(`^${label}`)});
        await expect(link).toBeVisible();
        await expect(link).toHaveText('');
        await expect(link.locator('svg')).toBeVisible();
        await expect(link.locator('use')).toHaveAttribute('href', icon!);
    }
    await expect(table.locator('time[datetime="2026-11-12"]')).toBeVisible();
    await expect(table.getByText('Dr. Gómez', {exact: false})).toBeVisible();
    expect(await table.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

    await library.getByRole('combobox', {name: 'Filtrar por tipo de estudio'}).click();
    await library.getByRole('option', {name: /^Mamografía\b/}).click();
    await library.getByRole('option', {name: /^Resonancia\b/}).click();
    await search.fill('CLINICA SANTA MARIA');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Resonancia de rodilla');

    await search.fill('sin coincidencia');
    await expect(library.getByText('No hay resultados')).toBeVisible();
    await library.getByRole('button', {name: 'Limpiar filtros'}).click();
    await expect(search).toBeFocused();
    await expect(rows).toHaveCount(3);

    const specialty = library.getByRole('combobox', {name: 'Filtrar por especialidad'});
    await expect(specialty).toBeVisible();
    await specialty.selectOption({label: 'Endocrinología'});
    await expect(rows).toHaveCount(2);
    await expect(specialty.locator('option')).toHaveCount(2);
    await expect(rows.first()).toContainText('Mamografía bilateral');
    await expect(rows.first()).toContainText('Endocrinología');
    await expect(rows.last()).toContainText('Resonancia de rodilla');
    await library.getByRole('combobox', {name: 'Filtrar por tipo de estudio'}).click();
    await library.getByRole('option', {name: /^Laboratorio\b/}).click();
    await expect(library.getByText('No hay resultados')).toBeVisible();
    await library.getByRole('button', {name: 'Limpiar filtros'}).click();
    await expect(specialty).toHaveValue('');
    await expect(rows).toHaveCount(3);
});


test('imprime todas las páginas del archivo adjunto desde Compartir', async ({page, browserName}) => {
    const stream = (content: string) => `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    const attachment = Buffer.from(pdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 6 0 R >>',
        stream('1 0 0 rg 0 0 595 842 re f'),
        stream('0 0 1 rg 0 0 842 595 re f'),
    ]), 'base64');
    await page.route('https://www.googleapis.com/drive/v3/files/study-1?**', route => {
        const url = new URL(route.request().url());
        return url.searchParams.get('alt') === 'media'
            ? route.fulfill({body: attachment, contentType: 'application/pdf'})
            : route.fulfill({json: files[0]});
    });
    await page.goto('/');
    await expect(page.locator('#resumen')).toBeVisible();
    await navigateTo(page, 'cronologia');
    const library = page.getByRole('region', {name: 'Biblioteca'});
    const share = library.getByRole('button', {name: 'Compartir Mamografía bilateral'});
    await share.focus();
    await page.keyboard.press('Enter');
    const shareDialog = page.getByRole('dialog', {name: 'Compartir estudio'});
    await shareDialog.getByRole('button', {name: 'Imprimir archivo'}).click();
    const preview = page.getByRole('dialog', {name: 'Preparar impresión'});
    await expect(shareDialog).toBeHidden();
    await expect(preview.getByRole('img', {name: 'Página 1 del archivo adjunto'})).toBeVisible();
    await expect(preview.getByRole('img', {name: 'Página 2 del archivo adjunto'})).toBeVisible();
    await expect(preview.getByRole('radio')).toHaveCount(0);
    await expect(preview.getByRole('button', {name: 'Imprimir', exact: true})).toBeEnabled();

    await page.emulateMedia({media: 'print'});
    const output = page.locator('.study-print-output');
    await expect(output.locator('img')).toHaveCount(2);
    await expect(output.locator('img').first()).toBeVisible();
    await expect(preview).toBeHidden();
    if (browserName === 'chromium') {
        const printed = await page.pdf({format: 'A4'});
        const pages = await page.evaluate(async (encoded) => {
            const path = '/vendor/pdf/pdf.min.mjs';
            const {getDocument, GlobalWorkerOptions, OPS} = await import(path);
            GlobalWorkerOptions.workerSrc = '/vendor/pdf/pdf.worker.min.mjs';
            const loading = getDocument({data: Uint8Array.from(atob(encoded), byte => byte.charCodeAt(0))});
            try {
                const document = await loading.promise;
                return await Promise.all(Array.from({length: document.numPages}, async (_, index) => {
                    const page = await document.getPage(index + 1);
                    const {fnArray} = await page.getOperatorList();
                    return fnArray.includes(OPS.paintImageXObject);
                }));
            } finally {
                await loading.destroy();
            }
        }, printed.toString('base64'));
        expect(pages).toEqual([true, true]);
    }
    await page.emulateMedia({media: 'screen'});
    await page.evaluate(() => { window.print = () => document.body.setAttribute('data-print-invoked', 'true'); });
    await preview.getByRole('button', {name: 'Imprimir', exact: true}).click();
    await expect(page.locator('body')).toHaveAttribute('data-print-invoked', 'true');
    await page.keyboard.press('Escape');
    await expect(preview).toBeHidden();
    await expect(share).toBeFocused();
    await expect(library.getByRole('link', {name: /Abrir informe de Mamografía bilateral/})).toHaveAttribute('data-printed', 'false');
});

test('previsualiza una imagen y distingue un adjunto que no se puede cargar', async ({page}) => {
    await page.goto('/');
    const jpeg = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 30;
        const context = canvas.getContext('2d')!;
        context.fillStyle = 'blue';
        context.fillRect(0, 0, 30, 30);
        return canvas.toDataURL('image/jpeg').split(',')[1]!;
    });
    let unavailable = false;
    await page.route('https://www.googleapis.com/drive/v3/files/study-3?**', route => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('alt') !== 'media') return route.fulfill({json: files[2]});
        return unavailable ? route.fulfill({status: 404})
            : route.fulfill({body: Buffer.from(jpeg, 'base64'), contentType: 'image/jpeg'});
    });
    await expect(page.locator('#resumen')).toBeVisible();
    await navigateTo(page, 'cronologia');
    const row = page.getByRole('row').filter({hasText: 'Orden de laboratorio'});
    const startPrint = async () => {
        await row.getByRole('button', {name: 'Compartir Orden de laboratorio'}).click();
        await page.getByRole('dialog', {name: 'Compartir estudio'}).getByRole('button', {name: 'Imprimir archivo'}).click();
    };
    await startPrint();
    const preview = page.getByRole('dialog', {name: 'Preparar impresión'});
    const image = preview.getByRole('img', {name: 'Página 1 del archivo adjunto'});
    await expect(image).toHaveJSProperty('naturalWidth', 30);
    const blobUrl = await image.getAttribute('src');
    await preview.getByRole('button', {name: 'Cerrar'}).click();
    await expect(preview).toBeHidden();
    expect(blobUrl).toMatch(/^blob:/);
    await expect.poll(() => page.evaluate(url =>
        fetch(url!).then(() => false, () => true), blobUrl
    )).toBe(true);

    unavailable = true;
    await startPrint();
    await expect(preview.getByRole('alert')).toContainText('No se pudo preparar el archivo adjunto');
    await expect(preview.getByRole('button', {name: 'Imprimir', exact: true})).toBeDisabled();
    await expect(preview.getByRole('button', {name: 'Reintentar'})).toBeVisible();
    await page.emulateMedia({media: 'print'});
    await expect(page.locator('.study-print-output')).toBeAttached();
    await expect(page.getByRole('region', {name: 'Biblioteca'})).toBeHidden();
});

test('revisa estudios relacionados con teclado y conserva el tema', async ({page}) => {
    await page.goto('/');
    await expect(page.locator('#resumen')).toBeVisible();
    await navigateTo(page, 'cronologia');
    const library = page.getByRole('region', {name: 'Biblioteca'});
    const detail = library.getByRole('button', {name: 'Ver detalle de Mamografía bilateral'});
    await detail.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog', {name: 'Mamografía bilateral'}).getByRole('button', {name: 'Editar'}).click();
    const editor = page.getByRole('dialog', {name: 'Editar estudio'});
    await expect(editor).toBeVisible();
    await expect(editor.locator('#current-report-name')).toHaveText('2026-11-12 Mamografía bilateral.pdf');
    await expect(editor.getByRole('textbox', {name: /Especialidad/})).toHaveValue('Endocrinología');
    await expect(editor.getByRole('region', {name: 'Estudios relacionados'})).toContainText('Resonancia de rodilla');
    await expect(editor.getByText('Otros estudios de Mamografía')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
    await expect(detail).toBeFocused();

    await page.emulateMedia({reducedMotion: 'reduce'});
    const toggle = page.getByRole('button', {name: /Cambiar a modo/});
    const before = await page.locator('html').getAttribute('data-theme');
    await toggle.click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', before!);
    await expect(library.getByText('Mamografía bilateral').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});


test('muestra todos los iconos del estudio en un ancho de 320 píxeles', async ({page}) => {
    await page.setViewportSize({width: 320, height: 700});
    const study = files[0]!;
    await page.route('https://www.googleapis.com/drive/v3/files?**', route => {
        const query = new URL(route.request().url()).searchParams.get('q') ?? '';
        const description = JSON.stringify({...JSON.parse(study.description), viewer: 'https://example.com/visor'});
        return query.includes('estudio-v1')
            ? route.fulfill({json: {files: [{...study, description}]}})
            : route.fallback();
    });
    await page.goto('/');
    await expect(page.locator('#resumen')).toBeVisible();
    await navigateTo(page, 'cronologia');
    const library = page.getByRole('region', {name: 'Biblioteca'});
    await expect(library.getByRole('searchbox', {name: 'Buscar estudios'})).toBeVisible();
    const row = library.getByRole('row').filter({hasText: 'Mamografía bilateral'});
    const actions = [
        row.getByRole('link', {name: /^Abrir informe de Mamografía bilateral/}),
        row.getByRole('link', {name: /^Abrir visor de Mamografía bilateral/}),
        row.getByRole('button', {name: 'Compartir Mamografía bilateral'}),
    ];
    for (const action of actions) {
        await expect(action.locator('svg')).toBeVisible();
        const box = (await action.boundingBox())!;
        expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(320);
    }
    await expect(row.getByText('Más acciones', {exact: true})).toHaveCount(0);
    await row.getByRole('checkbox').check();
    await expect(page.getByRole('dialog', {name: 'Mamografía bilateral'})).toBeHidden();
    await row.locator('time').click();
    await page.getByRole('dialog', {name: 'Mamografía bilateral'}).getByRole('button', {name: 'Eliminar'}).click();
    const confirm = page.getByRole('dialog', {name: 'Eliminar estudio'});
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', {name: 'Cancelar'}).click();
    await expect(row).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('marca y desmarca una copia física desde el detalle y elimina el estudio', async ({page}) => {
    await page.goto('/?sin-sesion');
    await page.locator('#enter-demo').click();
    await navigateTo(page, 'cronologia');
    const library = page.getByRole('region', {name: 'Biblioteca'});
    const title = 'Ecografía abdominal completa';
    const row = library.getByRole('row').filter({hasText: title});
    const detail = page.getByRole('dialog', {name: title, exact: true});
    const editor = page.getByRole('dialog', {name: 'Editar estudio'});
    const edit = async () => {
        await row.getByRole('button', {name: `Ver detalle de ${title}`}).click();
        await detail.getByRole('button', {name: 'Editar'}).click();
    };
    const image = editor.getByRole('checkbox', {name: 'Tengo la imagen impresa'});
    await edit();
    await image.check();
    await editor.getByRole('button', {name: 'Guardar cambios'}).click();
    await expect(editor).toBeHidden();
    await expect(row.getByRole('img', {name: 'Imagen impresa. Sin enlace al visor.'})).toBeVisible();

    await library.getByRole('checkbox', {name: 'Solo impresos'}).check();
    await expect(library.getByRole('button', {name: /Ver detalle de Hemograma/})).toHaveCount(0);
    await edit();
    await expect(image).toBeChecked();
    await image.uncheck();
    await editor.getByRole('button', {name: 'Guardar cambios'}).click();
    await expect(library.getByText('No hay resultados')).toBeVisible();
    await expect(library.getByRole('heading', {name: 'Estudios guardados'})).toBeFocused();
    await library.getByRole('button', {name: 'Limpiar filtros'}).click();

    await row.getByRole('button', {name: `Ver detalle de ${title}`}).click();
    await detail.getByRole('button', {name: 'Eliminar'}).click();
    await page.getByRole('dialog', {name: 'Eliminar estudio'}).getByRole('button', {name: 'Eliminar estudio'}).click();
    await expect(row).toHaveCount(0);
    await expect(library.getByRole('heading', {name: 'Estudios guardados'})).toBeFocused();
});

test('muestra el inicio de Biblioteca al navegar desde Resumen desplazado', async ({page}) => {
    await page.setViewportSize({width: 390, height: 600});
    await page.goto('/');
    await expect(page.getByRole('heading', {name: 'Actividad de salud'})).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 350));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(250);
    await navigateTo(page, 'cronologia');

    const heading = page.getByRole('heading', {name: 'Biblioteca', level: 1});
    const header = page.getByRole('banner');
    await expect.poll(async () => (await heading.boundingBox())!.y - (await header.boundingBox())!.height)
        .toBeGreaterThan(0);
});

test('mantiene las secciones secundarias legibles en ambos temas', async ({page}) => {
    test.setTimeout(90_000);
    await page.goto('/');
    await expect(page.locator('#resumen')).toBeVisible();
    await page.emulateMedia({reducedMotion: 'reduce'});
    const sections = [
        ['resumen', '#resumen'], ['portales', '#portals-title'], ['operaciones', '#operations-title'],
        ['episodios', '#episodes-title'], ['turnos', '#appointments-title'],
        ['intake', '#intake-title'],
    ];
    for (const theme of ['light', 'dark']) {
        const html = page.locator('html');
        if (await html.getAttribute('data-theme') !== theme) await page.getByRole('button', {name: /Cambiar a modo/}).click();
        await expect(html).toHaveAttribute('data-theme', theme);
        for (const [view, selector] of sections) {
            await navigateTo(page, view!);
            await expect(page.locator(selector!)).toBeVisible();
            if (await page.locator('#menuBtn').isVisible()) await expect(page.locator('#sidebar')).toBeHidden();
            if (view !== 'resumen') {
                await expect(page.locator('#library')).toHaveCSS('padding-top', '24px');
                await expect(page.locator('#library')).toHaveCSS('padding-bottom', '40px');
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        }
    }
});

test('abre y cierra formularios y acciones del archivo', async ({page}) => {
    test.setTimeout(60_000);
    await page.goto('/');
    await expect(page.locator('#resumen')).toBeVisible();
    const forms = [
        ['portales', '.portals-head button', '#portal-dialog'],
        ['operaciones', '.operations-head button', '#operation-dialog'],
        ['turnos', '.events-head button', '#event-dialog'],
        ['turnos', '.appointments-head button', '#appointment-dialog'],
        ['episodios', '.episodes-head button', '#episode-dialog'],
    ];
    for (const [view, trigger, dialog] of forms) {
        await navigateTo(page, view!);
        await page.locator(trigger!).click();
        await expect(page.locator(dialog!)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator(dialog!)).toBeHidden();
    }
    await navigateTo(page, 'cronologia');
    await page.getByRole('button', {name: 'Compartir Mamografía bilateral'}).click();
    await expect(page.locator('#share')).toBeVisible();
    await page.keyboard.press('Escape');
    await navigateTo(page, 'export');
    await expect(page.locator('#export')).toBeVisible();
    await expect(page.locator('#export-title')).toBeInViewport();
    await expect(page.locator('#export-title')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.getByRole('button', {name: 'Recuperar informe'}).click();
    await expect(page.locator('#recovery')).toBeVisible();
    await page.keyboard.press('Escape');
});

test('agrega una especialidad y selecciona vínculos sin ampliar la lista del modal', async ({page}) => {
    const template = files[0]!;
    const extra = Array.from({length: 40}, (_, index) => ({
        ...template,
        id: `study-extra-${index}`,
        name: `2026-11-12 Informe de control ${index}.pdf`,
        description: JSON.stringify({
            ...JSON.parse(template.description),
            title: `Estudio de prueba ${index}`,
            reportName: `informe-${index}.pdf`,
        }),
    }));
    await page.route('https://www.googleapis.com/drive/v3/files?**', route => {
        const query = new URL(route.request().url()).searchParams.get('q') ?? '';
        return query.includes('estudio-v1') ? route.fulfill({json: {files: [...files, ...extra]}}) : route.fallback();
    });
    await page.setViewportSize({width: 320, height: 700});
    await page.goto('/');
    await expect(page.locator('#resumen')).toBeVisible();
    await navigateTo(page, 'turnos');
    await page.locator('.events-head').getByRole('button', {name: 'Registrar sin turno'}).click();
    const dialog = page.getByRole('dialog', {name: 'Agregar consulta o receta'});
    const specialty = dialog.getByLabel('Especialidad');
    await specialty.fill('Cardiología');
    await specialty.press('Tab');
    await expect(dialog.getByLabel('Buscar estudios relacionados')).toBeHidden();
    await dialog.getByText('Estudios relacionados', {exact: true}).click();
    const studySearch = dialog.getByLabel('Buscar estudios relacionados');
    const options = dialog.locator('.event-related-options').first();
    expect(await options.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await expect(dialog.getByRole('button', {name: 'Guardar evento'})).toBeInViewport({ratio: 1});
    await studySearch.fill('estudio de prueba 39');
    await dialog.getByRole('checkbox', {name: /Estudio de prueba 39/}).check();
    await studySearch.fill('sin coincidencia');
    await expect(dialog.getByText('Sin coincidencias')).toBeVisible();
    await dialog.getByText('Estudios relacionados', {exact: true}).click();
    await dialog.getByText('Documentos relacionados', {exact: true}).click();
    await dialog.getByLabel('Buscar documentos relacionados').fill('informe-38.pdf');
    const documentOption = dialog.getByRole('checkbox', {name: '2026-11-12 Informe de control 38.pdf', exact: true});
    await expect(documentOption).toBeVisible();
    await documentOption.check();
    await dialog.getByText('Documentos relacionados', {exact: true}).click();

    const data = await dialog.locator('form').evaluate(form => [...new FormData(form as HTMLFormElement).entries()]);
    expect(data).toEqual(expect.arrayContaining([
        ['specialty', 'Cardiología'], ['studyId', 'study-extra-39'], ['documentId', 'study-extra-38'],
    ]));
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await dialog.getByRole('button', {name: 'Cancelar'}).click();
    await page.locator('.events-head').getByRole('button', {name: 'Registrar sin turno'}).click();
    await expect(specialty).toHaveValue('');
    await expect(dialog.getByLabel('Buscar estudios relacionados')).toBeHidden();
});

test('muestra registros largos completos en las secciones secundarias', async ({page}) => {
    test.setTimeout(60_000);
    const name = 'Institución de atención integral y seguimiento clínico especializado';
    const entries: Record<string, object> = {
        'portal-v1': {name, displayName: name, url: 'https://example.com', notes: 'Información de acceso para consultas.'},
        'operacion-v1': {name, date: '2024-01-01', surgeon: 'Dra. Pérez', institution: name, type: 'Procedimiento', notes: 'Seguimiento posterior.'},
        'evento-medico-v1': {kind: 'consultation', date: '2024-01-01', doctor: name, notes: 'Indicaciones para el seguimiento.', studyIds: ['study-1'], documentIds: []},
        'episodio-v1': {illness: name, observations: [], medications: [], closed: true},
    };
    await page.route('https://www.googleapis.com/drive/v3/files?**', async (route) => {
        const query = new URL(route.request().url()).searchParams.get('q') ?? '';
        const type = Object.keys(entries).find((key) => query.includes(key));
        if (!type) return route.fallback();
        await route.fulfill({json: {files: [{id: 'sample-' + type, version: '1', trashed: false,
            modifiedTime: '2024-01-01T00:00:00Z', mimeType: 'application/json',
            appProperties: {misEstudios: type}, description: JSON.stringify(entries[type])}]}});
    });
    await page.setViewportSize({width: 320, height: 700});
    await page.goto('/');
    await expect(page.locator('#resumen')).toBeVisible();
    for (const [view, selector] of [['portales', '.portal-card-title h3'], ['operaciones', '.operation-title h3'],
        ['turnos', '.event-title'], ['episodios', '.episode-card h3']]) {
        await navigateTo(page, view!);
        const title = page.locator(selector!);
        await expect(title).toHaveText(name);
        await expect(title).toBeVisible();
        expect(await title.evaluate((element) => getComputedStyle(element).textOverflow)).not.toBe('ellipsis');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
});

test('abre la ficha de una operación sin desborde horizontal en móvil', async ({page}) => {
    const name = 'ProcedimientoDePrueba'.repeat(5);
    await page.route('https://www.googleapis.com/drive/v3/files?**', (route) => {
        const query = new URL(route.request().url()).searchParams.get('q') ?? '';
        if (!query.includes('operacion-v1')) return route.fallback();
        return route.fulfill({json: {files: [{
            id: 'operation-1', version: '1', trashed: false, modifiedTime: '2024-01-01T00:00:00Z',
            mimeType: 'application/json', appProperties: {misEstudios: 'operacion-v1'},
            description: JSON.stringify({name, date: '2024-01-01', type: 'Cirugía de prueba'}),
        }]}});
    });
    await page.setViewportSize({width: 320, height: 700});
    await page.goto('/');
    await expect(page.locator('#resumen')).toBeVisible();
    await navigateTo(page, 'operaciones');
    await page.getByRole('button', {name: 'Ver ficha'}).click();
    await expect(page.getByRole('heading', {name})).toBeVisible();
    await expect(page.getByRole('heading', {name: 'Estudios vinculados'})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
});

test('usa campos de 16 píxeles en la búsqueda global y en Operaciones en móvil', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/');
    await expect(page.locator('#resumen')).toBeVisible();
    await navigateTo(page, 'cronologia');
    await page.getByRole('button', {name: 'Buscar en el archivo'}).click();
    const globalSearch = page.getByRole('combobox', {name: 'Buscar estudios, portales y turnos'});
    await expect(globalSearch).toBeFocused();
    await expect(globalSearch).toHaveCSS('font-size', '16px');
    await page.keyboard.press('Escape');

    await navigateTo(page, 'operaciones');
    const operationSearch = page.getByRole('searchbox', {name: 'Buscar operaciones'});
    await operationSearch.click();
    await expect(operationSearch).toHaveCSS('font-size', '16px');
    await page.locator('.operations-head').getByRole('button', {name: 'Agregar operación'}).click();
    const form = page.getByRole('dialog', {name: 'Agregar operación'});
    await expect(form.getByLabel('Nombre (obligatorio)')).toHaveCSS('font-size', '16px');
    await expect(form.getByLabel('Notas')).toHaveCSS('font-size', '16px');
});

test('Escape cierra el selector de tipos y conserva el borrador', async ({page}) => {
    await page.goto('/');
    await expect(page.locator('#resumen')).toBeVisible();
    await navigateTo(page, 'cronologia');
    await page.getByRole('button', {name: 'Agregar estudio'}).click();
    const editor = page.getByRole('dialog', {name: 'Agregar estudio'});
    await editor.getByRole('textbox', {name: 'Nombre del estudio'}).fill('Borrador de prueba');
    const types = editor.getByRole('combobox', {name: 'Tipos de estudio'});
    await types.click();
    await expect(types).toHaveAttribute('aria-expanded', 'true');
    await types.press('Escape');
    await expect(editor).toBeVisible();
    await expect(types).toHaveAttribute('aria-expanded', 'false');
    await expect(editor.getByRole('textbox', {name: 'Nombre del estudio'})).toHaveValue('Borrador de prueba');
});

test('el modo local conserva la biblioteca al cancelar el editor', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Salir'}).click();
    await page.getByRole('button', {name: 'Probar en modo local (sin cuenta)'}).click();
    await expect(page.getByRole('status', {name: 'Modo de prueba local'})).toBeVisible();
    await navigateTo(page, 'cronologia');
    await page.getByRole('button', {name: 'Agregar estudio'}).click();
    await page.getByRole('dialog', {name: 'Agregar estudio'}).getByRole('button', {name: 'Cancelar'}).click();
    await expect(page.getByRole('region', {name: 'Biblioteca'})).toBeVisible();
    await expect(page.getByText('Ecografía abdominal completa')).toBeVisible();
});

test('mantiene las acciones del editor fuera del área desplazable', async ({page}) => {
    await page.setViewportSize({width: Math.min(page.viewportSize()!.width, 800), height: 600});
    await page.goto('/');
    await expect(page.locator('#resumen')).toBeVisible();
    await navigateTo(page, 'cronologia');
    const library = page.getByRole('region', {name: 'Biblioteca'});
    await library.getByRole('button', {name: 'Ver detalle de Mamografía bilateral'}).click();
    await page.getByRole('dialog', {name: 'Mamografía bilateral'}).getByRole('button', {name: 'Editar'}).click();
    const editor = page.getByRole('dialog', {name: 'Editar estudio'});
    const content = editor.locator('.editor-content');
    const actions = editor.locator('.dialog-actions');
    await expect(editor).toBeVisible();
    const geometry = await content.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        return {scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight};
    });
    expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
    expect(geometry.scrollTop).toBeGreaterThan(0);
    const contentBounds = await content.boundingBox();
    const actionsBounds = await actions.boundingBox();
    expect(contentBounds!.y + contentBounds!.height).toBeLessThanOrEqual(actionsBounds!.y);
    await expect(editor.getByLabel('Enlace al visor web')).toBeInViewport();
    await expect(editor.getByRole('button', {name: 'Guardar cambios'})).toBeInViewport();
});

test('registra la consulta y descarga la receta desde el turno', async ({page}) => {
    await page.goto('/?sin-sesion');
    await page.locator('#enter-demo').click();
    await navigateTo(page, 'turnos');

    await page.getByRole('button', {name: 'Nuevo turno'}).click();
    const dialog = page.locator('#appointment-dialog');
    await dialog.getByLabel('Fecha').fill('2024-03-01');
    await dialog.getByLabel('Hora', {exact: true}).fill('10:30');
    await dialog.getByLabel('Zona horaria').selectOption('America/Argentina/Buenos_Aires');
    await dialog.getByLabel('Profesional').fill('Dra. Pérez');
    await dialog.getByLabel('Especialidad').fill('Otorrinolaringología');
    await dialog.getByLabel('Lugar o dirección').fill('Consultorio 12');
    await dialog.getByLabel('Cobertura').selectOption('partial');
    await dialog.getByRole('checkbox', {name: /Ecografía abdominal completa/}).check();
    await expect(dialog.getByLabel('Notas de la consulta')).toHaveCount(0);
    await expect(dialog.locator('input[type=file]')).toHaveCount(0);
    await dialog.getByLabel('Motivo de la consulta').fill('Control de audición');
    await dialog.getByRole('button', {name: 'Guardar turno'}).click();
    await expect(dialog).toBeHidden();

    const card = page.locator('.appointment-card').filter({hasText: 'Dra. Pérez'});
    await expect(card.getByText('10:30', {exact: true})).toBeVisible();
    await card.getByRole('button', {name: 'Registrar consulta'}).click();
    await expect(dialog).toHaveAccessibleName('Registrar consulta');
    await expect(dialog.getByLabel('Estado')).toHaveValue('completed');
    await expect(dialog.locator('input, select, textarea')).toHaveCount(4);
    await dialog.getByLabel('Importe').fill('1250');
    await dialog.getByLabel('Notas de la consulta').fill('Control en una semana');
    const file = {name: 'receta.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n')};
    await dialog.getByLabel(/Adjuntar receta/).setInputFiles(file);
    await dialog.getByRole('button', {name: 'Guardar consulta'}).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('searchbox', {name: 'Buscar turnos, consultas y recetas'}).fill('control de audicion');
    await expect(card).toContainText('Realizado');
    await expect(card).toContainText('Control de audición');
    await expect(card).toContainText('Otorrinolaringología');
    await expect(card).toContainText('Consultorio 12');
    await expect(card).toContainText('Importe: 1250');
    await expect(card).toContainText('Cobertura: Parcial');
    await expect(card).toContainText('Ecografía abdominal completa');
    await expect(card).toContainText('Control en una semana');
    await expect(card).toContainText('receta.pdf');

    await card.getByRole('button', {name: 'Editar turno'}).click();
    await expect(dialog.getByLabel('Motivo de la consulta')).toHaveValue('Control de audición');
    await expect(dialog.getByLabel('Notas de la consulta')).toHaveCount(0);
    await expect(dialog.locator('input[type=file]')).toHaveCount(0);
    await dialog.getByRole('button', {name: 'Guardar turno'}).click();
    await expect(dialog).toBeHidden();

    await card.getByRole('button', {name: 'Editar consulta'}).click();
    await expect(dialog.getByLabel('Notas de la consulta')).toHaveValue('Control en una semana');
    await dialog.getByRole('button', {name: 'Cancelar'}).click();
    const download = page.waitForEvent('download');
    await card.getByRole('button', {name: 'Descargar receta'}).click();
    expect((await download).suggestedFilename()).toBe(file.name);
});

test('permite finalizar un episodio con una fecha distinta de la última observación', async ({page}) => {
    await page.goto('/?sin-sesion');
    await page.locator('#enter-demo').click();
    await navigateTo(page, 'episodios');

    await page.locator('.episodes-head').getByRole('button').click();
    const dialog = page.locator('#episode-dialog');
    await dialog.getByLabel('Enfermedad').fill('Otitis de prueba');
    await dialog.getByLabel('Fecha', {exact: true}).fill('2024-03-09');
    await dialog.getByLabel('Texto libre').fill('Primera observación');
    await dialog.getByLabel('Episodio finalizado').check();
    await dialog.getByLabel('Fecha de finalización').fill('2024-03-12');
    await dialog.getByRole('button', {name: 'Guardar episodio'}).click();
    await expect(dialog).toBeHidden();

    const card = page.locator('.episode-card').filter({hasText: 'Otitis de prueba'});
    await expect(card).toContainText('Finalizado · 4 días');
    await expect(card.locator('time[datetime="2024-03-12"]')).toBeVisible();
    await card.getByRole('button', {name: 'Ver detalle completo', exact: true}).click();
    await card.getByRole('button', {name: 'Editar', exact: true}).click();
    await expect(dialog.getByLabel('Fecha de finalización')).toHaveValue('2024-03-12');
});

test('elige y guarda una especialidad al editar un estudio anterior', async ({page}, testInfo) => {
    let existing = files.find(file => file.id === 'study-3')!;
    await page.route('https://www.googleapis.com/drive/v3/files/study-3?**', async route => {
        if (route.request().method() === 'PATCH') {
            const {description} = route.request().postDataJSON();
            existing = {...existing, description, version: '2', modifiedTime: new Date().toISOString()};
        }
        await route.fulfill({json: existing});
    });
    await page.route('https://www.googleapis.com/drive/v3/files?**', route => {
        const query = new URL(route.request().url()).searchParams.get('q') ?? '';
        return query.includes('estudio-v1')
            ? route.fulfill({json: {files: files.map(file => file.id === existing.id ? existing : file)}})
            : route.fallback();
    });
    await page.goto('/');
    await expect(page.locator('#resumen')).toBeVisible();
    await navigateTo(page, 'cronologia');
    const edit = async () => {
        await page.getByRole('button', {name: 'Ver detalle de Orden de laboratorio'}).click();
        await page.getByRole('dialog', {name: 'Orden de laboratorio'}).getByRole('button', {name: 'Editar'}).click();
    };
    await edit();

    const editor = page.getByRole('dialog', {name: 'Editar estudio'});
    const specialty = editor.getByRole('textbox', {name: /Especialidad/});
    await expect(specialty).toHaveValue('');
    await specialty.click();
    const option = editor.getByRole('button', {name: 'Cardiología', exact: true});
    if (testInfo.project.use.hasTouch) await option.tap({timeout: 3500});
    else await option.click({timeout: 3500});
    await expect(specialty).toHaveValue('Cardiología');
    await expect(option).toBeHidden();
    await editor.getByRole('button', {name: 'Guardar cambios'}).click();
    await expect(editor).toBeHidden();
    expect(JSON.parse(existing.description).specialty).toBe('Cardiología');

    await page.reload();
    await expect(page.locator('#resumen')).toBeVisible();
    await navigateTo(page, 'cronologia');
    await edit();
    await expect(specialty).toHaveValue('Cardiología');
});
