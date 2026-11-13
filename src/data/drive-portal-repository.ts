import { DriveConflictError, type DriveClient, type DriveFileResponse } from './drive-api';
import { storage } from '@core/storage';
import { viewerURL } from '@domain/utils';
import type { Portal, PortalDraft } from '@domain/repository';

export class DrivePortalRepository {
  constructor(private client: DriveClient) {}

  private parse(file: DriveFileResponse): Portal {
    const ID_PATTERN = /^[\w-]+$/;
    if (!ID_PATTERN.test(file.id) || file.trashed || file.appProperties?.misEstudios !== 'portal-v1') throw new Error('Portal no disponible.');
    const item = this.client.parseDescription<PortalDraft>(file, 'Drive tiene un portal cuya ficha no se puede leer.');
    if (typeof item.displayName !== 'string' || !item.displayName.trim() || typeof item.name !== 'string') throw new Error('Drive tiene un portal cuya ficha no se puede leer.');
    return { id: file.id, name: item.name, displayName: item.displayName, url: viewerURL(item.url ?? ''), notes: item.notes ?? '', revision: file.version };
  }

  async list(): Promise<Portal[]> {
    const owner = await this.client.cacheOwner();
    if (!navigator.onLine) {
      const cached = await storage.readSessionDirectory<Portal>(owner, 'portalsCache');
      if (cached) return cached;
    }
    const items: Portal[] = [];
    let pageToken = '';
    do {
      const response = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', 'files', {
        q: this.client.query('portal-v1'), spaces: 'drive', pageSize: '100', fields: `nextPageToken,files(${ENTRY_FIELDS})`, ...(pageToken ? { pageToken } : {}),
      })).then((r) => r.json() as Promise<DriveFileResponse>);
      items.push(...(response.files ?? []).map((file) => this.parse(file)));
      pageToken = response.nextPageToken ?? '';
    } while (pageToken);
    await storage.writeSessionDirectory(owner, 'portalsCache', items);
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
      file = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(draft.id)}`, { fields: ENTRY_FIELDS }), this.client.jsonBody('PATCH', { name: displayName, description })).then((r) => r.json() as Promise<DriveFileResponse>);
    } else {
      const id = draft.createId ?? await this.client.reserveId();
      const folder = await this.client.getFolderId();
      await this.client.assertSession(token);
      try {
        file = await this.client.upload('files', 'POST', { id, name: displayName, description, mimeType: 'application/json', parents: [folder], appProperties: { misEstudios: 'portal-v1' } }, new Blob([description], { type: 'application/json' }), 'application/json');
      } catch (err) {
        if (this.client.shouldRethrowCreateError(draft.createId, err)) throw err;
        file = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS })).then((r) => r.json() as Promise<DriveFileResponse>);
        if (file.description !== description) throw new DriveConflictError('portal');
      }
    }
    const saved = this.parse(file);
    await this.client.assertSession(token);
    const cached = await storage.readSessionDirectory<Portal>(owner, 'portalsCache');
    if (cached) await storage.writeSessionDirectory(owner, 'portalsCache', [...cached.filter((item) => item.id !== saved.id), saved]);
    return saved;
  }

  async delete(portal: Portal): Promise<void> {
    const token = await this.client.getAccessToken();
    const owner = await this.client.cacheOwner();
    if (!portal.id) throw new Error('Portal no disponible.');
    if (await this.client.isAlreadyTrashed(portal.id, 'portal-v1')) {
      await this.client.assertSession(token);
      const cached = await storage.readSessionDirectory<Portal>(owner, 'portalsCache');
      if (cached) await storage.writeSessionDirectory(owner, 'portalsCache', cached.filter((item) => item.id !== portal.id));
      return;
    }
    const existing = await this.get(portal.id);
    if (!portal.revision || existing.revision !== portal.revision) throw new DriveConflictError('portal');
    await this.client.assertSession(token);
    await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(portal.id)}`, { fields: 'id' }), this.client.jsonBody('PATCH', { trashed: true }));
    await this.client.assertSession(token);
    const cached = await storage.readSessionDirectory<Portal>(owner, 'portalsCache');
    if (cached) await storage.writeSessionDirectory(owner, 'portalsCache', cached.filter((item) => item.id !== portal.id));
  }
}

const ENTRY_FIELDS = 'id,description,version,modifiedTime,mimeType,trashed,appProperties';