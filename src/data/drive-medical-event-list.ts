import {type DriveClient, type DriveFileResponse} from './drive-api';
import {storage} from '@core/storage';
import {isValidDate} from '@domain/utils';
import type {MedicalEvent, MedicalEventDraft} from '@domain/models';

const ENTRY_FIELDS = 'id,description,version,modifiedTime,mimeType,trashed,appProperties';

export function parseEvent(client: DriveClient, file: DriveFileResponse): MedicalEvent {
    const ID_PATTERN = /^[\w-]+$/;
    if (!ID_PATTERN.test(file.id) || file.trashed || file.appProperties?.misEstudios !== 'evento-medico-v1') throw new Error('Evento no disponible.');
    const item = client.parseDescription<MedicalEventDraft>(file, 'Drive tiene un evento cuya ficha no se puede leer.');
    const studyIds = (item.studyIds ?? []) as string[];
    const documentIds = (item.documentIds ?? []) as string[];
    if (!['consultation', 'prescription'].includes(item.kind) || !isValidDate(item.date) ||
        !Array.isArray(studyIds) || !Array.isArray(documentIds) ||
        [...studyIds, ...documentIds].some((id) => typeof id !== 'string' || !ID_PATTERN.test(id))) {
        throw new Error('Drive tiene un evento cuya ficha no se puede leer.');
    }
    return {
        id: file.id, kind: item.kind, date: item.date, doctor: item.doctor ?? '', notes: item.notes ?? '',
        studyIds: [...new Set(studyIds)], documentIds: [...new Set(documentIds)], revision: file.version
    };
}


export async function listMedicalEvents(client: DriveClient): Promise<MedicalEvent[]> {
    const token = await client.getAccessToken();
    const owner = await client.cacheOwner();
    if (!navigator.onLine) {
        const cached = await storage.readSessionDirectory<MedicalEvent>(owner, 'eventsCache');
        if (cached) {
            await client.assertSession(token);
            return cached;
        }
    }
    const items = (await client.listFiles('evento-medico-v1', ENTRY_FIELDS, token)).map((file) => parseEvent(client, file));
    await client.assertSession(token);
    await storage.writeSessionDirectory(owner, 'eventsCache', items);
    await client.assertSession(token);
    return items;
}
