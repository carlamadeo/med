import { isRecoverable } from './recovery-window';
import { DriveConflictError, type DriveClient, type DriveFileResponse } from './drive-api';
import { storage } from '@core/storage';
import { viewerURL } from '@domain/utils';
import type { Portal, PortalDraft } from '@domain/repository';

export class DrivePortalRepository {
  constructor(private client: DriveClient) {}

  private parse(file: DriveFileResponse): Portal & { id: string; revision: string } {
    const ID_PATTERN = /^[\w-]+$/;
    if (!ID_PATTERN.test(file.id) || file.trashed || file.appProperties?.misEstudios !== 'portal-v1') throw new Error('Portal no disponible.');
    const item = this.client.parseDescription<PortalDraft>(file, 'Drive tiene un portal cuya ficha no se puede leer.');
    if (typeof item.displayName !== 'string' || !item.displayName.trim() || typeof item.name !== 'string') throw new Error('Drive tiene un portal cuya ficha no se puede leer.');
    return { id: file.id, name: item.name, displayName: item.displayName, url: viewerURL(item.url ?? ''), notes: item.notes ?? '', revision: file.version };
  }

  async list(): Promise<Portal[]> {
    const token = await this.client.getAccessToken();
    const owner = await this.client.cacheOwner();
    if (!navigator.onLine) {
      const cached = await storage.readSessionDirectory<Portal>(owner, 'portalsCache');
      if (cached) {
        await this.client.assertSession(token);
        return cached;
      }
    }
    const items = (await this.client.listFiles('portal-v1', ENTRY_FIELDS, token)).map((file) => this.parse(file));
    await this.client.assertSession(token);
    await storage.writeSessionDirectory(owner, 'portalsCache', items);
    await this.client.assertSession(token);
    return items;
  }

