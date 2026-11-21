import {beforeEach, describe, expect, it, vi} from 'vitest';
import {DriveConflictError, driveAuth, driveDoctorRepo} from '@data';
import {
    buildDoctorDirectory,
    cleanDoctorAddresses,
    cleanDoctorName,
    doctorMatchesQuery,
    findDoctorByName,
    orderedDoctorAddresses,
} from '@domain/doctors';
import type {Doctor, Study} from '@domain/models';
import {touchRemote} from './fake-drive';
import {http, HttpResponse} from 'msw';
import {server} from './server';

function makeStudy(id: string, doctor: string): Study {
    return {
        id,
        title: `Estudio ${id}`,
        date: '2026-01-10',
        types: ['Otro'],
        doctor,
        portal: '',
        viewer: '',
        reportName: '',
        hasPdf: false,
        driveFileId: id,
        driveModifiedTime: '',
        revision: '1',
    };
}

function makeDoctor(overrides: Partial<Doctor> & { id: string; name: string }): Doctor {
    return {
        addresses: [],
        revision: '1',
        ...overrides,
    };
}

describe('domain/doctors', () => {
    it('cleans doctor names and deduplicates addresses with a resolved default', () => {
        expect(cleanDoctorName('  Dra.   Ana   Pérez  ')).toBe('Dra. Ana Pérez');
        expect(cleanDoctorName(null)).toBe('');

        expect(cleanDoctorAddresses('not-an-array')).toEqual({addresses: [], defaultAddress: undefined});
        expect(cleanDoctorAddresses(['  ', ''])).toEqual({addresses: [], defaultAddress: undefined});

        expect(
            cleanDoctorAddresses(
                ['  Av.  Santa Fe 1234 ', 'av. santa fe 1234', 'Av. Cabildo 500'],
                'av. cabildo 500',
            ),
        ).toEqual({
            addresses: ['Av. Santa Fe 1234', 'Av. Cabildo 500'],
            defaultAddress: 'Av. Cabildo 500',
        });

        expect(cleanDoctorAddresses(['Av. Santa Fe 1234', 'Av. Cabildo 500'], 'Desconocida')).toEqual({
            addresses: ['Av. Santa Fe 1234', 'Av. Cabildo 500'],
            defaultAddress: 'Av. Santa Fe 1234',
        });
    });

    it('orders addresses with the default address first', () => {
        expect(
            orderedDoctorAddresses({
                addresses: ['Consultorio Norte', 'Consultorio Centro', 'Consultorio Sur'],
                defaultAddress: 'consultorio centro',
            }),
        ).toEqual(['Consultorio Centro', 'Consultorio Norte', 'Consultorio Sur']);
    });

    it('builds directory ordered by study count descending, merging saved doctors', () => {
        const studies = [
            makeStudy('1', 'Dr. Zeta'),
            makeStudy('2', 'Dra. Gómez'),
            makeStudy('3', 'dra. gomez'),
            makeStudy('4', 'Dra. Gómez'),
            makeStudy('5', 'Dr. Zeta'),
            makeStudy('6', 'Dr. Álvarez'),
        ];
        const saved: Doctor[] = [
            makeDoctor({
                id: 'doc-1',
                name: 'Dr. Zeta',
                specialty: 'Cardiología',
                addresses: ['Sede Norte', 'Sede Central'],
                defaultAddress: 'Sede Central',
            }),
            makeDoctor({
                id: 'doc-2',
                name: 'Dra. Nueva',
                specialty: 'Dermatología',
                addresses: ['Av. Rivadavia 100'],
                defaultAddress: 'Av. Rivadavia 100',
            }),
        ];

        const directory = buildDoctorDirectory(studies, saved);

        expect(directory.map((entry) => [entry.name, entry.studyCount])).toEqual([
            ['Dra. Gómez', 3],
            ['Dr. Zeta', 2],
            ['Dr. Álvarez', 1],
            ['Dra. Nueva', 0],
        ]);
        expect(directory[1]?.addresses).toEqual(['Sede Central', 'Sede Norte']);
        expect(directory[1]?.defaultAddress).toBe('Sede Central');
        expect(directory[1]?.specialty).toBe('Cardiología');
        expect(directory[1]?.doctor?.id).toBe('doc-1');
        expect(directory[0]?.doctor).toBeUndefined();

        expect(findDoctorByName(directory, '  dr.   zeta ')?.doctor?.id).toBe('doc-1');
        expect(findDoctorByName(directory, '   ')).toBeUndefined();
        expect(doctorMatchesQuery(directory[1]!, 'cardiologia')).toBe(true);
        expect(doctorMatchesQuery(directory[1]!, 'sede central')).toBe(true);
        expect(doctorMatchesQuery(directory[1]!, 'inexistente')).toBe(false);
        expect(doctorMatchesQuery(directory[1]!, '')).toBe(true);
    });

    it('infers specialty from the most recent study when no saved doctor specialty exists, while preferring saved specialty', () => {
        const studies: Study[] = [
            {...makeStudy('1', 'Dra. Sofía Ruiz'), date: '2026-01-10', specialty: 'Clínica médica'},
            {...makeStudy('2', 'Dra. Sofía Ruiz'), date: '2026-03-15', specialty: 'Endocrinología'},
            {...makeStudy('3', 'Dr. Pablo Paz'), date: '2026-02-01', specialty: 'Clínica médica'},
        ];
        const saved: Doctor[] = [
            makeDoctor({
                id: 'doc-paz',
                name: 'Dr. Pablo Paz',
                specialty: 'Cardiología',
            }),
        ];

        const directory = buildDoctorDirectory(studies, saved);
        expect(findDoctorByName(directory, 'Dra. Sofía Ruiz')?.specialty).toBe('Endocrinología');
        expect(findDoctorByName(directory, 'Dr. Pablo Paz')?.specialty).toBe('Cardiología');
    });
});

