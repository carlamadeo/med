import {isRecoverable} from './recovery-window';
import {DriveConflictError, type DriveClient, type DriveFileResponse} from './drive-api';
import {storage} from '@core/storage';
import type {Episode, EpisodeDraft} from '@domain/models';

export class DriveEpisodeRepository {
    constructor(public client: DriveClient) {
    }

    private parse(file: DriveFileResponse): Episode {
        const ID_PATTERN = /^[\w-]+$/;
        if (!ID_PATTERN.test(file.id) || file.trashed || file.appProperties?.misEstudios !== 'episodio-v1') throw new Error('Episodio no disponible.');
        const item = this.client.parseDescription<EpisodeDraft>(file, 'Drive tiene un episodio cuya ficha no se puede leer.');
        if (typeof item.illness !== 'string') throw new Error('Drive tiene un episodio cuya ficha no se puede leer.');
        if (!Array.isArray(item.observations)) item.observations = [];
        if (!Array.isArray(item.medications)) item.medications = [];
        return {
            id: file.id,
            illness: item.illness,
            observations: item.observations,
            medications: item.medications,
            closed: item.closed === true,
            revision: file.version
        };
    }

    async list(): Promise<Episode[]> {
        const token = await this.client.getAccessToken();
        const owner = await this.client.cacheOwner();
        if (!navigator.onLine) {
            const cached = await storage.readSessionDirectory<Episode>(owner, 'episodesCache');
            if (cached) {
                await this.client.assertSession(token);
                return cached;
            }
        }
        const items = (await this.client.listFiles('episodio-v1', ENTRY_FIELDS, token)).map((file) => this.parse(file));
        await this.client.assertSession(token);
        await storage.writeSessionDirectory(owner, 'episodesCache', items);
        await this.client.assertSession(token);
        return items;
    }

