import { act } from 'preact/test-utils';
import { expect, it, vi } from 'vitest';
import { fakeDriveFile, touchRemote } from './fake-drive';
import { $, mountPage } from './page';

it('creates a study in Drive from the editor', async () => {
  await mountPage();
  await act(() => { $<HTMLButtonElement>('[data-add]').click(); });
  const form = $<HTMLFormElement>('#editor-form');
  const title = form.elements.namedItem('title') as HTMLInputElement;
  const date = form.elements.namedItem('date') as HTMLInputElement;
  const type = form.querySelector<HTMLInputElement>('[name="types"][value="Otro"]')!;
  await act(() => {
    title.value = 'Estudio de prueba'; title.dispatchEvent(new Event('input', { bubbles: true }));
    date.value = '2024-04-04'; date.dispatchEvent(new Event('input', { bubbles: true }));
    type.checked = true; type.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await vi.waitFor(() => expect(fakeDriveFile('generated-1')).toBeDefined());
  expect(JSON.parse(fakeDriveFile('generated-1')!.description)).toMatchObject({ title: 'Estudio de prueba', date: '2024-04-04', types: ['Otro'] });
  await vi.waitFor(() => expect(document.querySelector('#results [data-id="generated-1"] .edit')).not.toBeNull());
  await act(() => { document.querySelector<HTMLButtonElement>('#results [data-id="generated-1"] .edit')!.click(); });
  await act(() => {
    title.value = 'Estudio editado'; title.dispatchEvent(new Event('input', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(JSON.parse(fakeDriveFile('generated-1')!.description).title).toBe('Estudio editado'));
  await vi.waitFor(() => expect($<HTMLDialogElement>('#editor').open).toBe(false));
  await vi.waitFor(() => expect(document.querySelector('#results li[data-id="generated-1"] .edit')).not.toBeNull());
  await act(() => { document.querySelector<HTMLButtonElement>('#results [data-id="generated-1"] .edit')!.click(); });
  touchRemote('generated-1');
  await act(() => {
    title.value = 'Versión en conflicto'; title.dispatchEvent(new Event('input', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect($('#form-error').textContent).toContain('cambió en Drive'));
  expect(JSON.parse(fakeDriveFile('generated-1')!.description).title).toBe('Estudio editado');
});
