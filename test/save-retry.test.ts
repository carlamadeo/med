import { act } from 'preact/test-utils';
import { http, HttpResponse } from 'msw';
import { expect, it, vi } from 'vitest';
import { fakeDriveFile } from './fake-drive';
import { $, mountPage } from './page';
import { server } from './server';

it('reuses the reserved ID after a failed upload', async () => {
  await mountPage();
  let attempts = 0;
  server.use(http.post('https://www.googleapis.com/upload/drive/v3/files', () => {
    if (++attempts === 1) return new HttpResponse(null, { status: 500 });
    return undefined;
  }));
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  await act(() => { $<HTMLButtonElement>('[data-add]').click(); });
  const form = $<HTMLFormElement>('#editor-form');
  await act(() => {
    const title = form.elements.namedItem('title') as HTMLInputElement;
    const date = form.elements.namedItem('date') as HTMLInputElement;
    title.value = 'Con reintento'; title.dispatchEvent(new Event('input', { bubbles: true }));
    date.value = '2024-01-01'; date.dispatchEvent(new Event('input', { bubbles: true }));
    const type = form.querySelector<HTMLInputElement>('[name="types"][value="Otro"]')!;
    type.checked = true; type.dispatchEvent(new Event('input', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect($('#form-error').hidden).toBe(false));
  await act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await vi.waitFor(() => expect(fakeDriveFile('generated-1')).toBeDefined());
  expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes('generateIds'))).toHaveLength(1);
});