    async get(id: string): Promise<Episode> {
        const file = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, {fields: ENTRY_FIELDS})).then((r) => r.json() as Promise<DriveFileResponse>);
        return this.parse(file);
    }

    async reserveId(): Promise<string> {
        return this.client.reserveId();
    }

    async save(draft: EpisodeDraft): Promise<Episode> {
        const illness = draft.illness.trim();
        const token = await this.client.getAccessToken();
        const owner = await this.client.cacheOwner();
        const description = JSON.stringify({
            illness,
            observations: draft.observations ?? [],
            medications: draft.medications ?? [], ...(draft.closed ? {closed: true} : {})
        });
        let file: DriveFileResponse;
        if (draft.id) {
            const existing = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(draft.id)}`, {fields: ENTRY_FIELDS}), {}, token).then((r) => r.json() as Promise<DriveFileResponse>);
            if (!draft.revision || this.parse(existing).revision !== draft.revision) throw new DriveConflictError('episodio');
            await this.client.assertSession(token);
            file = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(draft.id)}`, {fields: ENTRY_FIELDS}), this.client.jsonBody('PATCH', {description}), token).then((r) => r.json() as Promise<DriveFileResponse>);
        } else {
            const id = draft.createId ?? await this.client.reserveId();
            const folder = await this.client.getFolderId();
            await this.client.assertSession(token);
            try {
                file = await this.client.upload('files', 'POST', {
                    id,
                    name: illness || 'Episodio de salud',
                    description,
                    mimeType: 'application/json',
                    parents: [folder],
                    appProperties: {misEstudios: 'episodio-v1'}
                }, new Blob([description], {type: 'application/json'}), 'application/json', undefined, token);
            } catch (err) {
                if (this.client.shouldRethrowCreateError(draft.createId, err)) throw err;
                file = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, {fields: ENTRY_FIELDS}), {}, token).then((r) => r.json() as Promise<DriveFileResponse>);
                if (file.description !== description) throw new DriveConflictError('episodio');
            }
        }
        const saved = this.parse(file);
        await this.client.assertSession(token);
        await storage.updateSessionDirectory<Episode>(owner, 'episodesCache', (cached) => cached ? [...cached.filter((item) => item.id !== saved.id), saved] : null);
        return saved;
    }

    async delete(id: string, revision: string): Promise<void> {
        const token = await this.client.getAccessToken();
        const owner = await this.client.cacheOwner();
        if (await this.client.isAlreadyTrashed(id, 'episodio-v1')) {
            await this.client.assertSession(token);
            await storage.updateSessionDirectory<Episode>(owner, 'episodesCache', (cached) => cached ? cached.filter((item) => item.id !== id) : null);
            return;
        }
        if (!revision || (await this.get(id)).revision !== revision) throw new DriveConflictError('episodio');
        await this.client.assertSession(token);
        await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, {fields: 'id'}), this.client.jsonBody('PATCH', {
            trashed: true,
            appProperties: {misEstudios: 'episodio-v1', deletedAt: new Date().toISOString()}
        }), token);
        await this.client.assertSession(token);
        await storage.updateSessionDirectory<Episode>(owner, 'episodesCache', (cached) => cached ? cached.filter((item) => item.id !== id) : null);
    }

    async listDeleted(): Promise<Array<{
        id: string;
        title: string;
        date: string;
        deletedAt: string;
        revision: string;
        recoverable: boolean
    }>> {
        const token = await this.client.getAccessToken();
        const owner = await this.client.cacheOwner();
        const result: Array<{
            id: string;
            title: string;
            date: string;
            deletedAt: string;
            revision: string;
            recoverable: boolean
        }> = [];
        if (!navigator.onLine) {
            const cached = await storage.readSessionDirectory<typeof result[number]>(owner, 'deletedEpisodesCache');
            if (!cached) throw new Error('Conectate para consultar los episodios eliminados antes de recuperarlos sin conexión.');
            return cached.map(item => {
                return {...item, recoverable: isRecoverable(item.deletedAt)};
            });
        }
        let pageToken = '';
        do {
            const response = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', 'files', {
                q: `trashed = true and appProperties has { key='misEstudios' and value='episodio-v1' }`,
                fields: `nextPageToken,files(${ENTRY_FIELDS})`, pageSize: '100',
                ...(pageToken ? {pageToken} : {}),
            }), {}, token).then(r => r.json() as Promise<DriveFileResponse>);
            for (const file of response.files ?? []) {
                if (!file.trashed || file.appProperties?.misEstudios !== 'episodio-v1') continue;
                const episode = this.parse({...file, trashed: false});
                const deletedAt = file.appProperties.deletedAt ?? '';
                const lastObsDate = episode.observations.map(o => o.date).sort().at(-1) ?? '';
                result.push({
                    id: episode.id,
                    title: episode.illness || 'Episodio de salud',
                    date: lastObsDate,
                    revision: episode.revision,
                    deletedAt,
                    recoverable: isRecoverable(deletedAt)
                });
            }
            pageToken = response.nextPageToken ?? '';
        } while (pageToken);
        await this.client.assertSession(token);
        await storage.writeSessionDirectory(owner, 'deletedEpisodesCache', result);
        return result;
    }

    async restore(id: string, revision: string): Promise<Episode> {
        const ID_PATTERN = /^[\w-]+$/;
        if (!ID_PATTERN.test(id) || !revision) throw new Error('El episodio no tiene una revisión válida.');
        const token = await this.client.getAccessToken();
        const owner = await this.client.cacheOwner();
        const file = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, {fields: ENTRY_FIELDS}), {}, token).then(r => r.json() as Promise<DriveFileResponse>);
        if (file.appProperties?.misEstudios !== 'episodio-v1') throw new DriveConflictError('episodio');
        if (!file.trashed && file.appProperties.restoredRevision === revision) {
            await this.client.assertSession(token);
            return this.parse(file);
        }
        if (!file.trashed || file.version !== revision) throw new DriveConflictError('episodio');
        if (!isRecoverable(file.appProperties.deletedAt ?? '')) throw new Error('Este episodio ya no está disponible para recuperación desde la aplicación.');
        await this.client.assertSession(token);
        const restored = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, {fields: ENTRY_FIELDS}), this.client.jsonBody('PATCH', {
            trashed: false,
            appProperties: {...file.appProperties, deletedAt: undefined, restoredRevision: revision}
        }), token).then(r => r.json() as Promise<DriveFileResponse>);
        await this.client.assertSession(token);
        const episode = this.parse(restored);
        await storage.updateSessionDirectory<Episode>(owner, 'episodesCache', (cached) => [...(cached ?? []).filter(item => item.id !== id), episode]);
        await storage.updateSessionDirectory<{
            id: string
        }>(owner, 'deletedEpisodesCache', (cached) => cached ? cached.filter(item => item.id !== id) : null);
        return episode;
    }
}

const ENTRY_FIELDS = 'id,description,version,modifiedTime,mimeType,trashed,appProperties';
