import {isRecoverable} from './recovery-window';
import {DriveConflictError, type DriveClient, type DriveFileResponse} from './drive-api';
import {storage} from '@core/storage';
import {isValidDate} from '@domain/utils';
import {parseEvent, listMedicalEvents} from './drive-medical-event-list';
import {DriveStudyRepository} from './drive-study-repository';
import type {MedicalEvent, MedicalEventDraft} from '@domain/models';

export class DriveMedicalEventRepository {
    constructor(private client: DriveClient) {
    }

    private parse(file: DriveFileResponse): MedicalEvent {
        return parseEvent(this.client, file);
    }

    async list(): Promise<MedicalEvent[]> {
        return listMedicalEvents(this.client);
    }

    async save(draft: MedicalEventDraft): Promise<MedicalEvent> {
        if (!['consultation', 'prescription'].includes(draft.kind) || !isValidDate(draft.date)) throw new Error('Ingresá una fecha y un tipo de evento válidos.');
        const token = await this.client.getAccessToken();
        const owner = await this.client.cacheOwner();
        const available = await new DriveStudyRepository(this.client).list();
        const studyIds = [...new Set(draft.studyIds)];
        const documentIds = [...new Set(draft.documentIds)];
        if (studyIds.some((id) => !available.some((study) => study.id === id)) ||
            documentIds.some((id) => !available.some((study) => study.id === id && (study.hasPdf || study.attachmentMime)))) {
            throw new Error('Uno de los estudios o documentos ya no está disponible en esta cuenta.');
        }
        const description = JSON.stringify({
            kind: draft.kind,
            date: draft.date,
            doctor: draft.doctor,
            notes: draft.notes,
            studyIds,
            documentIds
        });
        let file: DriveFileResponse;
        if (draft.id) {
            const existing = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(draft.id)}`, {fields: ENTRY_FIELDS}), {}, token).then((r) => r.json() as Promise<DriveFileResponse>);
            if (!draft.revision || this.parse(existing).revision !== draft.revision) throw new DriveConflictError('evento');
            await this.client.assertSession(token);
            file = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(draft.id)}`, {fields: ENTRY_FIELDS}), this.client.jsonBody('PATCH', {description}), token).then((r) => r.json() as Promise<DriveFileResponse>);
        } else {
            const id = draft.createId ?? await this.client.reserveId();
            const folder = await this.client.getFolderId();
            await this.client.assertSession(token);
            try {
                file = await this.client.upload('files', 'POST', {
                    id,
                    name: `${draft.date} ${draft.kind}`,
                    description,
                    mimeType: 'application/json',
                    parents: [folder],
                    appProperties: {misEstudios: 'evento-medico-v1'}
                }, new Blob([description], {type: 'application/json'}), 'application/json', undefined, token);
            } catch (err) {
                if (this.client.shouldRethrowCreateError(draft.createId, err)) throw err;
                file = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, {fields: ENTRY_FIELDS}), {}, token).then((r) => r.json() as Promise<DriveFileResponse>);
                if (file.description !== description) throw new DriveConflictError('evento');
            }
        }
        const saved = this.parse(file);
        await this.client.assertSession(token);
        await storage.updateSessionDirectory<MedicalEvent>(owner, 'eventsCache', (cached) => cached ? [...cached.filter((item) => item.id !== saved.id), saved] : null);
        return saved;
    }

    async delete(id: string, revision: string): Promise<void> {
        const token = await this.client.getAccessToken();
        const owner = await this.client.cacheOwner();
        if (await this.client.isAlreadyTrashed(id, 'evento-medico-v1')) {
            await this.client.assertSession(token);
            await storage.updateSessionDirectory<MedicalEvent>(owner, 'eventsCache', (cached) => cached ? cached.filter((item) => item.id !== id) : null);
            return;
        }
        if (!revision || (await this.get(id)).revision !== revision) throw new DriveConflictError('evento');
        await this.client.assertSession(token);
        await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, {fields: 'id'}), this.client.jsonBody('PATCH', {
            trashed: true,
            appProperties: {misEstudios: 'evento-medico-v1', deletedAt: new Date().toISOString()}
        }), token);
        await this.client.assertSession(token);
        await storage.updateSessionDirectory<MedicalEvent>(owner, 'eventsCache', (cached) => cached ? cached.filter((item) => item.id !== id) : null);
    }

    async get(id: string): Promise<MedicalEvent> {
        const file = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, {fields: ENTRY_FIELDS})).then((r) => r.json() as Promise<DriveFileResponse>);
        return this.parse(file);
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
            const cached = await storage.readSessionDirectory<typeof result[number]>(owner, 'deletedEventsCache');
            if (!cached) throw new Error('Conectate para consultar los eventos eliminados antes de recuperarlos sin conexión.');
            return cached.map(item => {
                return {...item, recoverable: isRecoverable(item.deletedAt)};
            });
        }
        let pageToken = '';
        do {
            const response = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', 'files', {
                q: `trashed = true and appProperties has { key='misEstudios' and value='evento-medico-v1' }`,
                fields: `nextPageToken,files(${ENTRY_FIELDS})`, pageSize: '100',
                ...(pageToken ? {pageToken} : {}),
            }), {}, token).then(r => r.json() as Promise<DriveFileResponse>);
            for (const file of response.files ?? []) {
                if (!file.trashed || file.appProperties?.misEstudios !== 'evento-medico-v1') continue;
                const event = this.parse({...file, trashed: false});
                const deletedAt = file.appProperties.deletedAt ?? '';
                result.push({
                    id: event.id,
                    title: event.kind === 'consultation' ? 'Consulta' : 'Receta',
                    date: event.date,
                    revision: event.revision,
                    deletedAt,
                    recoverable: isRecoverable(deletedAt)
                });
            }
            pageToken = response.nextPageToken ?? '';
        } while (pageToken);
        await this.client.assertSession(token);
        await storage.writeSessionDirectory(owner, 'deletedEventsCache', result);
        return result;
    }

    async restore(id: string, revision: string): Promise<MedicalEvent> {
        const ID_PATTERN = /^[\w-]+$/;
        if (!ID_PATTERN.test(id) || !revision) throw new Error('El evento no tiene una revisión válida.');
        const token = await this.client.getAccessToken();
        const owner = await this.client.cacheOwner();
        const file = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, {fields: ENTRY_FIELDS}), {}, token).then(r => r.json() as Promise<DriveFileResponse>);
        if (file.appProperties?.misEstudios !== 'evento-medico-v1') throw new DriveConflictError('evento');
        if (!file.trashed && file.appProperties.restoredRevision === revision) {
            await this.client.assertSession(token);
            return this.parse(file);
        }
        if (!file.trashed || file.version !== revision) throw new DriveConflictError('evento');
        if (!isRecoverable(file.appProperties.deletedAt ?? '')) throw new Error('Este evento ya no está disponible para recuperación desde la aplicación.');
        await this.client.assertSession(token);
        const restored = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, {fields: ENTRY_FIELDS}), this.client.jsonBody('PATCH', {
            trashed: false,
            appProperties: {...file.appProperties, deletedAt: undefined, restoredRevision: revision}
        }), token).then(r => r.json() as Promise<DriveFileResponse>);
        await this.client.assertSession(token);
        const event = this.parse(restored);
        await storage.updateSessionDirectory<MedicalEvent>(owner, 'eventsCache', (cached) => [...(cached ?? []).filter(item => item.id !== id), event]);
        await storage.updateSessionDirectory<{
            id: string
        }>(owner, 'deletedEventsCache', (cached) => cached ? cached.filter(item => item.id !== id) : null);
        return event;
    }
}

const ENTRY_FIELDS = 'id,description,version,modifiedTime,mimeType,trashed,appProperties';