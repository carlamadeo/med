import {storage} from '@core/storage';
import {cleanDoctorAddresses, cleanDoctorName} from '@domain/doctors';
import {cleanSpecialty} from '@domain/library';
import type {Doctor, DoctorDraft} from '@domain/repository';
import {DriveConflictError, type DriveClient, type DriveFileResponse} from './drive-api';
import {isRecoverable, restoreDriveRecord} from './recovery-window';

const ID_PATTERN = /^[\w-]+$/;
const MARKER = 'medico-v1';
const ENTRY_FIELDS = 'id,description,version,modifiedTime,mimeType,trashed,appProperties';

export class DriveDoctorRepository {
    constructor(private client: DriveClient) {}

    private parse(file: DriveFileResponse): Doctor & { id: string; revision: string } {
        if (!ID_PATTERN.test(file.id) || file.trashed || file.appProperties?.misEstudios !== MARKER) {
            throw new Error('Médico no disponible.');
        }
        const item = this.client.parseDescription<DoctorDraft>(
            file,
            'Drive tiene un médico cuya ficha no se puede leer.',
        );
        const name = cleanDoctorName(item.name);
        if (!name) throw new Error('Drive tiene un médico cuya ficha no se puede leer.');
        const {addresses, defaultAddress} = cleanDoctorAddresses(item.addresses, item.defaultAddress);
        return {
            id: file.id,
            name,
            specialty: cleanSpecialty(item.specialty),
            addresses,
            defaultAddress,
            revision: file.version,
        };
    }

    async list(): Promise<Doctor[]> {
        const token = await this.client.getAccessToken();
        const owner = await this.client.cacheOwner();
        if (!navigator.onLine) {
            const cached = await storage.readSessionDirectory<Doctor>(owner, 'doctorsCache');
            if (cached) {
                await this.client.assertSession(token);
                return cached;
            }
        }
        const items = (await this.client.listFiles(MARKER, ENTRY_FIELDS, token)).map((file) => this.parse(file));
        await this.client.assertSession(token);
        await storage.writeSessionDirectory(owner, 'doctorsCache', items);
        await this.client.assertSession(token);
        return items;
    }

