import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { driveAuth } from '@data';
import { Outbox } from '@data/outbox';
import { $, mountPage, rowIds } from './page';

const queue = new Outbox();
afterEach(async () => { for (const entry of await queue.list('account-one')) await queue.discard('account-one', entry.id!); });

it('queues a document link offline and synchronizes it without duplicating the PDF', async () => {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, callback: () => Promise<void>) => callback() } });
  await mountPage();
  await vi.waitFor(() => expect(rowIds()).toContain('study-2'));
  await vi.waitFor(() => expect(driveAuth.cachedAccountId()).toBe('account-one'));
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  act(() => { document.querySelector<HTMLButtonElement>('#results li[data-id="study-2"] .edit')!.click(); });
  act(() => { $<HTMLInputElement>('#study-types input[value=Otro]').click(); $<HTMLInputElement>('[name="documentIds"][value="study-1"]').click(); });
  await act(async () => { $<HTMLFormElement>('#editor-form').requestSubmit(); });
  await vi.waitFor(async () => expect((await queue.list('account-one'))[0]?.draft?.documentIds).toEqual(['study-1']));
  online.mockReturnValue(true);
  act(() => { window.dispatchEvent(new Event('online')); });
  await vi.waitFor(async () => expect(await queue.list('account-one')).toHaveLength(0));
  await vi.waitFor(() => expect(document.querySelector('#results li[data-id="study-2"]')?.textContent).toContain('PDF asociado'));
});
