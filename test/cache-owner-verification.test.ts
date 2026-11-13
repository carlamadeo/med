import { expect, it, vi } from 'vitest';
import { DriveAuthRepository, DriveClient, DriveStudyRepository } from '@data';

it('refuses cached private studies when the restored session has no verified account', async () => {
  const firstClient = new DriveClient();
  const firstAuth = new DriveAuthRepository(firstClient);
  const firstStudies = new DriveStudyRepository(firstClient);
  await firstAuth.signIn();
  await firstAuth.getAccountId();
  await firstStudies.list();

  const key = `mis-estudios:drive-session:${import.meta.env.VITE_GOOGLE_CLIENT_ID}`;
  const session = JSON.parse(window.sessionStorage.getItem(key)!);
  delete session.accountId;
  window.sessionStorage.setItem(key, JSON.stringify(session));
  const restoredClient = new DriveClient();
  const restoredAuth = new DriveAuthRepository(restoredClient);
  const restoredStudies = new DriveStudyRepository(restoredClient);
  expect(restoredAuth.restoreSession()).toBe(true);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

  await expect(restoredStudies.list()).rejects.toThrow(/verificar.*cuenta/i);
});

it('does not reuse a cache bound to a different verified account with the same token', async () => {
  const firstClient = new DriveClient();
  const firstAuth = new DriveAuthRepository(firstClient);
  await firstAuth.signIn();
  await firstAuth.getAccountId();
  const firstOwner = await firstClient.cacheOwner();
  const { storage } = await import('@core/storage');
  await storage.writeSessionDirectory(firstOwner, 'portalsCache', [{ name: 'privado' }]);

  const key = `mis-estudios:drive-session:${import.meta.env.VITE_GOOGLE_CLIENT_ID}`;
  const session = JSON.parse(window.sessionStorage.getItem(key)!);
  session.accountId = 'other-account';
  window.sessionStorage.setItem(key, JSON.stringify(session));
  const secondClient = new DriveClient();
  expect(new DriveAuthRepository(secondClient).restoreSession()).toBe(true);
  const secondOwner = await secondClient.cacheOwner();

  expect(secondOwner).not.toBe(firstOwner);
  expect(await storage.readSessionDirectory(secondOwner, 'portalsCache')).toBeNull();
});


it('removes legacy unscoped directories when the cache is rebound', async () => {
  const { openDB } = await import('idb');
  const { storage } = await import('@core/storage');
  const db = await openDB('mis-estudios', 1);
  await db.put('operations', { id: 'old-op', name: 'Privado' });
  await db.put('portals', { name: 'old-portal', displayName: 'Privado' });
  await storage.bindStudySession('new-session-owner');
  expect(await db.getAll('operations')).toEqual([]);
  expect(await db.getAll('portals')).toEqual([]);
  db.close();
});

it('removes legacy unscoped directories when clearing the cache', async () => {
  const { openDB } = await import('idb');
  const { storage } = await import('@core/storage');
  const db = await openDB('mis-estudios', 1);
  await db.put('operations', { id: 'old-op', name: 'Privado' });
  await db.put('portals', { name: 'old-portal', displayName: 'Privado' });
  await storage.clearStudyCache();
  expect(await db.getAll('operations')).toEqual([]);
  expect(await db.getAll('portals')).toEqual([]);
  db.close();
});
