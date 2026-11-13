import { expect, test } from '@playwright/test';

test('the application shell reloads offline without caching Drive responses', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mis estudios', level: 1 })).toBeVisible();
  expect(await page.evaluate(async () => (await fetch('./vendor/pdf/pdf.min.mjs')).ok)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mis estudios', level: 1 })).toBeVisible();
  expect(await page.evaluate(async () => (await fetch('./vendor/pdf/pdf.min.mjs')).ok)).toBe(true);
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (name) => (await caches.open(name)).keys()))).flat().map((request) => request.url));
  expect(cached.length).toBeGreaterThan(0);
  expect(cached.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
});
