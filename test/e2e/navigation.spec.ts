import { expect, test } from '@playwright/test';

test('navigates a long virtualized library with the keyboard without horizontal overflow', async ({ page }, testInfo) => {
  await page.route('https://accounts.google.com/**', (route) => route.fulfill({ body: '', contentType: 'text/javascript' }));
  await page.route('https://www.googleapis.com/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/drive/v3/about') return route.fulfill({ json: { user: { me: true, permissionId: 'test-account' } } });
    if (url.pathname === '/drive/v3/files') {
      const q = url.searchParams.get('q') ?? '';
      const files = q.includes('estudio-v1') ? Array.from({ length: 200 }, (_, i) => ({ id: `study-${i}`, version: '1', modifiedTime: '2024-01-01T00:00:00Z', trashed: false, mimeType: 'application/json', appProperties: { misEstudios: 'estudio-v1' }, description: JSON.stringify({ title: `Estudio ${String(i).padStart(3, '0')}`, date: '2024-01-01', types: ['Otro'], doctor: '', portal: '', viewer: '', reportName: '' }) })) : [];
      return route.fulfill({ json: { files } });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.addInitScript(() => {
    sessionStorage.setItem('mis-estudios:drive-session:123-test.apps.googleusercontent.com', JSON.stringify({ accessToken: 'synthetic-token', expires: Date.now() + 3600000 }));
    localStorage.setItem('mis-estudios-onboarding-seen', 'true');
  });
  await page.goto('/');
  await page.locator('#nav-cronologia').click();
  await expect(page.locator('#count')).toHaveText('200');
  await expect(page.locator('#results li.record').first()).toBeVisible();
  expect(await page.locator('#results li.record').count()).toBeLessThan(50);
  const renderTimes = await page.evaluate(async () => {
    const search = document.querySelector<HTMLInputElement>('#search')!;
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) {
      search.value = 'sin coincidencias'; search.dispatchEvent(new Event('input', { bubbles: true }));
      await frame(); await frame();
      const start = performance.now();
      search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true }));
      await frame(); await frame();
      samples.push(performance.now() - start);
    }
    return samples;
  });
  console.log(`200-study filter-to-frame samples (${testInfo.project.name}): ${renderTimes.map((time) => time.toFixed(1)).join(', ')} ms`);
  await expect(page.locator('#results li.record').first()).toBeVisible();
  await page.locator('#results li.record').first().focus();
  for (let i = 1; i <= 25; i++) {
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-index'))).toBe(String(i));
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('#results li.record .edit').first().click();
  const report = page.locator('#editor input[name="report"]');
  await report.setInputFiles({ name: 'primero.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n') });
  await expect.poll(() => report.evaluate((input: HTMLInputElement) => input.files?.length)).toBe(1);
  await page.locator('#editor [aria-label="Cerrar"]').click();
  await page.locator('#results li.record .edit').first().click();
  await expect.poll(() => report.evaluate((input: HTMLInputElement) => input.files?.length)).toBe(0);
  await page.locator('#editor [aria-label="Cerrar"]').click();
  await page.locator('#nav-operaciones').click();
  await expect(page.getByRole('heading', { name: 'Operaciones', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('operations.png'), fullPage: true });
  await page.locator('#nav-portales').click();
  await expect(page.getByRole('heading', { name: 'Portales e instituciones' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
