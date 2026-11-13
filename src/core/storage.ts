import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

interface MisEstudiosDB extends DBSchema {
  studies: { key: string; value: StudyRecord; indexes: { 'by-date': string; 'by-type': string } };
  operations: { key: string; value: OperationRecord; indexes: { 'by-name': string } };
  portals: { key: string; value: PortalRecord; indexes: { 'by-name': string } };
  episodes: { key: string; value: EpisodeRecord; indexes: { 'by-illness': string } };
  'pdf-blobs': { key: string; value: { studyId: string; blob: Blob; timestamp: number } };
  meta: { key: string; value: { key: string; value: unknown } };
}

interface StudyRecord {
  id: string;
  title: string;
  date: string;
  types: string[];
  doctor: string;
  portal: string;
  viewer: string;
  reportName: string;
  hasPdf: boolean;
  attachmentMime?: 'image/jpeg' | 'image/png';
  driveFileId: string;
  driveModifiedTime: string;
  revision: string;
  operationId?: string;
  documentIds?: string[];
  createdAt: number;
  updatedAt: number;
}

interface OperationRecord {
  id: string;
  name: string;
  studyIds: string[];
  color: string;
  createdAt: number;
  updatedAt: number;
}

interface PortalRecord {
  name: string;
  displayName: string;
  url: string;
  createdAt: number;
  updatedAt: number;
}

interface EpisodeRecord {
  id: string;
  illness: string;
  observations: unknown[];
  medications: unknown[];
  revision: string;
  createdAt: number;
  updatedAt: number;
}

let dbPromise: Promise<IDBPDatabase<MisEstudiosDB>> | null = null;

function getDB(): Promise<IDBPDatabase<MisEstudiosDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MisEstudiosDB>('mis-estudios', 2, {
      upgrade(db: IDBPDatabase<MisEstudiosDB>, oldVersion) {
        const studies = db.createObjectStore('studies', { keyPath: 'id' });
        studies.createIndex('by-date', 'date');
        studies.createIndex('by-type', 'types');

        const operations = db.createObjectStore('operations', { keyPath: 'id' });
        operations.createIndex('by-name', 'name');

        const portals = db.createObjectStore('portals', { keyPath: 'name' });
        portals.createIndex('by-name', 'displayName');

        if (oldVersion < 2) {
          const episodes = db.createObjectStore('episodes', { keyPath: 'id' });
          episodes.createIndex('by-illness', 'illness');
        }

        db.createObjectStore('pdf-blobs', { keyPath: 'studyId' });
        db.createObjectStore('meta', { keyPath: 'key' });
      },
    });
  }
  return dbPromise!;
}

