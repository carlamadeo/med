import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { Outbox } from '@data/outbox';
import { fakeDriveFile } from './fake-drive';
import { $, mountPage, rowIds, typeInto } from './page';

const queue = new Outbox();
afterEach(async () => { for (const entry of await queue.list('account-one')) await queue.discard('account-one', entry.id!); });

it('creates a consultation offline and shows it pending with its study association', async () => {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, callback: () => Promise<void>) => callback() } });
  await mountPage();
  await vi.waitFor(() => expect(rowIds()).toContain('study-1'));
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  act(() => { $<HTMLButtonElement>('#tab-eventos').click(); });
  typeInto('#event-date', '2024-01-15');
  typeInto('#event-notes', 'Consulta de prueba');
  act(() => { $<HTMLInputElement>('[data-event-study="study-1"]').click(); });
  await act(async () => { $<HTMLFormElement>('#event-form').requestSubmit(); });
  await vi.waitFor(() => expect(document.querySelector('#events-list')?.textContent).toContain('Consulta de prueba'));
  expect(document.querySelector('#events-list')?.textContent).toContain('Pendiente de sincronización');
  expect((await queue.list('account-one'))[0]?.eventDraft?.studyIds).toEqual(['study-1']);
  online.mockReturnValue(true);
  act(() => { window.dispatchEvent(new Event('online')); });
  await vi.waitFor(async () => expect(await queue.list('account-one')).toHaveLength(0));
  expect(fakeDriveFile('generated-1')?.appProperties.misEstudios).toBe('evento-medico-v1');
});
