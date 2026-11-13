import { openDB, type DBSchema } from 'idb';
import type { StudyDraft, OperationDraft, Portal, PortalDraft, MedicalEventDraft, EpisodeDraft, AppointmentDraft } from '@domain/models';
import { DriveConflictError } from './drive-api';

export interface OutboxAdapter {
  accountId(): Promise<string>;
  reserveId(): Promise<string>;
  save(draft: StudyDraft): Promise<void>;
  delete(id: string, revision: string): Promise<void>;
  restore(id: string, revision: string): Promise<void>;
  saveOperation(draft: OperationDraft): Promise<void>;
  deleteOperation(id: string, revision: string): Promise<void>;
  restoreOperation(id: string, revision: string): Promise<void>;
  savePortal(draft: PortalDraft): Promise<void>;
  deletePortal(portal: Portal): Promise<void>;
  restorePortal(id: string, revision: string): Promise<void>;
  saveEvent(draft: MedicalEventDraft): Promise<void>;
  deleteEvent(id: string, revision: string): Promise<void>;
  restoreEvent(id: string, revision: string): Promise<void>;
  saveEpisode(draft: EpisodeDraft): Promise<void>;
  deleteEpisode(id: string, revision: string): Promise<void>;
  restoreEpisode(id: string, revision: string): Promise<void>;
  saveAppointment(draft: AppointmentDraft): Promise<void>;
  deleteAppointment(id: string, revision: string): Promise<void>;
  restoreAppointment(id: string, revision: string): Promise<void>;
  lock(name: string, callback: () => Promise<void>): Promise<void>;
}

