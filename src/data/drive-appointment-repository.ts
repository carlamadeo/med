import { isRecoverable } from './recovery-window';
import { DriveConflictError, type DriveClient, type DriveFileResponse } from './drive-api';
import { storage } from '@core/storage';
import { validateAppointment } from '@domain/appointments';
import type { Appointment, AppointmentDraft } from '@domain/models';

export class DriveAppointmentRepository {
  constructor(private client: DriveClient) {}

  private parse(file: DriveFileResponse): Appointment {
    const ID_PATTERN = /^[\w-]+$/;
    if (!ID_PATTERN.test(file.id) || file.trashed || file.appProperties?.misEstudios !== 'turno-v1') throw new Error('Turno no disponible.');
    const item = this.client.parseDescription<AppointmentDraft>(file, 'Drive tiene un turno cuya ficha no se puede leer.');
    if (validateAppointment(item).length || !['scheduled', 'completed', 'cancelled', 'absent'].includes(item.status) || ![null, 'all', 'partial', 'none'].includes(item.coverage)) throw new Error('Drive tiene un turno cuya ficha no se puede leer.');
    return { ...item, id: file.id, revision: file.version };
  }

  async list(): Promise<Appointment[]> {
    const token = await this.client.getAccessToken();
    const owner = await this.client.cacheOwner();
    if (!navigator.onLine) {
      const cached = await storage.readSessionDirectory<Appointment>(owner, 'appointmentsCache');
      if (cached) {
        await this.client.assertSession(token);
        return cached;
      }
    }
    const items = (await this.client.listFiles('turno-v1', ENTRY_FIELDS, token)).map((file) => this.parse(file));
    await this.client.assertSession(token);
    await storage.writeSessionDirectory(owner, 'appointmentsCache', items);
    await this.client.assertSession(token);
    return items;
  }

