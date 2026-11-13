import { afterEach, expect, it, vi } from 'vitest';
import { driveAuth } from '@data';
import { enqueueOffline } from '@presentation/utils/enqueueOffline';

afterEach(() => vi.unstubAllGlobals());

it('does not enqueue after the session changes while waiting for the lock', async () => {
  let token = 'first';
  vi.spyOn(driveAuth, 'getAccessToken').mockImplementation(async () => token);
  vi.spyOn(driveAuth, 'cachedAccountId').mockReturnValue('owner');
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const request = vi.fn(async (_name: string, callback: () => Promise<void>) => {
    await waiting;
    await callback();
  });
  vi.stubGlobal('navigator', { locks: { request } });
  const action = vi.fn(async () => {});
  const pending = enqueueOffline('owner', action);
  const rejected = expect(pending).rejects.toThrow('La cuenta cambió');
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
  token = 'second';
  release();
  await rejected;
  expect(action).not.toHaveBeenCalled();
});
