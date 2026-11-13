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
      if (cached) return cached;
    }
    const items: Appointment[] = [];
    let pageToken = '';
    do {
      const response = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', 'files', {
        q: this.client.query('turno-v1'), spaces: 'drive', pageSize: '100', fields: `nextPageToken,files(${ENTRY_FIELDS})`, ...(pageToken ? { pageToken } : {}),
      })).then(r => r.json() as Promise<DriveFileResponse>);
      items.push(...(response.files ?? []).map(file => this.parse(file)));
      pageToken = response.nextPageToken ?? '';
    } while (pageToken);
    await this.client.assertSession(token);
    await storage.writeSessionDirectory(owner, 'appointmentsCache', items);
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
      const existing = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(draft.id)}`, { fields: ENTRY_FIELDS })).then(r => r.json() as Promise<DriveFileResponse>);
      if (!draft.revision || this.parse(existing).revision !== draft.revision) throw new DriveConflictError('turno');
      await this.client.assertSession(token);
      file = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(draft.id)}`, { fields: ENTRY_FIELDS }), this.client.jsonBody('PATCH', { description })).then(r => r.json() as Promise<DriveFileResponse>);
    } else {
      const id = draft.createId ?? await this.client.reserveId();
      const folder = await this.client.getFolderId();
      await this.client.assertSession(token);
      try {
        file = await this.client.upload('files', 'POST', { id, name: `${draft.date} Turno`, description, mimeType: 'application/json', parents: [folder], appProperties: { misEstudios: 'turno-v1' } }, new Blob([description], { type: 'application/json' }), 'application/json');
      } catch (error) {
        if (this.client.shouldRethrowCreateError(draft.createId, error)) throw error;
        file = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS })).then(r => r.json() as Promise<DriveFileResponse>);
        if (file.description !== description) throw new DriveConflictError('turno');
      }
    }
    const saved = this.parse(file);
    await this.client.assertSession(token);
    const cached = await storage.readSessionDirectory<Appointment>(owner, 'appointmentsCache');
    if (cached) await storage.writeSessionDirectory(owner, 'appointmentsCache', [...cached.filter(item => item.id !== saved.id), saved]);
    return saved;
  }
}

const ENTRY_FIELDS = 'id,description,version,modifiedTime,mimeType,trashed,appProperties';