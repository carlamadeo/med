import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

interface MisEstudiosDB extends DBSchema {
  studies: { key: string; value: StudyRecord; indexes: { 'by-date': string; 'by-type': string } };
  operations: { key: string; value: OperationRecord; indexes: { 'by-name': string } };
  portals: { key: string; value: PortalRecord; indexes: { 'by-name': string } };
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
  driveFileId: string;
  driveModifiedTime: string;
  revision: string;
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

let dbPromise: Promise<IDBPDatabase<MisEstudiosDB>> | null = null;

function getDB(): Promise<IDBPDatabase<MisEstudiosDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MisEstudiosDB>('mis-estudios', 1, {
      upgrade(db: IDBPDatabase<MisEstudiosDB>) {
        const studies = db.createObjectStore('studies', { keyPath: 'id' });
        studies.createIndex('by-date', 'date');
        studies.createIndex('by-type', 'types');

        const operations = db.createObjectStore('operations', { keyPath: 'id' });
        operations.createIndex('by-name', 'name');

        const portals = db.createObjectStore('portals', { keyPath: 'name' });
        portals.createIndex('by-name', 'displayName');

        db.createObjectStore('pdf-blobs', { keyPath: 'studyId' });
        db.createObjectStore('meta', { keyPath: 'key' });
      },
    });
  }
  return dbPromise!;
}

export const storage = {
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

  /** Replaces the whole studies cache atomically (drops entries no longer in Drive). */
  async replaceStudies(studies: StudyRecord[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('studies', 'readwrite');
    await tx.store.clear();
    await Promise.all([...studies.map((s) => tx.store.put(s)), tx.done]);
  },

  async deleteStudy(id: string): Promise<void> {
    const db = await getDB();
    await db.delete('studies', id);
  },

  /** Removes everything derived from the user's Drive (used on sign-out). */
  async clearStudyCache(): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(['studies', 'pdf-blobs', 'meta'], 'readwrite');
    await Promise.all([
      tx.objectStore('studies').clear(),
      tx.objectStore('pdf-blobs').clear(),
      tx.objectStore('meta').clear(),
      tx.done,
    ]);
  },

  async getOperations(): Promise<OperationRecord[]> {
    const db = await getDB();
    return db.getAll('operations');
  },

  async getOperation(id: string): Promise<OperationRecord | undefined> {
    const db = await getDB();
    return db.get('operations', id);
  },

  async setOperations(ops: OperationRecord[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('operations', 'readwrite');
    await Promise.all(ops.map((o) => tx.store.put(o)));
    await tx.done;
  },

  async deleteOperation(id: string): Promise<void> {
    const db = await getDB();
    await db.delete('operations', id);
  },

  async getPortals(): Promise<PortalRecord[]> {
    const db = await getDB();
    return db.getAll('portals');
  },

  async getPortal(name: string): Promise<PortalRecord | undefined> {
    const db = await getDB();
    return db.get('portals', name);
  },

  async setPortals(portals: PortalRecord[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('portals', 'readwrite');
    await Promise.all(portals.map((p) => tx.store.put(p)));
    await tx.done;
  },

  async deletePortal(name: string): Promise<void> {
    const db = await getDB();
    await db.delete('portals', name);
  },

  async getPdfBlob(studyId: string): Promise<Blob | undefined> {
    const db = await getDB();
    const record = await db.get('pdf-blobs', studyId);
    return record?.blob;
  },

  async setPdfBlob(studyId: string, blob: Blob): Promise<void> {
    const db = await getDB();
    await db.put('pdf-blobs', { studyId, blob, timestamp: Date.now() });
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

  async setLastSync(): Promise<void> {
    await this.setMeta('lastSync', Date.now());
  },
};

export type { StudyRecord, OperationRecord, PortalRecord };