describe('DriveDoctorRepository', () => {
    beforeEach(async () => {
        await driveAuth.signOut();
        await driveAuth.signIn();
    });

    it('saves, lists, updates, deletes and restores a doctor in Drive', async () => {
        const created = await driveDoctorRepo.save({
            name: '  Dra. Ana   Pérez  ',
            specialty: '  Cardiología ',
            addresses: ['Av. Santa Fe 100', 'Av. Cabildo 200'],
            defaultAddress: 'Av. Cabildo 200',
        });
        expect(created).toMatchObject({
            name: 'Dra. Ana Pérez',
            specialty: 'Cardiología',
            addresses: ['Av. Santa Fe 100', 'Av. Cabildo 200'],
            defaultAddress: 'Av. Cabildo 200',
        });
        expect((await driveDoctorRepo.list()).find((d) => d.id === created.id)).toEqual(created);

        const updated = await driveDoctorRepo.save({
            ...created,
            specialty: 'Clínica médica',
            defaultAddress: 'Av. Santa Fe 100',
        });
        expect(updated.specialty).toBe('Clínica médica');
        expect(updated.defaultAddress).toBe('Av. Santa Fe 100');

        await driveDoctorRepo.delete(updated.id, updated.revision!);
        expect((await driveDoctorRepo.list()).some((d) => d.id === updated.id)).toBe(false);
        // Deleting again when already trashed resolves idempotently
        await expect(driveDoctorRepo.delete(updated.id, updated.revision!)).resolves.toBeUndefined();

        const deleted = (await driveDoctorRepo.listDeleted()).find((item) => item.id === updated.id)!;
        expect(deleted.recoverable).toBe(true);

        const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        expect((await driveDoctorRepo.listDeleted()).find((item) => item.id === updated.id)?.recoverable).toBe(true);
        online.mockRestore();

        await expect(driveDoctorRepo.restore(updated.id, 'stale')).rejects.toBeInstanceOf(DriveConflictError);
        const restored = await driveDoctorRepo.restore(updated.id, deleted.revision);
        expect(restored.id).toBe(updated.id);
        expect(await driveDoctorRepo.restore(updated.id, deleted.revision)).toMatchObject({id: updated.id});
    });

    it('returns cached doctors when offline without calling fetch', async () => {
        await driveDoctorRepo.list();
        const saved = await driveDoctorRepo.save({
            name: 'Dr. Offline',
            addresses: ['Calle 1'],
            defaultAddress: 'Calle 1',
        });
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        expect((await driveDoctorRepo.list()).map((d) => d.id)).toContain(saved.id);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('reuses a reserved ID on a retried doctor creation and rejects stale edits', async () => {
        await expect(driveDoctorRepo.save({name: '   ', addresses: []})).rejects.toThrow(/nombre/i);

        const draft = {
            name: 'Dra. Idempotente',
            addresses: ['Dirección 1'],
            defaultAddress: 'Dirección 1',
            createId: 'reserved-doctor',
        };
        const first = await driveDoctorRepo.save(draft);
        const retried = await driveDoctorRepo.save(draft);
        expect(retried.id).toBe(first.id);
        expect((await driveDoctorRepo.list()).filter((item) => item.id === first.id)).toHaveLength(1);

        touchRemote(first.id);
        await expect(driveDoctorRepo.save({...first, specialty: 'Neurología'})).rejects.toBeInstanceOf(
            DriveConflictError,
        );
        await expect(driveDoctorRepo.delete(first.id, first.revision!)).rejects.toBeInstanceOf(DriveConflictError);
    });

    it('rejects unreadable doctor records returned by Drive', async () => {
        server.use(
            http.get('https://www.googleapis.com/drive/v3/files', () =>
                HttpResponse.json({
                    files: [
                        {
                            id: 'bad-doc',
                            name: 'bad',
                            description: JSON.stringify({name: '   '}),
                            version: '1',
                            mimeType: 'application/json',
                            trashed: false,
                            appProperties: {misEstudios: 'medico-v1'},
                        },
                    ],
                }),
            ),
        );
        await expect(driveDoctorRepo.list()).rejects.toThrow(/no se puede leer/i);
    });
});
