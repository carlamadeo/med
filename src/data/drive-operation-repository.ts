import { DriveConflictError, type DriveClient, type DriveFileResponse } from './drive-api';
import { storage } from '@core/storage';
import { isValidDate } from '@domain/utils';
import type { Operation, OperationDraft } from '@domain/repository';

export class DriveOperationRepository {
  constructor(private client: DriveClient) {}

  private parse(file: DriveFileResponse): Operation {
    const ID_PATTERN = /^[\w-]+$/;
    if (!ID_PATTERN.test(file.id) || file.trashed || file.appProperties?.misEstudios !== 'operacion-v1') throw new Error('Operación no disponible.');
    const value = this.client.parseDescription<OperationDraft>(file, 'Drive tiene una operación cuya ficha no se puede leer.');
    if (typeof value.name !== 'string' || !value.name.trim()) throw new Error('Drive tiene una operación cuya ficha no se puede leer.');
    return { id: file.id, name: value.name, date: value.date ?? '', surgeon: value.surgeon ?? '', institution: value.institution ?? '', type: value.type ?? '', notes: value.notes ?? '', color: value.color ?? '', studyIds: [], revision: file.version };
  }

  async list(): Promise<Operation[]> {
    const owner = await this.client.cacheOwner();
    if (!navigator.onLine) {
      const cached = await storage.readSessionDirectory<Operation>(owner, 'operationsCache');
      if (cached) return cached;
    }
    const result: Operation[] = [];
    let pageToken = '';
    do {
      const response = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', 'files', {
        q: this.client.query('operacion-v1'), spaces: 'drive', pageSize: '100', fields: `nextPageToken,files(${ENTRY_FIELDS})`, ...(pageToken ? { pageToken } : {}),
      })).then((r) => r.json() as Promise<DriveFileResponse>);
      result.push(...(response.files ?? []).map((file) => this.parse(file)));
      pageToken = response.nextPageToken ?? '';
    } while (pageToken);
    await storage.writeSessionDirectory(owner, 'operationsCache', result);
    return result;
  }

  async get(id: string): Promise<Operation> {
    const file = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS })).then((r) => r.json() as Promise<DriveFileResponse>);
    return this.parse(file);
  }

  async save(draft: OperationDraft): Promise<Operation> {
    const token = await this.client.getAccessToken();
    const owner = await this.client.cacheOwner();
    const name = draft.name.trim();
    if (!name) throw new Error('Ingresá un nombre para la operación.');
    if (draft.date && !isValidDate(draft.date)) throw new Error('Ingresá una fecha válida.');
    const payload = { name, date: draft.date ?? '', surgeon: draft.surgeon ?? '', institution: draft.institution ?? '', type: draft.type ?? '', notes: draft.notes ?? '', color: draft.color ?? '' };
    const description = JSON.stringify(payload);
    let response: DriveFileResponse;
    if (draft.id) {
      const existing = await this.get(draft.id);
      if (!draft.revision || existing.revision !== draft.revision) throw new DriveConflictError('operación');
      await this.client.assertSession(token);
      response = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(draft.id)}`, { fields: ENTRY_FIELDS }), this.client.jsonBody('PATCH', { name, description })).then((r) => r.json() as Promise<DriveFileResponse>);
    } else {
      const id = draft.createId ?? await this.client.reserveId();
      const folder = await this.client.getFolderId();
      await this.client.assertSession(token);
      try {
        response = await this.client.upload('files', 'POST', { id, name, description, mimeType: 'application/json', parents: [folder], appProperties: { misEstudios: 'operacion-v1' } }, new Blob([description], { type: 'application/json' }), 'application/json');
      } catch (err) {
        if (this.client.shouldRethrowCreateError(draft.createId, err)) throw err;
        response = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS })).then((r) => r.json() as Promise<DriveFileResponse>);
        if (response.description !== description) throw new DriveConflictError('operación');
      }
    }
    const saved = this.parse(response);
    await this.client.assertSession(token);
    const cached = await storage.readSessionDirectory<Operation>(owner, 'operationsCache');
    if (cached) await storage.writeSessionDirectory(owner, 'operationsCache', [...cached.filter((item) => item.id !== saved.id), saved]);
    return saved;
  }

  async delete(id: string, revision: string): Promise<void> {
    const token = await this.client.getAccessToken();
    const owner = await this.client.cacheOwner();
    if (await this.client.isAlreadyTrashed(id, 'operacion-v1')) {
      await this.client.assertSession(token);
      const cached = await storage.readSessionDirectory<Operation>(owner, 'operationsCache');
      if (cached) await storage.writeSessionDirectory(owner, 'operationsCache', cached.filter((item) => item.id !== id));
      return;
    }
    if (!revision || (await this.get(id)).revision !== revision) throw new DriveConflictError('operación');
    const { DriveStudyRepository } = await import('./drive-study-repository');
    const studies = await new DriveStudyRepository(this.client).list({ force: true });
    if (studies.some((study) => study.operationId === id)) throw new Error('Desvinculá los estudios antes de eliminar esta operación.');
    await this.client.assertSession(token);
    await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: 'id' }), this.client.jsonBody('PATCH', { trashed: true }));
    await this.client.assertSession(token);
    const cached = await storage.readSessionDirectory<Operation>(owner, 'operationsCache');
    if (cached) await storage.writeSessionDirectory(owner, 'operationsCache', cached.filter((item) => item.id !== id));
  }
}

const ENTRY_FIELDS = 'id,description,version,modifiedTime,mimeType,trashed,appProperties';