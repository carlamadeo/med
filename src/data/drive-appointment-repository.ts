import {isRecoverable, restoreDriveRecord} from './recovery-window';
import {DriveConflictError, type DriveClient, type DriveFileResponse} from './drive-api';
import {storage} from '@core/storage';
import {cleanLocation, validateAppointment} from '@domain/appointments';
import {cleanSpecialty} from '@domain/library';
import type {Appointment, AppointmentDraft} from '@domain/models';
import {validateDocument} from './pdf-analysis';

type AppointmentDescription = Omit<AppointmentDraft, 'prescriptionFile' | 'removePrescription'> & {prescriptionName?: string};

export class DriveAppointmentRepository {
    constructor(private client: DriveClient, private cacheWrites = true) {
    }

    private parse(file: DriveFileResponse): Appointment {
        const ID_PATTERN = /^[\w-]+$/;
        if (!ID_PATTERN.test(file.id) || file.trashed || file.appProperties?.misEstudios !== 'turno-v1') throw new Error('Turno no disponible.');
        const item = this.client.parseDescription<AppointmentDescription>(file, 'Drive tiene un turno cuya ficha no se puede leer.');
        if (validateAppointment(item).length || !['scheduled', 'completed', 'cancelled', 'absent'].includes(item.status) || ![null, 'all', 'partial', 'none'].includes(item.coverage)) throw new Error('Drive tiene un turno cuya ficha no se puede leer.');
        const {prescriptionName, location: rawLocation, reason: rawReason, ...fields} = item;
        const location = cleanLocation(rawLocation);
        const reason = typeof rawReason === 'string' ? rawReason.trim() : '';
        const {mimeType} = file;
        const prescription: Appointment['prescription'] = typeof prescriptionName === 'string' && prescriptionName &&
            (mimeType === 'application/pdf' || mimeType === 'image/jpeg' || mimeType === 'image/png')
            ? {name: prescriptionName, mimeType} : undefined;
        return {
            ...fields,
            ...(location ? {location} : {}),
            ...(reason ? {reason} : {}),
            id: file.id,
            revision: file.version,
            ...(prescription ? {prescription} : {}),
        };
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

    async save(draft: AppointmentDraft, expectedToken?: string): Promise<Appointment> {
        const errors = validateAppointment(draft);
        if (errors.length) throw new Error(errors[0]);
        const token = expectedToken ?? await this.client.getAccessToken();
        await this.client.assertSession(token);
        const owner = this.cacheWrites ? await this.client.cacheOwner() : undefined;
        const {date, time, timeZone, professional, notes, status, cost, coverage, reminderMinutes, studyIds,
            prescriptionFile, removePrescription} = draft;
        const specialty = cleanSpecialty(draft.specialty);
        const location = cleanLocation(draft.location);
        const reason = draft.reason?.trim();
        const newMime = prescriptionFile ? await validateDocument(prescriptionFile) : undefined;
        const id = draft.id ?? draft.createId ?? await this.client.reserveId(token);
        const metadataUrl = this.fileUrl(id);
        const existing = draft.id
            ? this.parse(await this.client.request(metadataUrl, {}, token).then(r => r.json() as Promise<DriveFileResponse>))
            : null;
        if (existing && (!draft.revision || existing.revision !== draft.revision)) throw new DriveConflictError('turno');

        const previousName = removePrescription ? undefined : existing?.prescription?.name;
        const prescriptionName = prescriptionFile ? prescriptionFile.name || 'Receta' : previousName;
        const calendarReminders = draft.calendarReminders ?? existing?.calendarReminders;
        const description = JSON.stringify({
            date, time, timeZone, professional, notes, status, cost, coverage,
            ...(specialty ? {specialty} : {}),
            ...(location ? {location} : {}),
            ...(reason ? {reason} : {}),
            ...(reminderMinutes ? {reminderMinutes} : {}),
            ...(calendarReminders === 'standard' ? {calendarReminders} : {}),
            ...(studyIds?.length ? {studyIds: [...new Set(studyIds)]} : {}),
            ...(prescriptionName ? {prescriptionName} : {}),
        });
        let file: DriveFileResponse;
        if (existing && !prescriptionFile && !(removePrescription && existing.prescription)) {
            file = await this.client.request(metadataUrl, this.client.jsonBody('PATCH', {description}), token)
                .then(r => r.json() as Promise<DriveFileResponse>);
        } else {
            const mimeType = newMime ?? 'application/json';
            const media = prescriptionFile ?? new Blob([description], {type: mimeType});
            const metadata: Record<string, unknown> = {
                name: `${date} Turno`, description, mimeType,
            };
            if (!existing) {
                metadata.id = id;
                metadata.parents = [await this.client.getFolderId(token)];
                metadata.appProperties = {misEstudios: 'turno-v1'};
            }
            const path = existing ? `files/${encodeURIComponent(id)}` : 'files';
            try {
                file = await this.client.upload(path, existing ? 'PATCH' : 'POST', metadata, media, mimeType, undefined, token);
            } catch (error) {
                if (existing || this.client.shouldRethrowCreateError(draft.createId, error)) throw error;
                file = await this.client.request(metadataUrl, {}, token).then(r => r.json() as Promise<DriveFileResponse>);
                if (file.description !== description || file.mimeType !== mimeType) throw new DriveConflictError('turno');
                if (prescriptionFile) {
                    const stored = await this.getPrescription(this.parse(file), token);
                    const hash = async (blob: Blob) => new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
                    const [localHash, storedHash] = await Promise.all([hash(prescriptionFile), hash(stored)]);
                    if (localHash.some((byte, index) => byte !== storedHash[index])) throw new DriveConflictError('turno');
                }
            }
        }
        const saved = this.parse(file);
        await this.client.assertSession(token);
        if (owner !== undefined) {
            await storage.updateSessionDirectory<Appointment>(owner, 'appointmentsCache', (cached) => cached ? [...cached.filter(item => item.id !== saved.id), saved] : null);
        }
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
        await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, {fields: 'id'}), this.client.jsonBody('PATCH', {
            trashed: true,
            appProperties: {misEstudios: 'turno-v1', deletedAt: new Date().toISOString()}
        }), token);
        await this.client.assertSession(token);
        await storage.updateSessionDirectory<Appointment>(owner, 'appointmentsCache', (cached) => cached ? cached.filter(item => item.id !== id) : null);
    }

    private fileUrl(id: string, params: Record<string, string> = {fields: ENTRY_FIELDS}): string {
        return this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, params);
    }

    async get(id: string, expectedToken?: string): Promise<Appointment> {
        const file = await this.client.request(this.fileUrl(id), {}, expectedToken).then(r => r.json() as Promise<DriveFileResponse>);
        return this.parse(file);
    }

    async getPrescription(appointment: Appointment, expectedToken?: string): Promise<File> {
        const {id, revision, prescription} = appointment;
        if (!prescription) throw new Error('Este turno no tiene una receta adjunta.');
        const token = expectedToken ?? await this.client.getAccessToken();
        const confirmRevision = async () => {
            const current = await this.get(id, token);
            if (current.revision !== revision || current.prescription?.mimeType !== prescription.mimeType ||
                current.prescription.name !== prescription.name) throw new DriveConflictError('turno');
        };
        await confirmRevision();
        const response = await this.client.request(this.fileUrl(id, {alt: 'media'}), {}, token);
        const blob = await response.blob();
        const mimeType = await validateDocument(blob.slice(0, 8));
        if (mimeType !== prescription.mimeType) throw new Error('El archivo de Drive no coincide con el formato de la receta.');
        await confirmRevision();
        await this.client.assertSession(token);
        return new File([blob], prescription.name, {type: mimeType});
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
            const cached = await storage.readSessionDirectory<typeof result[number]>(owner, 'deletedAppointmentsCache');
            if (!cached) throw new Error('Conectate para consultar los turnos eliminados antes de recuperarlos sin conexión.');
            return cached.map(item => {
                return {...item, recoverable: isRecoverable(item.deletedAt)};
            });
        }
        let pageToken = '';
        do {
            const response = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', 'files', {
                q: `trashed = true and appProperties has { key='misEstudios' and value='turno-v1' }`,
                fields: `nextPageToken,files(${ENTRY_FIELDS})`, pageSize: '100',
                ...(pageToken ? {pageToken} : {}),
            }), {}, token).then(r => r.json() as Promise<DriveFileResponse>);
            for (const file of response.files ?? []) {
                if (!file.trashed || file.appProperties?.misEstudios !== 'turno-v1') continue;
                const appointment = this.parse({...file, trashed: false});
                const deletedAt = file.appProperties.deletedAt ?? '';
                result.push({
                    id: appointment.id,
                    title: `Turno: ${appointment.professional || 'Sin profesional'}`,
                    date: appointment.date,
                    revision: appointment.revision,
                    deletedAt,
                    recoverable: isRecoverable(deletedAt)
                });
            }
            pageToken = response.nextPageToken ?? '';
        } while (pageToken);
        await this.client.assertSession(token);
        await storage.writeSessionDirectory(owner, 'deletedAppointmentsCache', result);
        return result;
    }

    async restore(id: string, revision: string): Promise<Appointment> {
        return restoreDriveRecord({
            client: this.client,
            id,
            revision,
            marker: 'turno-v1',
            fields: ENTRY_FIELDS,
            invalidRevisionMessage: 'El turno no tiene una revisión válida.',
            expiredMessage: 'Este turno ya no está disponible para recuperación desde la aplicación.',
            conflictTarget: 'turno',
            activeCacheKey: 'appointmentsCache',
            deletedCacheKey: 'deletedAppointmentsCache',
            parse: (file) => this.parse(file),
        });
    }
}

const ENTRY_FIELDS = 'id,description,version,modifiedTime,mimeType,trashed,appProperties';
