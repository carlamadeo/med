import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { expect, it, vi } from 'vitest';

it('upgrades a version 1 database while retaining its records', async () => {
  const original = globalThis.indexedDB;
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new IDBFactory() });
  try {
    const legacy = await openDB('mis-estudios', 1, {
      upgrade(db) {
        db.createObjectStore('studies', { keyPath: 'id' });
        db.createObjectStore('operations', { keyPath: 'id' });
        db.createObjectStore('portals', { keyPath: 'name' });
        db.createObjectStore('pdf-blobs', { keyPath: 'studyId' });
        db.createObjectStore('meta', { keyPath: 'key' });
      },
    });
    await legacy.put('meta', { key: 'legacy-value', value: 'preserved' });
    legacy.close();

    vi.resetModules();
    const { storage } = await import('@core/storage');
    expect(await storage.getMeta('legacy-value')).toBe('preserved');
    const upgraded = await openDB('mis-estudios', 2);
    expect(upgraded.objectStoreNames.contains('episodes')).toBe(true);
    upgraded.close();
  } finally {
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: original });
    vi.resetModules();
  }
});
