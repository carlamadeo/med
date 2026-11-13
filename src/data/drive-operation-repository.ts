import { isRecoverable } from './recovery-window';
import { DriveStudyRepository } from './drive-study-repository';
import { DriveConflictError, type DriveClient, type DriveFileResponse } from './drive-api';
import { storage } from '@core/storage';
import { isValidDate } from '@domain/utils';
import type { Operation, OperationDraft } from '@domain/repository';

export class DriveOperationRepository {
  constructor(private client: DriveClient) {}

  private parse(file: DriveFileResponse): Operation & { revision: string } {
    const ID_PATTERN = /^[\w-]+$/;
    if (!ID_PATTERN.test(file.id) || file.trashed || file.appProperties?.misEstudios !== 'operacion-v1') throw new Error('Operación no disponible.');
    const value = this.client.parseDescription<OperationDraft>(file, 'Drive tiene una operación cuya ficha no se puede leer.');
    if (typeof value.name !== 'string' || !value.name.trim()) throw new Error('Drive tiene una operación cuya ficha no se puede leer.');
    return { id: file.id, name: value.name, date: value.date ?? '', surgeon: value.surgeon ?? '', institution: value.institution ?? '', type: value.type ?? '', notes: value.notes ?? '', color: value.color ?? '', studyIds: [], revision: file.version };
  }

  async list(): Promise<Operation[]> {
    const token = await this.client.getAccessToken();
    const owner = await this.client.cacheOwner();
    if (!navigator.onLine) {
      const cached = await storage.readSessionDirectory<Operation>(owner, 'operationsCache');
      if (cached) {
        await this.client.assertSession(token);
        return cached;
      }
    }
    const result = (await this.client.listFiles('operacion-v1', ENTRY_FIELDS, token)).map((file) => this.parse(file));
    await this.client.assertSession(token);
    await storage.writeSessionDirectory(owner, 'operationsCache', result);
    await this.client.assertSession(token);
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
      response = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(draft.id)}`, { fields: ENTRY_FIELDS }), this.client.jsonBody('PATCH', { name, description }), token).then((r) => r.json() as Promise<DriveFileResponse>);
    } else {
      const id = draft.createId ?? await this.client.reserveId();
      const folder = await this.client.getFolderId();
      await this.client.assertSession(token);
      try {
        response = await this.client.upload('files', 'POST', { id, name, description, mimeType: 'application/json', parents: [folder], appProperties: { misEstudios: 'operacion-v1' } }, new Blob([description], { type: 'application/json' }), 'application/json', undefined, token);
      } catch (err) {
        if (this.client.shouldRethrowCreateError(draft.createId, err)) throw err;
        response = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS }), {}, token).then((r) => r.json() as Promise<DriveFileResponse>);
        if (response.description !== description) throw new DriveConflictError('operación');
      }
    }
    const saved = this.parse(response);
    await this.client.assertSession(token);
    await storage.updateSessionDirectory<Operation>(owner, 'operationsCache', (cached) => cached ? [...cached.filter((item) => item.id !== saved.id), saved] : null);
    return saved;
  }

  async delete(id: string, revision: string): Promise<void> {
    const token = await this.client.getAccessToken();
    const owner = await this.client.cacheOwner();
    if (await this.client.isAlreadyTrashed(id, 'operacion-v1')) {
      await this.client.assertSession(token);
      await storage.updateSessionDirectory<Operation>(owner, 'operationsCache', (cached) => cached ? cached.filter((item) => item.id !== id) : null);
      return;
    }
    if (!revision || (await this.get(id)).revision !== revision) throw new DriveConflictError('operación');
    const studies = await new DriveStudyRepository(this.client).list({ force: true });
    if (studies.some((study) => study.operationId === id)) throw new Error('Desvinculá los estudios antes de eliminar esta operación.');
    await this.client.assertSession(token);
    await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: 'id' }), this.client.jsonBody('PATCH', { trashed: true, appProperties: { misEstudios: 'operacion-v1', deletedAt: new Date().toISOString() } }), token);
    await this.client.assertSession(token);
    await storage.updateSessionDirectory<Operation>(owner, 'operationsCache', (cached) => cached ? cached.filter((item) => item.id !== id) : null);
  }

  async listDeleted(): Promise<Array<{ id: string; title: string; date: string; deletedAt: string; revision: string; recoverable: boolean }>> {
    const token = await this.client.getAccessToken();
    const owner = await this.client.cacheOwner();
    const result: Array<{ id: string; title: string; date: string; deletedAt: string; revision: string; recoverable: boolean }> = [];
    if (!navigator.onLine) {
      const cached = await storage.readSessionDirectory<typeof result[number]>(owner, 'deletedOperationsCache');
      if (!cached) throw new Error('Conectate para consultar las operaciones eliminadas antes de recuperarlas sin conexión.');
      return cached.map(item => {
        return { ...item, recoverable: isRecoverable(item.deletedAt) };
      });
    }
    let pageToken = '';
    do {
      const response = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', 'files', {
        q: `trashed = true and appProperties has { key='misEstudios' and value='operacion-v1' }`,
        fields: `nextPageToken,files(${ENTRY_FIELDS})`, pageSize: '100',
        ...(pageToken ? { pageToken } : {}),
      }), {}, token).then(r => r.json() as Promise<DriveFileResponse>);
      for (const file of response.files ?? []) {
        if (!file.trashed || file.appProperties?.misEstudios !== 'operacion-v1') continue;
        const operation = this.parse({ ...file, trashed: false });
        const deletedAt = file.appProperties.deletedAt ?? '';
        result.push({ id: operation.id, title: operation.name, date: operation.date ?? '', revision: operation.revision, deletedAt, recoverable: isRecoverable(deletedAt) });
      }
      pageToken = response.nextPageToken ?? '';
    } while (pageToken);
    await this.client.assertSession(token);
    await storage.writeSessionDirectory(owner, 'deletedOperationsCache', result);
    return result;
  }

  async restore(id: string, revision: string): Promise<Operation> {
    const ID_PATTERN = /^[\w-]+$/;
    if (!ID_PATTERN.test(id) || !revision) throw new Error('La operación no tiene una revisión válida.');
    const token = await this.client.getAccessToken();
    const owner = await this.client.cacheOwner();
    const file = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS }), {}, token).then(r => r.json() as Promise<DriveFileResponse>);
    if (file.appProperties?.misEstudios !== 'operacion-v1') throw new DriveConflictError('operación');
    if (!file.trashed && file.appProperties.restoredRevision === revision) {
      await this.client.assertSession(token);
      return this.parse(file);
    }
    if (!file.trashed || file.version !== revision) throw new DriveConflictError('operación');
    if (!isRecoverable(file.appProperties.deletedAt ?? '')) throw new Error('Esta operación ya no está disponible para recuperación desde la aplicación.');
    await this.client.assertSession(token);
    const restored = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS }), this.client.jsonBody('PATCH', { trashed: false, appProperties: { ...file.appProperties, deletedAt: undefined, restoredRevision: revision } }), token).then(r => r.json() as Promise<DriveFileResponse>);
    await this.client.assertSession(token);
    const operation = this.parse(restored);
    await storage.updateSessionDirectory<Operation>(owner, 'operationsCache', (cached) => [...(cached ?? []).filter(item => item.id !== id), operation]);
    await storage.updateSessionDirectory<{ id: string }>(owner, 'deletedOperationsCache', (cached) => cached ? cached.filter(item => item.id !== id) : null);
    return operation;
  }
}

const ENTRY_FIELDS = 'id,description,version,modifiedTime,mimeType,trashed,appProperties';