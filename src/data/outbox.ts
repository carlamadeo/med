import { openDB, type DBSchema } from 'idb';
import type { StudyDraft, OperationDraft, Portal, PortalDraft } from '@domain/models';
import { DriveConflictError } from './drive-repository';

export interface OutboxAdapter {
  accountId(): Promise<string>;
  reserveId(): Promise<string>;
  save(draft: StudyDraft): Promise<void>;
  delete(id: string, revision: string): Promise<void>;
  saveOperation(draft: OperationDraft): Promise<void>;
  deleteOperation(id: string, revision: string): Promise<void>;
  savePortal(draft: PortalDraft): Promise<void>;
  deletePortal(portal: Portal): Promise<void>;
  lock(name: string, callback: () => Promise<void>): Promise<void>;
}

export interface OutboxEntry {
  id?: number;
  owner: string;
  kind: 'save' | 'delete' | 'operation-save' | 'operation-delete' | 'portal-save' | 'portal-delete';
  status: 'pending' | 'conflict';
  studyId?: string;
  revision?: string;
  draft?: Omit<StudyDraft, 'file'>;
  operationDraft?: OperationDraft;
  portalDraft?: PortalDraft;
  operationId?: string;
  portalId?: string;
  portal?: Portal;
  attachment?: Blob;
  attachmentName?: string;
  lastError?: string;
}

interface OutboxDB extends DBSchema {
  entries: { key: number; value: OutboxEntry; indexes: { owner: string } };
}

const dbPromise = openDB<OutboxDB>('mis-estudios-outbox', 1, {
  upgrade(db) {
    const entries = db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
    entries.createIndex('owner', 'owner');
  },
});

export class Outbox {
  private async enqueue(entry: OutboxEntry): Promise<void> {
    if (!entry.owner) throw new Error('No se pudo verificar la cuenta de Drive.');
    const db = await dbPromise;
    const tx = db.transaction('entries', 'readwrite');
    const existing = await tx.store.index('owner').getAll(entry.owner);
    if (entry.draft?.operationId && existing.some((item) => item.kind === 'operation-delete' && item.operationId === entry.draft?.operationId)) {
      await tx.done;
      throw new Error('La operación tiene una eliminación pendiente.');
    }
    if (entry.kind === 'operation-delete' && existing.some((item) => item.draft?.operationId === entry.operationId)) {
      await tx.done;
      throw new Error('Hay un estudio pendiente vinculado a esta operación.');
    }
    if (entry.studyId || entry.operationId || entry.portalId) {
      if (existing.some((item) => (entry.studyId && item.studyId === entry.studyId) || (entry.operationId && item.operationId === entry.operationId) || (entry.portalId && item.portalId === entry.portalId))) {
        await tx.done;
        throw new Error('Este registro ya tiene un cambio pendiente.');
      }
    }
    await tx.store.add(entry);
    await tx.done;
  }

  async enqueueSave(owner: string, draft: StudyDraft): Promise<void> {
    const { file, ...fields } = draft;
    await this.enqueue({ owner, kind: 'save', status: 'pending', studyId: draft.driveFileId, draft: fields, attachment: file, attachmentName: file?.name });
  }

  async enqueueDelete(owner: string, id: string, revision: string): Promise<void> {
    if (!id || !revision) throw new Error('La ficha no tiene una revisión válida.');
    await this.enqueue({ owner, kind: 'delete', status: 'pending', studyId: id, revision });
  }

  async enqueueOperationSave(owner: string, draft: OperationDraft): Promise<void> {
    await this.enqueue({ owner, kind: 'operation-save', status: 'pending', operationId: draft.id, operationDraft: draft });
  }

  async enqueueOperationDelete(owner: string, id: string, revision: string): Promise<void> {
    if (!id || !revision) throw new Error('La operación no tiene una revisión válida.');
    await this.enqueue({ owner, kind: 'operation-delete', status: 'pending', operationId: id, revision });
  }

  async enqueuePortalSave(owner: string, draft: PortalDraft): Promise<void> {
    await this.enqueue({ owner, kind: 'portal-save', status: 'pending', portalId: draft.id, portalDraft: draft });
  }

  async enqueuePortalDelete(owner: string, portal: Portal): Promise<void> {
    if (!portal.id || !portal.revision) throw new Error('El portal no tiene una revisión válida.');
    await this.enqueue({ owner, kind: 'portal-delete', status: 'pending', portalId: portal.id, portal });
  }

  async list(owner: string): Promise<OutboxEntry[]> {
    return (await dbPromise).getAllFromIndex('entries', 'owner', owner);
  }

  /** Explicitly discarding a pending change is a user-facing action. */
  async discard(owner: string, id: number): Promise<void> {
    const tx = (await dbPromise).transaction('entries', 'readwrite');
    if ((await tx.store.get(id))?.owner === owner) await tx.store.delete(id);
    await tx.done;
  }

  async sync(owner: string, remote: OutboxAdapter): Promise<void> {
    await remote.lock(`mis-estudios-outbox:${owner}`, async () => {
      if (await remote.accountId() !== owner) return;
      const db = await dbPromise;
      for (const entry of await this.list(owner)) {
        if (entry.id === undefined || entry.status === 'conflict') break;
        try {
          if (await remote.accountId() !== owner) return;
          if (entry.kind === 'save' && entry.draft) {
            if (!entry.draft.driveFileId && !entry.draft.id) {
              entry.draft.id = await remote.reserveId();
              await db.put('entries', entry);
            }
            const file = entry.attachment ? new File([entry.attachment], entry.attachmentName ?? 'Informe.pdf', { type: 'application/pdf' }) : undefined;
            await remote.save({ ...entry.draft, file });
          } else if (entry.kind === 'delete' && entry.studyId && entry.revision) {
            await remote.delete(entry.studyId, entry.revision);
          } else if (entry.kind === 'operation-save' && entry.operationDraft) {
            if (!entry.operationDraft.id && !entry.operationDraft.createId) { entry.operationDraft.createId = await remote.reserveId(); await db.put('entries', entry); }
            await remote.saveOperation(entry.operationDraft);
          } else if (entry.kind === 'operation-delete' && entry.operationId && entry.revision) {
            await remote.deleteOperation(entry.operationId, entry.revision);
          } else if (entry.kind === 'portal-save' && entry.portalDraft) {
            if (!entry.portalDraft.id && !entry.portalDraft.createId) { entry.portalDraft.createId = await remote.reserveId(); await db.put('entries', entry); }
            await remote.savePortal(entry.portalDraft);
          } else if (entry.kind === 'portal-delete' && entry.portal) {
            await remote.deletePortal(entry.portal);
          } else throw new Error('Cambio pendiente inválido.');
          await this.discard(owner, entry.id);
        } catch (err) {
          entry.status = err instanceof DriveConflictError ? 'conflict' : 'pending';
          entry.lastError = err instanceof Error ? err.message : 'No se pudo sincronizar.';
          await db.put('entries', entry);
          break;
        }
      }
    });
  }
}