  private async get(id: string): Promise<Portal> {
    return this.parse(await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS })).then((r) => r.json() as Promise<DriveFileResponse>));
  }

  async save(draft: PortalDraft): Promise<Portal> {
    const token = await this.client.getAccessToken();
    const owner = await this.client.cacheOwner();
    const displayName = draft.displayName.trim();
    if (!displayName) throw new Error('Ingresá un nombre para el portal.');
    const payload = { name: draft.name.trim() || displayName, displayName, url: viewerURL(draft.url.trim()), notes: draft.notes?.trim() ?? '' };
    const description = JSON.stringify(payload);
    let file: DriveFileResponse;
    if (draft.id) {
      const existing = await this.get(draft.id);
      if (!draft.revision || existing.revision !== draft.revision) throw new DriveConflictError('portal');
      await this.client.assertSession(token);
      file = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(draft.id)}`, { fields: ENTRY_FIELDS }), this.client.jsonBody('PATCH', { name: displayName, description }), token).then((r) => r.json() as Promise<DriveFileResponse>);
    } else {
      const id = draft.createId ?? await this.client.reserveId();
      const folder = await this.client.getFolderId();
      await this.client.assertSession(token);
      try {
        file = await this.client.upload('files', 'POST', { id, name: displayName, description, mimeType: 'application/json', parents: [folder], appProperties: { misEstudios: 'portal-v1' } }, new Blob([description], { type: 'application/json' }), 'application/json', undefined, token);
      } catch (err) {
        if (this.client.shouldRethrowCreateError(draft.createId, err)) throw err;
        file = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS }), {}, token).then((r) => r.json() as Promise<DriveFileResponse>);
        if (file.description !== description) throw new DriveConflictError('portal');
      }
    }
    const saved = this.parse(file);
    await this.client.assertSession(token);
    await storage.updateSessionDirectory<Portal>(owner, 'portalsCache', (cached) => cached ? [...cached.filter((item) => item.id !== saved.id), saved] : null);
    return saved;
  }

  async delete(portal: Portal): Promise<void> {
    const token = await this.client.getAccessToken();
    const owner = await this.client.cacheOwner();
    if (!portal.id) throw new Error('Portal no disponible.');
    if (await this.client.isAlreadyTrashed(portal.id, 'portal-v1')) {
      await this.client.assertSession(token);
      await storage.updateSessionDirectory<Portal>(owner, 'portalsCache', (cached) => cached ? cached.filter((item) => item.id !== portal.id) : null);
      return;
    }
    const existing = await this.get(portal.id);
    if (!portal.revision || existing.revision !== portal.revision) throw new DriveConflictError('portal');
    await this.client.assertSession(token);
    await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(portal.id)}`, { fields: 'id' }), this.client.jsonBody('PATCH', { trashed: true, appProperties: { misEstudios: 'portal-v1', deletedAt: new Date().toISOString() } }), token);
    await this.client.assertSession(token);
    await storage.updateSessionDirectory<Portal>(owner, 'portalsCache', (cached) => cached ? cached.filter((item) => item.id !== portal.id) : null);
  }

  async listDeleted(): Promise<Array<{ id: string; title: string; date: string; deletedAt: string; revision: string; recoverable: boolean }>> {
    const token = await this.client.getAccessToken();
    const owner = await this.client.cacheOwner();
    const result: Array<{ id: string; title: string; date: string; deletedAt: string; revision: string; recoverable: boolean }> = [];
    if (!navigator.onLine) {
      const cached = await storage.readSessionDirectory<typeof result[number]>(owner, 'deletedPortalsCache');
      if (!cached) throw new Error('Conectate para consultar los portales eliminados antes de recuperarlos sin conexión.');
      return cached.map(item => {
        return { ...item, recoverable: isRecoverable(item.deletedAt) };
      });
    }
    let pageToken = '';
    do {
      const response = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', 'files', {
        q: `trashed = true and appProperties has { key='misEstudios' and value='portal-v1' }`,
        fields: `nextPageToken,files(${ENTRY_FIELDS})`, pageSize: '100',
        ...(pageToken ? { pageToken } : {}),
      }), {}, token).then(r => r.json() as Promise<DriveFileResponse>);
      for (const file of response.files ?? []) {
        if (!file.trashed || file.appProperties?.misEstudios !== 'portal-v1') continue;
        const portal = this.parse({ ...file, trashed: false });
        const deletedAt = file.appProperties.deletedAt ?? '';
        result.push({ id: portal.id, title: portal.displayName, date: '', revision: portal.revision, deletedAt, recoverable: isRecoverable(deletedAt) });
      }
      pageToken = response.nextPageToken ?? '';
    } while (pageToken);
    await this.client.assertSession(token);
    await storage.writeSessionDirectory(owner, 'deletedPortalsCache', result);
    return result;
  }

  async restore(id: string, revision: string): Promise<Portal> {
    const ID_PATTERN = /^[\w-]+$/;
    if (!ID_PATTERN.test(id) || !revision) throw new Error('El portal no tiene una revisión válida.');
    const token = await this.client.getAccessToken();
    const owner = await this.client.cacheOwner();
    const file = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS }), {}, token).then(r => r.json() as Promise<DriveFileResponse>);
    if (file.appProperties?.misEstudios !== 'portal-v1') throw new DriveConflictError('portal');
    if (!file.trashed && file.appProperties.restoredRevision === revision) {
      await this.client.assertSession(token);
      return this.parse(file);
    }
    if (!file.trashed || file.version !== revision) throw new DriveConflictError('portal');
    if (!isRecoverable(file.appProperties.deletedAt ?? '')) throw new Error('Este portal ya no está disponible para recuperación desde la aplicación.');
    await this.client.assertSession(token);
    const restored = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS }), this.client.jsonBody('PATCH', { trashed: false, appProperties: { ...file.appProperties, deletedAt: undefined, restoredRevision: revision } }), token).then(r => r.json() as Promise<DriveFileResponse>);
    await this.client.assertSession(token);
    const portal = this.parse(restored);
    await storage.updateSessionDirectory<Portal>(owner, 'portalsCache', (cached) => [...(cached ?? []).filter(item => item.id !== id), portal]);
    await storage.updateSessionDirectory<{ id: string }>(owner, 'deletedPortalsCache', (cached) => cached ? cached.filter(item => item.id !== id) : null);
    return portal;
  }
}

const ENTRY_FIELDS = 'id,description,version,modifiedTime,mimeType,trashed,appProperties';