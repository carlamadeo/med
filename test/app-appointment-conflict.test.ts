import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { driveAppointmentRepo, driveAuth } from '@data';
import { Outbox } from '@data/outbox';
import { fakeDriveFile, touchRemote } from './fake-drive';
import { $, mountPage } from './page';

const queue = new Outbox();
afterEach(async () => { for (const entry of await queue.list('account-one')) await queue.discard('account-one', entry.id!); });

it('compares and retries an offline appointment edit after a remote change', async () => {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, callback: () => Promise<void>) => callback() } });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await mountPage();
  const created = await driveAppointmentRepo.save({ date: '2026-11-20', time: '10:30', timeZone: 'America/Argentina/Buenos_Aires', professional: 'Inicial', notes: '', status: 'scheduled', cost: null, coverage: null });
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  await queue.enqueueAppointmentSave('account-one', { ...created, professional: 'Local' });
  const file = fakeDriveFile(created.id)!;
  file.description = JSON.stringify({ ...JSON.parse(file.description), professional: 'Remoto' });
  touchRemote(created.id);
  online.mockReturnValue(true);
  act(() => { window.dispatchEvent(new Event('online')); });
  await vi.waitFor(async () => expect((await queue.list('account-one'))[0]?.status).toBe('conflict'));
  await vi.waitFor(() => expect($('#pending-changes').textContent).toContain('Remoto'));
  expect($('#pending-changes').textContent).toContain('Local');
  const button = [...document.querySelectorAll<HTMLButtonElement>('#pending-changes button')].find(item => item.textContent === 'Conservar mi cambio')!;
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  await act(async () => { button.click(); });
  await vi.waitFor(async () => expect(await queue.list('account-one')).toHaveLength(0));
  expect(JSON.parse(file.description).professional).toBe('Local');
  expect(driveAuth.cachedAccountId()).toBe('account-one');
});
