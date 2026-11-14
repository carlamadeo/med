import { expect, test } from '@playwright/test';

test('queues a study offline and syncs it after reconnecting to the same account', async ({ page, context }, testInfo) => {
  const created: Record<string, unknown>[] = [];
  const ids = ['test-study', 'test-operation', 'test-portal', 'test-event'];
  let reserved = 0;
  await page.route('https://accounts.google.com/**', (route) => route.fulfill({ body: '', contentType: 'text/javascript' }));
  await page.route('https://www.googleapis.com/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/drive/v3/about') return route.fulfill({ json: { user: { me: true, permissionId: 'test-account' } } });
    if (url.pathname.endsWith('/generateIds')) return route.fulfill({ json: { ids: [ids[reserved++]] } });
    if (url.pathname === '/drive/v3/files') {
      const q = url.searchParams.get('q') ?? '';
      if (q.includes('carpeta-v1')) return route.fulfill({ json: { files: [{ id: 'test-folder' }] } });
      const marker = /value='([^']+)'/.exec(q)?.[1];
      return route.fulfill({ json: { files: created.filter((file) => (file.appProperties as Record<string, string>).misEstudios === marker) } });
    }
    if (url.pathname === '/upload/drive/v3/files' && request.method() === 'POST') {
      const body = request.postData() ?? '';
      // WebKit's interception does not expose a Blob request body; the fake response still models Drive's metadata.
      const fallback = [
        { id: 'test-study', name: 'Informe de prueba', description: JSON.stringify({ id: 'test-study', title: 'Informe de prueba', date: '2024-04-01', types: ['Otro'], doctor: '', portal: '', viewer: '', reportName: '', operationId: '' }), appProperties: { misEstudios: 'estudio-v1' } },
        { id: 'test-operation', name: 'Cirugía pendiente', description: JSON.stringify({ name: 'Cirugía pendiente', date: '', surgeon: '', institution: '', type: '', notes: '', color: '' }), appProperties: { misEstudios: 'operacion-v1' } },
        { id: 'test-portal', name: 'Clínica pendiente', description: JSON.stringify({ name: 'Clínica pendiente', displayName: 'Clínica pendiente', url: 'https://example.com/', notes: '' }), appProperties: { misEstudios: 'portal-v1' } },
        { id: 'test-event', name: 'Consulta', description: JSON.stringify({ kind: 'consultation', date: '2024-04-01', doctor: '', notes: 'Consulta de prueba', studyIds: ['test-study'], documentIds: [] }), appProperties: { misEstudios: 'evento-medico-v1' } },
      ];
      const metadata = body.includes('\r\n\r\n') ? JSON.parse(body.split('\r\n\r\n')[1]!.split('\r\n--')[0]!) : { ...fallback[created.length], mimeType: 'application/json' };
      const file = { ...metadata, version: '1', modifiedTime: '2024-01-01T00:00:00Z', trashed: false };
      created.push(file);
      return route.fulfill({ json: file });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.addInitScript(() => {
    sessionStorage.setItem('mis-estudios:drive-session:123-test.apps.googleusercontent.com', JSON.stringify({ accessToken: 'synthetic-token', expires: Date.now() + 3600000 }));
  });
  await page.goto('/');
  await expect(page.locator('.skiplink')).toHaveCSS('position', 'absolute');
  await expect(page.locator('dialog.onboarding:modal')).toBeVisible();
  await page.getByRole('button', { name: 'Entendido' }).click();
  await page.locator('#nav-cronologia').click();
  await expect(page.locator('#results')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agregar estudio' }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('mis-estudios:drive-session:123-test.apps.googleusercontent.com') ?? '{}').accountId)).toBe('test-account');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Agregar estudio' }).first().click();
  await page.locator('#editor-form input[name="report"]').setInputFiles({
    name: 'prueba.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nprueba'),
  });
  await expect(page.locator('#selected-report')).toContainText('prueba.pdf');
  await expect(page.locator('#selected-report')).toContainText('bytes');
  await page.getByRole('button', { name: 'Quitar archivo seleccionado' }).click();
  await expect(page.locator('#selected-report')).toHaveCount(0);
  await page.locator('#editor-title-field').fill('Informe de prueba');
  await page.locator('#editor-date-field').fill('2024-04-01');
  await page.locator('#study-types input[value="Otro"]').check();
  await page.getByRole('button', { name: 'Guardar estudio' }).click();
  await expect(page.locator('#pending-changes')).toContainText('Informe de prueba');
  const pendingRow = page.locator('#results li.record').filter({ hasText: 'Informe de prueba' });
  await expect(pendingRow).toContainText('Pendiente de sincronización');
  await page.screenshot({ path: testInfo.outputPath('pending.png'), fullPage: true });
  await context.setOffline(false);
  await expect(page.locator('#pending-changes')).toHaveCount(0);
  await expect(page.locator('#results')).toContainText('Informe de prueba');
  await context.setOffline(true);
  await page.locator('#nav-operaciones').click();
  await page.locator('#operation-name').fill('Cirugía pendiente');
  await page.locator('#operation-date').fill('2024-01-01');
  await page.locator('#operation-type').fill('Procedimiento');
  await page.getByRole('button', { name: 'Guardar operación' }).click();
  await expect(page.locator('#pending-changes')).toContainText('Cirugía pendiente');
  await page.locator('#nav-portales').click();
  await page.locator('#portal-name').fill('Clínica pendiente');
  await page.locator('#portal-url').fill('https://example.com');
  await page.getByRole('button', { name: 'Guardar portal' }).click();
  await expect(page.locator('#pending-changes')).toContainText('Clínica pendiente');
  await context.setOffline(false);
  await expect(page.locator('#pending-changes')).toHaveCount(0);
  await expect(page.locator('#portals-list')).toContainText('Clínica pendiente');
  await page.locator('#nav-operaciones').click();
  await expect(page.locator('#operations-list')).toContainText('Cirugía pendiente');
  await context.setOffline(true);
  await page.locator('#nav-eventos').click();
  await page.locator('#event-date').fill('2024-04-01');
  await page.locator('#event-notes').fill('Consulta de prueba');
  await page.locator('[data-event-study="test-study"]').check();
  await page.getByRole('button', { name: 'Guardar evento' }).click();
  await expect(page.locator('#events-list')).toContainText('Pendiente de sincronización');
  await context.setOffline(false);
  await expect(page.locator('#pending-changes')).toHaveCount(0);
  await expect(page.locator('#events-list')).toContainText('Consulta de prueba');
});