export const storage = {
  async readSessionDirectory<T>(owner: string, key: 'operationsCache' | 'portalsCache' | 'eventsCache' | 'episodesCache' | 'appointmentsCache' | 'intakeCandidatesStatus' | 'deletedStudiesCache' | 'deletedEventsCache' | 'deletedAppointmentsCache' | 'deletedEpisodesCache' | 'deletedOperationsCache' | 'deletedPortalsCache'): Promise<T[] | null> {
    const db = await getDB();
    const tx = db.transaction('meta', 'readonly');
    const matches = (await tx.store.get('cacheOwner'))?.value === owner;
    const value = matches ? (await tx.store.get(key))?.value : undefined;
    await tx.done;
    return Array.isArray(value) ? value as T[] : null;
  },

  async writeSessionDirectory<T>(owner: string, key: 'operationsCache' | 'portalsCache' | 'eventsCache' | 'episodesCache' | 'appointmentsCache' | 'intakeCandidatesStatus' | 'deletedStudiesCache' | 'deletedEventsCache' | 'deletedAppointmentsCache' | 'deletedEpisodesCache' | 'deletedOperationsCache' | 'deletedPortalsCache', value: T[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('meta', 'readwrite');
    if ((await tx.store.get('cacheOwner'))?.value === owner) await tx.store.put({ key, value });
    await tx.done;
  },
  /** Cache ownership and data are checked in the same transaction across tabs. */
  async bindStudySession(owner: string): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(['studies', 'pdf-blobs', 'operations', 'portals', 'episodes', 'meta'], 'readwrite');
    const meta = tx.objectStore('meta');
    await Promise.all([tx.objectStore('operations').clear(), tx.objectStore('portals').clear(), tx.objectStore('episodes').clear()]);
    if ((await meta.get('cacheOwner'))?.value !== owner) {
      await Promise.all([tx.objectStore('studies').clear(), tx.objectStore('pdf-blobs').clear(), tx.objectStore('episodes').clear(), meta.clear()]);
      await meta.put({ key: 'cacheOwner', value: owner });
    }
    await tx.done;
  },

  async readSessionStudies(owner: string): Promise<StudyRecord[] | null> {
    const db = await getDB();
    const tx = db.transaction(['studies', 'meta'], 'readonly');
    const matches = (await tx.objectStore('meta').get('cacheOwner'))?.value === owner;
    const records = matches ? await tx.objectStore('studies').getAll() : null;
    await tx.done;
    return records;
  },

  async readCompleteSessionStudies(owner: string): Promise<{ records: StudyRecord[]; lastSync: number } | null> {
    const db = await getDB();
    const tx = db.transaction(['studies', 'meta'], 'readonly');
    const meta = tx.objectStore('meta');
    const matches = (await meta.get('cacheOwner'))?.value === owner;
    const lastSync = matches ? (await meta.get('lastSync'))?.value : undefined;
    const records = typeof lastSync === 'number' ? await tx.objectStore('studies').getAll() : null;
    await tx.done;
    return records && typeof lastSync === 'number' ? { records, lastSync } : null;
  },

  async writeSessionStudies(owner: string, records: StudyRecord[], replace = false): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(['studies', 'meta'], 'readwrite');
    if ((await tx.objectStore('meta').get('cacheOwner'))?.value === owner) {
      const store = tx.objectStore('studies');
      if (replace) await store.clear();
      await Promise.all(records.map((record) => store.put(record)));
      if (replace) await tx.objectStore('meta').put({ key: 'lastSync', value: Date.now() });
    }
    await tx.done;
  },

  async deleteSessionStudy(owner: string, id: string): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(['studies', 'meta'], 'readwrite');
    if ((await tx.objectStore('meta').get('cacheOwner'))?.value === owner) await tx.objectStore('studies').delete(id);
    await tx.done;
  },

  async readSessionEpisodes(owner: string): Promise<EpisodeRecord[] | null> {
    const db = await getDB();
    const tx = db.transaction(['episodes', 'meta'], 'readonly');
    const matches = (await tx.objectStore('meta').get('cacheOwner'))?.value === owner;
    const records = matches ? await tx.objectStore('episodes').getAll() : null;
    await tx.done;
    return records;
  },

  async getStudies(): Promise<StudyRecord[]> {
    const db = await getDB();
    return db.getAll('studies');
  },

  async getStudy(id: string): Promise<StudyRecord | undefined> {
    const db = await getDB();
    return db.get('studies', id);
  },

  async setStudies(studies: StudyRecord[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('studies', 'readwrite');
    await Promise.all(studies.map((s) => tx.store.put(s)));
    await tx.done;
  },

  /** Removes everything derived from the user's Drive (used on sign-out). */
  async clearStudyCache(): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(['studies', 'pdf-blobs', 'operations', 'portals', 'episodes', 'meta'], 'readwrite');
    await Promise.all([
      tx.objectStore('studies').clear(),
      tx.objectStore('pdf-blobs').clear(),
      tx.objectStore('operations').clear(),
      tx.objectStore('portals').clear(),
      tx.objectStore('episodes').clear(),
      tx.objectStore('meta').clear(),
      tx.done,
    ]);
  },

  async getMeta(key: string): Promise<unknown> {
    const db = await getDB();
    const record = await db.get('meta', key);
    return record?.value;
  },

  async setMeta(key: string, value: unknown): Promise<void> {
    const db = await getDB();
    await db.put('meta', { key, value });
  },

  async isStale(maxAgeMs = 24 * 60 * 60 * 1000): Promise<boolean> {
    const lastSync = (await this.getMeta('lastSync')) as number | undefined;
    if (!lastSync) return true;
    return Date.now() - lastSync > maxAgeMs;
  },
};

export type { StudyRecord, EpisodeRecord };