    private async get(id: string, token: string): Promise<Doctor> {
        return this.parse(
            await this.client
                .request(
                    this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, {
                        fields: ENTRY_FIELDS,
                    }),
                    {},
                    token,
                )
                .then((r) => r.json() as Promise<DriveFileResponse>),
        );
    }

    async save(draft: DoctorDraft): Promise<Doctor> {
        const token = await this.client.getAccessToken();
        const owner = await this.client.cacheOwner();
        const name = cleanDoctorName(draft.name);
        if (!name) throw new Error('Ingresá un nombre para el médico.');
        const specialty = cleanSpecialty(draft.specialty);
        const {addresses, defaultAddress} = cleanDoctorAddresses(draft.addresses, draft.defaultAddress);
        const payload = {
            name,
            ...(specialty ? {specialty} : {}),
            addresses,
            ...(defaultAddress ? {defaultAddress} : {}),
        };
        const description = JSON.stringify(payload);
        let file: DriveFileResponse;
        if (draft.id) {
            if (!ID_PATTERN.test(draft.id)) throw new Error('Médico no disponible.');
            const existing = await this.get(draft.id, token);
            if (!draft.revision || existing.revision !== draft.revision) throw new DriveConflictError('médico');
            await this.client.assertSession(token);
            file = await this.client
                .request(
                    this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(draft.id)}`, {
                        fields: ENTRY_FIELDS,
                    }),
                    this.client.jsonBody('PATCH', {name, description}),
                    token,
                )
                .then((r) => r.json() as Promise<DriveFileResponse>);
        } else {
            const id = draft.createId ?? (await this.client.reserveId(token));
            const folder = await this.client.getFolderId(token);
            await this.client.assertSession(token);
            try {
                file = await this.client.upload(
                    'files',
                    'POST',
                    {
                        id,
                        name,
                        description,
                        mimeType: 'application/json',
                        parents: [folder],
                        appProperties: {misEstudios: MARKER},
                    },
                    new Blob([description], {type: 'application/json'}),
                    'application/json',
                    undefined,
                    token,
                );
            } catch (err) {
                if (this.client.shouldRethrowCreateError(draft.createId, err)) throw err;
                file = await this.client
                    .request(
                        this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, {
                            fields: ENTRY_FIELDS,
                        }),
                        {},
                        token,
                    )
                    .then((r) => r.json() as Promise<DriveFileResponse>);
                if (file.description !== description) throw new DriveConflictError('médico');
            }
        }
        const saved = this.parse(file);
        await this.client.assertSession(token);
        await storage.updateSessionDirectory<Doctor>(owner, 'doctorsCache', (cached) =>
            cached ? [...cached.filter((item) => item.id !== saved.id), saved] : null,
        );
        return saved;
    }

    async delete(id: string, revision: string): Promise<void> {
        const token = await this.client.getAccessToken();
        const owner = await this.client.cacheOwner();
        if (!ID_PATTERN.test(id)) throw new Error('Médico no disponible.');
        if (await this.client.isAlreadyTrashed(id, MARKER, token)) {
            await this.client.assertSession(token);
            await storage.updateSessionDirectory<Doctor>(owner, 'doctorsCache', (cached) =>
                cached ? cached.filter((item) => item.id !== id) : null,
            );
            return;
        }
        const existing = await this.get(id, token);
        if (!revision || existing.revision !== revision) throw new DriveConflictError('médico');
        await this.client.assertSession(token);
        await this.client.request(
            this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, {
                fields: 'id',
            }),
            this.client.jsonBody('PATCH', {
                trashed: true,
                appProperties: {misEstudios: MARKER, deletedAt: new Date().toISOString()},
            }),
            token,
        );
        await this.client.assertSession(token);
        await storage.updateSessionDirectory<Doctor>(owner, 'doctorsCache', (cached) =>
            cached ? cached.filter((item) => item.id !== id) : null,
        );
    }

    async listDeleted(): Promise<
        Array<{
            id: string;
            title: string;
            date: string;
            deletedAt: string;
            revision: string;
            recoverable: boolean;
        }>
    > {
        const token = await this.client.getAccessToken();
        const owner = await this.client.cacheOwner();
        const result: Array<{
            id: string;
            title: string;
            date: string;
            deletedAt: string;
            revision: string;
            recoverable: boolean;
        }> = [];
        if (!navigator.onLine) {
            const cached = await storage.readSessionDirectory<(typeof result)[number]>(owner, 'deletedDoctorsCache');
            if (!cached) {
                throw new Error('Conectate para consultar los médicos eliminados antes de recuperarlos sin conexión.');
            }
            return cached.map((item) => ({...item, recoverable: isRecoverable(item.deletedAt)}));
        }
        let pageToken = '';
        do {
            const response = await this.client
                .request(
                    this.client.url('https://www.googleapis.com/drive/v3/', 'files', {
                        q: `trashed = true and appProperties has { key='misEstudios' and value='${MARKER}' }`,
                        fields: `nextPageToken,files(${ENTRY_FIELDS})`,
                        pageSize: '100',
                        ...(pageToken ? {pageToken} : {}),
                    }),
                    {},
                    token,
                )
                .then((r) => r.json() as Promise<DriveFileResponse>);
            for (const file of response.files ?? []) {
                if (!file.trashed || file.appProperties?.misEstudios !== MARKER) continue;
                const doctor = this.parse({...file, trashed: false});
                const deletedAt = file.appProperties.deletedAt ?? '';
                result.push({
                    id: doctor.id,
                    title: doctor.name,
                    date: '',
                    revision: doctor.revision,
                    deletedAt,
                    recoverable: isRecoverable(deletedAt),
                });
            }
            pageToken = response.nextPageToken ?? '';
        } while (pageToken);
        await this.client.assertSession(token);
        await storage.writeSessionDirectory(owner, 'deletedDoctorsCache', result);
        return result;
    }

    async restore(id: string, revision: string): Promise<Doctor> {
        return restoreDriveRecord({
            client: this.client,
            id,
            revision,
            marker: MARKER,
            fields: ENTRY_FIELDS,
            invalidRevisionMessage: 'El médico no tiene una revisión válida.',
            expiredMessage: 'Este médico ya no está disponible para recuperación desde la aplicación.',
            conflictTarget: 'médico',
            activeCacheKey: 'doctorsCache',
            deletedCacheKey: 'deletedDoctorsCache',
            parse: (file) => this.parse(file),
        });
    }
}