  async save(draft: AppointmentDraft): Promise<Appointment> {
    const errors = validateAppointment(draft);
    if (errors.length) throw new Error(errors[0]);
    const token = await this.client.getAccessToken();
    const owner = await this.client.cacheOwner();
    const { date, time, timeZone, professional, notes, status, cost, coverage, reminderMinutes } = draft;
    const fields = { date, time, timeZone, professional, notes, status, cost, coverage, ...(reminderMinutes ? { reminderMinutes } : {}) };
    const description = JSON.stringify(fields);
    let file: DriveFileResponse;
    if (draft.id) {
      const existing = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(draft.id)}`, { fields: ENTRY_FIELDS }), {}, token).then(r => r.json() as Promise<DriveFileResponse>);
      if (!draft.revision || this.parse(existing).revision !== draft.revision) throw new DriveConflictError('turno');
      await this.client.assertSession(token);
      file = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(draft.id)}`, { fields: ENTRY_FIELDS }), this.client.jsonBody('PATCH', { description }), token).then(r => r.json() as Promise<DriveFileResponse>);
    } else {
      const id = draft.createId ?? await this.client.reserveId();
      const folder = await this.client.getFolderId();
      await this.client.assertSession(token);
      try {
        file = await this.client.upload('files', 'POST', { id, name: `${draft.date} Turno`, description, mimeType: 'application/json', parents: [folder], appProperties: { misEstudios: 'turno-v1' } }, new Blob([description], { type: 'application/json' }), 'application/json', undefined, token);
      } catch (error) {
        if (this.client.shouldRethrowCreateError(draft.createId, error)) throw error;
        file = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS }), {}, token).then(r => r.json() as Promise<DriveFileResponse>);
        if (file.description !== description) throw new DriveConflictError('turno');
      }
    }
    const saved = this.parse(file);
    await this.client.assertSession(token);
    await storage.updateSessionDirectory<Appointment>(owner, 'appointmentsCache', (cached) => cached ? [...cached.filter(item => item.id !== saved.id), saved] : null);
    return saved;
  }

  async delete(id: string, revision: string): Promise<void> {
    const token = await this.client.getAccessToken();
    const owner = await this.client.cacheOwner();
    if (await this.client.isAlreadyTrashed(id, 'turno-v1')) {
      await this.client.assertSession(token);
      await storage.updateSessionDirectory<Appointment>(owner, 'appointmentsCache', (cached) => cached ? cached.filter(item => item.id !== id) : null);
      return;
    }
    if (!revision || (await this.get(id)).revision !== revision) throw new DriveConflictError('turno');
    await this.client.assertSession(token);
    await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: 'id' }), this.client.jsonBody('PATCH', { trashed: true, appProperties: { misEstudios: 'turno-v1', deletedAt: new Date().toISOString() } }), token);
    await this.client.assertSession(token);
    await storage.updateSessionDirectory<Appointment>(owner, 'appointmentsCache', (cached) => cached ? cached.filter(item => item.id !== id) : null);
  }

  async get(id: string): Promise<Appointment> {
    const file = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS })).then(r => r.json() as Promise<DriveFileResponse>);
    return this.parse(file);
  }

  async listDeleted(): Promise<Array<{ id: string; title: string; date: string; deletedAt: string; revision: string; recoverable: boolean }>> {
    const token = await this.client.getAccessToken();
    const owner = await this.client.cacheOwner();
    const result: Array<{ id: string; title: string; date: string; deletedAt: string; revision: string; recoverable: boolean }> = [];
    if (!navigator.onLine) {
      const cached = await storage.readSessionDirectory<typeof result[number]>(owner, 'deletedAppointmentsCache');
      if (!cached) throw new Error('Conectate para consultar los turnos eliminados antes de recuperarlos sin conexión.');
      return cached.map(item => {
        return { ...item, recoverable: isRecoverable(item.deletedAt) };
      });
    }
    let pageToken = '';
    do {
      const response = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', 'files', {
        q: `trashed = true and appProperties has { key='misEstudios' and value='turno-v1' }`,
        fields: `nextPageToken,files(${ENTRY_FIELDS})`, pageSize: '100',
        ...(pageToken ? { pageToken } : {}),
      }), {}, token).then(r => r.json() as Promise<DriveFileResponse>);
      for (const file of response.files ?? []) {
        if (!file.trashed || file.appProperties?.misEstudios !== 'turno-v1') continue;
        const appointment = this.parse({ ...file, trashed: false });
        const deletedAt = file.appProperties.deletedAt ?? '';
        result.push({ id: appointment.id, title: `Turno: ${appointment.professional || 'Sin profesional'}`, date: appointment.date, revision: appointment.revision, deletedAt, recoverable: isRecoverable(deletedAt) });
      }
      pageToken = response.nextPageToken ?? '';
    } while (pageToken);
    await this.client.assertSession(token);
    await storage.writeSessionDirectory(owner, 'deletedAppointmentsCache', result);
    return result;
  }

  async restore(id: string, revision: string): Promise<Appointment> {
    const ID_PATTERN = /^[\w-]+$/;
    if (!ID_PATTERN.test(id) || !revision) throw new Error('El turno no tiene una revisión válida.');
    const token = await this.client.getAccessToken();
    const owner = await this.client.cacheOwner();
    const file = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS }), {}, token).then(r => r.json() as Promise<DriveFileResponse>);
    if (file.appProperties?.misEstudios !== 'turno-v1') throw new DriveConflictError('turno');
    if (!file.trashed && file.appProperties.restoredRevision === revision) {
      await this.client.assertSession(token);
      return this.parse(file);
    }
    if (!file.trashed || file.version !== revision) throw new DriveConflictError('turno');
    if (!isRecoverable(file.appProperties.deletedAt ?? '')) throw new Error('Este turno ya no está disponible para recuperación desde la aplicación.');
    await this.client.assertSession(token);
    const restored = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS }), this.client.jsonBody('PATCH', { trashed: false, appProperties: { ...file.appProperties, deletedAt: undefined, restoredRevision: revision } }), token).then(r => r.json() as Promise<DriveFileResponse>);
    await this.client.assertSession(token);
    const appointment = this.parse(restored);
    await storage.updateSessionDirectory<Appointment>(owner, 'appointmentsCache', (cached) => [...(cached ?? []).filter(item => item.id !== id), appointment]);
    await storage.updateSessionDirectory<{ id: string }>(owner, 'deletedAppointmentsCache', (cached) => cached ? cached.filter(item => item.id !== id) : null);
    return appointment;
  }
}

const ENTRY_FIELDS = 'id,description,version,modifiedTime,mimeType,trashed,appProperties';