export interface OutboxEntry {
  id?: number;
  owner: string;
  kind: 'save' | 'delete' | 'restore' | 'operation-save' | 'operation-delete' | 'operation-restore' | 'portal-save' | 'portal-delete' | 'portal-restore' | 'event-save' | 'event-delete' | 'event-restore' | 'episode-save' | 'episode-delete' | 'episode-restore' | 'appointment-save' | 'appointment-delete' | 'appointment-restore';
  status: 'pending' | 'conflict' | 'failed';
  studyId?: string;
  revision?: string;
  draft?: Omit<StudyDraft, 'file'>;
  operationDraft?: OperationDraft;
  portalDraft?: PortalDraft;
  eventDraft?: MedicalEventDraft;
  episodeDraft?: EpisodeDraft;
  appointmentDraft?: AppointmentDraft;
  appointmentId?: string;
  eventId?: string;
  operationId?: string;
  portalId?: string;
  portal?: Portal;
  episodeId?: string;
  attachment?: Blob;
  attachmentName?: string;
  attachmentType?: string;
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
    const documentIds = entry.draft?.documentIds ?? entry.eventDraft?.documentIds ?? [];
    if (documentIds.some((id) => existing.some((item) => item.studyId === id && (item.kind === 'delete' || (item.kind === 'save' && (item.attachment || item.draft?.removeReport)))))) {
      await tx.done;
      throw new Error('Un documento vinculado tiene un cambio pendiente.');
    }
    if (entry.studyId && (entry.kind === 'delete' || (entry.kind === 'save' && (entry.attachment || entry.draft?.removeReport))) &&
        existing.some((item) => item.draft?.documentIds?.includes(entry.studyId!) || item.eventDraft?.documentIds.includes(entry.studyId!))) {
      await tx.done;
      throw new Error('Hay un vínculo pendiente con este documento.');
    }
    if (entry.draft?.operationId && existing.some((item) => item.kind === 'operation-delete' && item.operationId === entry.draft?.operationId)) {
      await tx.done;
      throw new Error('La operación tiene una eliminación pendiente.');
    }
    if (entry.kind === 'operation-delete' && existing.some((item) => item.draft?.operationId === entry.operationId)) {
      await tx.done;
      throw new Error('Hay un estudio pendiente vinculado a esta operación.');
    }
    if (entry.studyId || entry.operationId || entry.portalId || entry.eventId || entry.episodeId || entry.appointmentId) {
      if (existing.some((item) => (entry.studyId && item.studyId === entry.studyId) || (entry.operationId && item.operationId === entry.operationId) || (entry.portalId && item.portalId === entry.portalId) || (entry.eventId && item.eventId === entry.eventId) || (entry.episodeId && item.episodeId === entry.episodeId) || (entry.appointmentId && item.appointmentId === entry.appointmentId))) {
        await tx.done;
        throw new Error('Este registro ya tiene un cambio pendiente.');
      }
    }
    await tx.store.add(entry);
    await tx.done;
  }

  async enqueueSave(owner: string, draft: StudyDraft): Promise<void> {
    const { file, ...fields } = draft;
    await this.enqueue({ owner, kind: 'save', status: 'pending', studyId: draft.driveFileId, draft: fields, attachment: file, attachmentName: file?.name, attachmentType: file?.type });
  }

  async enqueueDelete(owner: string, id: string, revision: string): Promise<void> {
    if (!id || !revision) throw new Error('La ficha no tiene una revisión válida.');
    await this.enqueue({ owner, kind: 'delete', status: 'pending', studyId: id, revision });
  }

  async enqueueRestore(owner: string, id: string, revision: string): Promise<void> {
    if (!id || !revision) throw new Error('La ficha no tiene una revisión válida.');
    await this.enqueue({ owner, kind: 'restore', status: 'pending', studyId: id, revision });
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

  async enqueueEventSave(owner: string, draft: MedicalEventDraft): Promise<void> {
    await this.enqueue({ owner, kind: 'event-save', status: 'pending', eventId: draft.id, eventDraft: draft });
  }

  async enqueueEpisodeSave(owner: string, draft: EpisodeDraft): Promise<void> {
    await this.enqueue({ owner, kind: 'episode-save', status: 'pending', episodeId: draft.id, episodeDraft: draft });
  }

  async enqueueAppointmentSave(owner: string, draft: AppointmentDraft): Promise<void> {
    await this.enqueue({ owner, kind: 'appointment-save', status: 'pending', appointmentId: draft.id, appointmentDraft: draft });
  }

  async enqueueEventDelete(owner: string, id: string, revision: string): Promise<void> {
    if (!id || !revision) throw new Error('El evento no tiene una revisión válida.');
    await this.enqueue({ owner, kind: 'event-delete', status: 'pending', eventId: id, revision });
  }

  async enqueueAppointmentDelete(owner: string, id: string, revision: string): Promise<void> {
    if (!id || !revision) throw new Error('El turno no tiene una revisión válida.');
    await this.enqueue({ owner, kind: 'appointment-delete', status: 'pending', appointmentId: id, revision });
  }

  async enqueueEpisodeRestore(owner: string, id: string, revision: string): Promise<void> {
    if (!id || !revision) throw new Error('El episodio no tiene una revisión válida.');
    await this.enqueue({ owner, kind: 'episode-restore', status: 'pending', episodeId: id, revision });
  }

  async enqueueAppointmentRestore(owner: string, id: string, revision: string): Promise<void> {
    if (!id || !revision) throw new Error('El turno no tiene una revisión válida.');
    await this.enqueue({ owner, kind: 'appointment-restore', status: 'pending', appointmentId: id, revision });
  }

  async enqueueEventRestore(owner: string, id: string, revision: string): Promise<void> {
    if (!id || !revision) throw new Error('El evento no tiene una revisión válida.');
    await this.enqueue({ owner, kind: 'event-restore', status: 'pending', eventId: id, revision });
  }

  async enqueueOperationRestore(owner: string, id: string, revision: string): Promise<void> {
    if (!id || !revision) throw new Error('La operación no tiene una revisión válida.');
    await this.enqueue({ owner, kind: 'operation-restore', status: 'pending', operationId: id, revision });
  }

  async enqueuePortalRestore(owner: string, id: string, revision: string): Promise<void> {
    if (!id || !revision) throw new Error('El portal no tiene una revisión válida.');
    await this.enqueue({ owner, kind: 'portal-restore', status: 'pending', portalId: id, revision });
  }

  async enqueueEpisodeDelete(owner: string, id: string, revision: string): Promise<void> {
    if (!id || !revision) throw new Error('El episodio no tiene una revisión válida.');
    await this.enqueue({ owner, kind: 'episode-delete', status: 'pending', episodeId: id, revision });
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

  /** Replaces a reviewed conflict atomically, keeping the local payload and attachment. */
  async retryConflict(owner: string, id: number, revision: string): Promise<void> {
    if (!owner || !revision) throw new Error('No se pudo verificar la revisión actual.');
    const tx = (await dbPromise).transaction('entries', 'readwrite');
    const entry = await tx.store.get(id);
    if (!entry || entry.owner !== owner || entry.status !== 'conflict') {
      await tx.done;
      throw new Error('El cambio ya no está disponible para resolver.');
    }
    const { id: _oldId, lastError: _oldError, ...replacement } = entry;
    replacement.status = 'pending';
    if (entry.kind === 'save' && replacement.draft?.driveFileId) replacement.draft.revision = revision;
    else if (entry.kind === 'delete' && entry.studyId) replacement.revision = revision;
    else if (entry.kind === 'restore' && entry.studyId) replacement.revision = revision;
    else if (entry.kind === 'operation-save' && replacement.operationDraft?.id) replacement.operationDraft.revision = revision;
    else if (entry.kind === 'operation-delete' && entry.operationId) replacement.revision = revision;
    else if (entry.kind === 'operation-restore' && entry.operationId) replacement.revision = revision;
    else if (entry.kind === 'portal-save' && replacement.portalDraft?.id) replacement.portalDraft.revision = revision;
    else if (entry.kind === 'portal-delete' && replacement.portal?.id) replacement.portal.revision = revision;
    else if (entry.kind === 'portal-restore' && entry.portalId) replacement.revision = revision;
    else if (entry.kind === 'event-save' && replacement.eventDraft?.id) replacement.eventDraft.revision = revision;
    else if (entry.kind === 'event-delete' && entry.eventId) replacement.revision = revision;
    else if (entry.kind === 'event-restore' && entry.eventId) replacement.revision = revision;
    else if (entry.kind === 'episode-save' && replacement.episodeDraft?.id) replacement.episodeDraft.revision = revision;
    else if (entry.kind === 'episode-delete' && entry.episodeId) replacement.revision = revision;
    else if (entry.kind === 'episode-restore' && entry.episodeId) replacement.revision = revision;
    else if (entry.kind === 'appointment-save' && replacement.appointmentDraft?.id) replacement.appointmentDraft.revision = revision;
    else if (entry.kind === 'appointment-delete' && entry.appointmentId) replacement.revision = revision;
    else if (entry.kind === 'appointment-restore' && entry.appointmentId) replacement.revision = revision;
    else { await tx.done; throw new Error('Este conflicto requiere revisión manual.'); }
    await tx.store.add(replacement);
    await tx.store.delete(id);
    await tx.done;
  }

  async sync(owner: string, remote: OutboxAdapter): Promise<void> {
    await remote.lock(`mis-estudios-outbox:${owner}`, async () => {
      if (await remote.accountId() !== owner) return;
      const db = await dbPromise;
      for (const entry of await this.list(owner)) {
        if (entry.id === undefined || entry.status !== 'pending') break;
        try {
          if (await remote.accountId() !== owner) return;
          let valid = true;
          switch (entry.kind) {
            case 'save': {
              if (!entry.draft) {
                valid = false;
                break;
              }
              if (!entry.draft.driveFileId && !entry.draft.id) {
                entry.draft.id = await remote.reserveId();
                await db.put('entries', entry);
              }
              const file = entry.attachment ? new File([entry.attachment], entry.attachmentName ?? 'Informe.pdf', { type: entry.attachmentType || entry.attachment.type || 'application/pdf' }) : undefined;
              await remote.save({ ...entry.draft, file });
              break;
            }
            case 'delete': {
              if (!entry.studyId || !entry.revision) {
                valid = false;
                break;
              }
              await remote.delete(entry.studyId, entry.revision);
              break;
            }
            case 'restore': {
              if (!entry.studyId || !entry.revision) {
                valid = false;
                break;
              }
              await remote.restore(entry.studyId, entry.revision);
              break;
            }
            case 'operation-save': {
              if (!entry.operationDraft) {
                valid = false;
                break;
              }
              if (!entry.operationDraft.id && !entry.operationDraft.createId) { entry.operationDraft.createId = await remote.reserveId(); await db.put('entries', entry); }
              await remote.saveOperation(entry.operationDraft);
              break;
            }
            case 'operation-delete': {
              if (!entry.operationId || !entry.revision) {
                valid = false;
                break;
              }
              await remote.deleteOperation(entry.operationId, entry.revision);
              break;
            }
            case 'portal-save': {
              if (!entry.portalDraft) {
                valid = false;
                break;
              }
              if (!entry.portalDraft.id && !entry.portalDraft.createId) { entry.portalDraft.createId = await remote.reserveId(); await db.put('entries', entry); }
              await remote.savePortal(entry.portalDraft);
              break;
            }
            case 'portal-delete': {
              if (!entry.portal) {
                valid = false;
                break;
              }
              await remote.deletePortal(entry.portal);
              break;
            }
            case 'event-save': {
              if (!entry.eventDraft) {
                valid = false;
                break;
              }
              if (!entry.eventDraft.id && !entry.eventDraft.createId) { entry.eventDraft.createId = await remote.reserveId(); await db.put('entries', entry); }
              await remote.saveEvent(entry.eventDraft);
              break;
            }
            case 'episode-save': {
              if (!entry.episodeDraft) {
                valid = false;
                break;
              }
              if (!entry.episodeDraft.id && !entry.episodeDraft.createId) { entry.episodeDraft.createId = await remote.reserveId(); await db.put('entries', entry); }
              await remote.saveEpisode(entry.episodeDraft);
              break;
            }
            case 'appointment-save': {
              if (!entry.appointmentDraft) {
                valid = false;
                break;
              }
              if (!entry.appointmentDraft.id && !entry.appointmentDraft.createId) { entry.appointmentDraft.createId = await remote.reserveId(); await db.put('entries', entry); }
              await remote.saveAppointment(entry.appointmentDraft);
              break;
            }
            case 'episode-delete': {
              if (!entry.episodeId || !entry.revision) {
                valid = false;
                break;
              }
              await remote.deleteEpisode(entry.episodeId, entry.revision);
              break;
            }
            case 'event-delete': {
              if (!entry.eventId || !entry.revision) {
                valid = false;
                break;
              }
              await remote.deleteEvent(entry.eventId, entry.revision);
              break;
            }
            case 'appointment-delete': {
              if (!entry.appointmentId || !entry.revision) {
                valid = false;
                break;
              }
              await remote.deleteAppointment(entry.appointmentId, entry.revision);
              break;
            }
            case 'episode-restore': {
              if (!entry.episodeId || !entry.revision) {
                valid = false;
                break;
              }
              await remote.restoreEpisode(entry.episodeId, entry.revision);
              break;
            }
            case 'appointment-restore': {
              if (!entry.appointmentId || !entry.revision) {
                valid = false;
                break;
              }
              await remote.restoreAppointment(entry.appointmentId, entry.revision);
              break;
            }
            case 'event-restore': {
              if (!entry.eventId || !entry.revision) {
                valid = false;
                break;
              }
              await remote.restoreEvent(entry.eventId, entry.revision);
              break;
            }
            case 'operation-restore': {
              if (!entry.operationId || !entry.revision) {
                valid = false;
                break;
              }
              await remote.restoreOperation(entry.operationId, entry.revision);
              break;
            }
            case 'portal-restore': {
              if (!entry.portalId || !entry.revision) {
                valid = false;
                break;
              }
              await remote.restorePortal(entry.portalId, entry.revision);
              break;
            }
            default:
              valid = false;
          }
          if (!valid) {
            entry.lastError = 'Cambio pendiente inválido.';
            entry.status = 'failed';
            await db.put('entries', entry);
            break;
          }
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
