import {beforeEach, describe, expect, it, vi} from 'vitest';
import {storage} from '@core/storage';
import {DriveConflictError, driveAuth, driveStudyRepo, driveOperationRepo, drivePortalRepo} from '@data';
import {
    addRemoteStudy,
    clearFakeDrive,
    fakeDriveFile,
    SEED_JSON_ID,
    SEED_PDF_ID,
    touchRemote,
    uploadLog
} from './fake-drive';

const baseDraft = {
    title: 'Nuevo estudio',
    date: '2024-03-01',
    types: ['Radiografía'],
    doctor: 'Dr. Test',
    portal: 'Clínica Test',
    viewer: 'https://example.com/viewer',
    reportName: '',
};

describe('study recovery', () => {
    beforeEach(async () => {
        await driveAuth.signOut();
        await driveAuth.signIn();
    });

    it('lists and restores a deleted study with its metadata', async () => {
        const study = await driveStudyRepo.get(SEED_PDF_ID);
        await driveStudyRepo.delete(study.id, study.revision);
        const deleted = await driveStudyRepo.listDeleted();
        expect(deleted).toHaveLength(1);
        expect(deleted[0]).toMatchObject({id: study.id, title: study.title, recoverable: true});
        const restored = await driveStudyRepo.restore(deleted[0]!.id, deleted[0]!.revision);
        expect(restored).toMatchObject({id: study.id, title: study.title, hasPdf: true});
    });

    it('rejects recovery when the deleted record changed', async () => {
        const study = await driveStudyRepo.get(SEED_PDF_ID);
        await driveStudyRepo.delete(study.id, study.revision);
        const [deleted] = await driveStudyRepo.listDeleted();
        touchRemote(study.id);
        await expect(driveStudyRepo.restore(study.id, deleted!.revision)).rejects.toBeInstanceOf(DriveConflictError);
        expect(fakeDriveFile(study.id)?.trashed).toBe(true);
    });

    it('retries an already completed restoration and provides the cached list offline', async () => {
        const study = await driveStudyRepo.get(SEED_PDF_ID);
        await driveStudyRepo.delete(study.id, study.revision);
        const [deleted] = await driveStudyRepo.listDeleted();
        const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        expect((await driveStudyRepo.listDeleted())[0]?.id).toBe(study.id);
        online.mockReturnValue(true);
        await driveStudyRepo.restore(study.id, deleted!.revision);
        await expect(driveStudyRepo.restore(study.id, deleted!.revision)).resolves.toMatchObject({id: study.id});
    });
});

describe('image attachments', () => {
    beforeEach(async () => {
        await driveAuth.signOut();
        await driveAuth.signIn();
    });

    it('stores a PNG with its MIME type and keeps it when editing metadata', async () => {
        const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'informe.png', {type: 'image/png'});
        const saved = await driveStudyRepo.save({...baseDraft, file});
        expect(saved).toMatchObject({hasPdf: false, attachmentMime: 'image/png', reportName: 'informe.png'});
        expect(fakeDriveFile(saved.id)?.mimeType).toBe('image/png');
        const updated = await driveStudyRepo.save({
            ...baseDraft,
            title: 'Otro título',
            driveFileId: saved.id,
            revision: saved.revision
        });
        expect(updated).toMatchObject({attachmentMime: 'image/png', reportName: 'informe.png'});
        expect(fakeDriveFile(saved.id)?.mimeType).toBe('image/png');
    });
});

describe('DriveOperationRepository', () => {
    beforeEach(async () => {
        await driveAuth.signOut();
        await driveAuth.signIn();
    });

    it('creates, updates and deletes operations in Drive', async () => {
        const created = await driveOperationRepo.save({
            name: 'Rodilla',
            date: '2024-05-01',
            surgeon: 'Dra. Pérez',
            institution: 'Hospital',
            type: 'Cirugía',
            notes: 'Seguimiento'
        });
        expect((await driveOperationRepo.list()).find((op) => op.id === created.id)).toMatchObject({
            name: 'Rodilla',
            surgeon: 'Dra. Pérez'
        });
        const updated = await driveOperationRepo.save({...created, name: 'Rodilla izquierda'});
        expect((await driveOperationRepo.get(updated.id)).name).toBe('Rodilla izquierda');
        await driveOperationRepo.delete(updated.id, updated.revision!);
        expect((await driveOperationRepo.list()).some((op) => op.id === updated.id)).toBe(false);
    });

    it('accepts a retry when the same operation is already in the trash', async () => {
        const op = await driveOperationRepo.save({name: 'Operación'});
        await driveOperationRepo.delete(op.id, op.revision!);
        await expect(driveOperationRepo.delete(op.id, op.revision!)).resolves.toBeUndefined();
    });

    it('returns the cached directory when offline', async () => {
        await driveOperationRepo.list();
        const operation = await driveOperationRepo.save({name: 'Intervención'});
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        expect((await driveOperationRepo.list()).map((item) => item.id)).toContain(operation.id);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('reuses a reserved ID on a retried operation creation', async () => {
        const draft = {name: 'Intervención', createId: 'reserved-operation'};
        const first = await driveOperationRepo.save(draft);
        const retried = await driveOperationRepo.save(draft);
        expect(retried.id).toBe(first.id);
        expect((await driveOperationRepo.list()).filter((item) => item.id === first.id)).toHaveLength(1);
    });

    it('refuses to delete an operation linked to a study', async () => {
        const op = await driveOperationRepo.save({name: 'Intervención'});
        await driveStudyRepo.save({...baseDraft, operationId: op.id});
        await expect(driveOperationRepo.delete(op.id, op.revision!)).rejects.toThrow('Desvinculá');
        expect((await driveOperationRepo.list()).some((item) => item.id === op.id)).toBe(true);
    });

    it('rejects an edit when the operation changed in Drive', async () => {
        const op = await driveOperationRepo.save({name: 'Intervención'});
        touchRemote(op.id);
        await expect(driveOperationRepo.save({
            ...op,
            name: 'Cambio antiguo'
        })).rejects.toBeInstanceOf(DriveConflictError);
        await expect(driveOperationRepo.delete(op.id, op.revision!)).rejects.toBeInstanceOf(DriveConflictError);
        expect((await driveOperationRepo.get(op.id)).name).toBe('Intervención');
    });
});

describe('DrivePortalRepository', () => {
    beforeEach(async () => {
        await driveAuth.signOut();
        await driveAuth.signIn();
    });
    it('accepts a retry when the same portal is already in the trash', async () => {
        const portal = await drivePortalRepo.save({name: 'hospital', displayName: 'Hospital', url: ''});
        await drivePortalRepo.delete(portal);
        await expect(drivePortalRepo.delete(portal)).resolves.toBeUndefined();
    });
    it('persists portal changes and removes a portal in Drive', async () => {
        const portal = await drivePortalRepo.save({
            name: 'hospital',
            displayName: 'Hospital',
            url: 'https://example.com',
            notes: 'Resultados'
        });
        expect((await drivePortalRepo.list()).find((p) => p.id === portal.id)).toMatchObject({
            displayName: 'Hospital',
            notes: 'Resultados'
        });
        const updated = await drivePortalRepo.save({...portal, url: 'https://example.org'});
        expect((await drivePortalRepo.list()).find((p) => p.id === updated.id)?.url).toBe('https://example.org/');
        await drivePortalRepo.delete(updated);
        expect((await drivePortalRepo.list()).some((p) => p.id === updated.id)).toBe(false);
    });
    it('returns the cached directory when offline', async () => {
        await drivePortalRepo.list();
        const portal = await drivePortalRepo.save({
            name: 'hospital',
            displayName: 'Hospital',
            url: 'https://example.com'
        });
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        expect((await drivePortalRepo.list()).map((item) => item.id)).toContain(portal.id);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
    it('reuses a reserved ID on a retried portal creation', async () => {
        const draft = {
            name: 'clinica',
            displayName: 'Clínica',
            url: 'https://example.com',
            createId: 'reserved-portal'
        };
        const first = await drivePortalRepo.save(draft);
        const retried = await drivePortalRepo.save(draft);
        expect(retried.id).toBe(first.id);
        expect((await drivePortalRepo.list()).filter((item) => item.id === first.id)).toHaveLength(1);
    });
    it('rejects unsafe links and edits based on stale data', async () => {
        await expect(drivePortalRepo.save({name: 'x', displayName: 'X', url: 'javascript:alert(1)'})).rejects.toThrow();
        const portal = await drivePortalRepo.save({name: 'x', displayName: 'X', url: 'https://example.com'});
        touchRemote(portal.id!);
        await expect(drivePortalRepo.save({
            ...portal,
            displayName: 'Viejo'
        })).rejects.toBeInstanceOf(DriveConflictError);
        await expect(drivePortalRepo.delete(portal)).rejects.toBeInstanceOf(DriveConflictError);
    });
});

describe('DriveAuthRepository', () => {
    beforeEach(async () => {
        await driveAuth.signOut();
    });

    it('is signed out initially', () => {
        expect(driveAuth.isSignedIn()).toBe(false);
    });

    it('signs in and out', async () => {
        await driveAuth.signIn();
        expect(driveAuth.isSignedIn()).toBe(true);

        await driveAuth.signOut();
        expect(driveAuth.isSignedIn()).toBe(false);
    });

    it('notifies listeners until they unsubscribe', async () => {
        const listener = vi.fn();
        const unsubscribe = driveAuth.onAuthChange(listener);

        await driveAuth.signIn();
        expect(listener).toHaveBeenLastCalledWith(true);

        await driveAuth.signOut();
        expect(listener).toHaveBeenLastCalledWith(false);

        unsubscribe();
        listener.mockClear();
        await driveAuth.signIn();
        expect(listener).not.toHaveBeenCalled();
    });
});

describe('DriveStudyRepository', () => {
    beforeEach(async () => {
        await driveAuth.signOut();
        await driveAuth.signIn();
    });

    describe('list', () => {
        it('maps Drive files to studies', async () => {
            const studies = await driveStudyRepo.list();

            expect(studies).toHaveLength(2);
            expect(studies.find((s) => s.id === SEED_PDF_ID)).toMatchObject({
                title: 'Ecografía abdominal',
                date: '2024-01-15',
                types: ['Ecografía'],
                doctor: 'Dra. Ana Pérez',
                portal: 'Hospital Central',
                viewer: 'https://portal.hospital.com/viewer/123',
                reportName: 'Informe.pdf',
                hasPdf: true,
            });
            expect(studies.find((s) => s.id === SEED_JSON_ID)?.hasPdf).toBe(false);
        });

        it('exposes the Drive revision and modification time', async () => {
            const study = (await driveStudyRepo.list()).find((s) => s.id === SEED_PDF_ID);

            expect(study?.revision).toBe('1');
            expect(study?.driveModifiedTime).toBe('2024-01-01T00:00:00.000Z');
        });

        it('serves the cache while it is fresh', async () => {
            await driveStudyRepo.list();
            addRemoteStudy('remote-1', 'Agregado desde otro dispositivo');

            expect(await driveStudyRepo.list()).toHaveLength(2);
        });

        it('serves an older session cache while offline', async () => {
            await driveStudyRepo.list();
            await storage.setMeta('lastSync', Date.now() - 25 * 60 * 60 * 1000);
            vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
            const fetchSpy = vi.spyOn(globalThis, 'fetch');
            expect(await driveStudyRepo.list({force: true})).toHaveLength(2);
            expect(fetchSpy).not.toHaveBeenCalled();
        });

        it('serves a previously synchronized empty library while offline', async () => {
            clearFakeDrive();
            expect(await driveStudyRepo.list({force: true})).toEqual([]);
            vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
            const fetchSpy = vi.spyOn(globalThis, 'fetch');
            expect(await driveStudyRepo.list({force: true})).toEqual([]);
            expect(fetchSpy).not.toHaveBeenCalled();
        });

        it('accepts a retry when the same study is already in the trash', async () => {
            const study = (await driveStudyRepo.list())[0]!;
            await driveStudyRepo.delete(study.id, study.revision!);
            await expect(driveStudyRepo.delete(study.id, study.revision!)).resolves.toBeUndefined();
        });

        it('bypasses a fresh cache when forced', async () => {
            await driveStudyRepo.list();
            addRemoteStudy('remote-1', 'Agregado desde otro dispositivo');

            const forced = await driveStudyRepo.list({force: true});

            expect(forced.map((s) => s.id)).toContain('remote-1');
            expect(await driveStudyRepo.list()).toHaveLength(3);
        });

        it('refetches once stale and drops cached entries that no longer exist in Drive', async () => {
            await driveStudyRepo.list();
            const cachedPdf = (await storage.getStudy(SEED_PDF_ID))!;
            await storage.setStudies([{...cachedPdf, id: 'ghost', driveFileId: 'ghost', title: 'Borrado en Drive'}]);
            addRemoteStudy('remote-1', 'Agregado desde otro dispositivo');
            await storage.setMeta('lastSync', Date.now() - 25 * 60 * 60 * 1000);

            const ids = (await driveStudyRepo.list()).map((s) => s.id).sort();

            expect(ids).toEqual([SEED_PDF_ID, SEED_JSON_ID, 'remote-1'].sort());
            expect((await storage.getStudies()).map((s) => s.id).sort()).toEqual(ids);
        });

        it('fails when signed out', async () => {
            await driveAuth.signOut();
            await expect(driveStudyRepo.list()).rejects.toThrow('Volvé a conectar Google Drive');
        });
    });

    describe('get', () => {
        it('fetches a study that is not cached', async () => {
            expect(await driveStudyRepo.get(SEED_PDF_ID)).toMatchObject({
                id: SEED_PDF_ID,
                title: 'Ecografía abdominal'
            });
        });

        it('reports a missing study', async () => {
            await expect(driveStudyRepo.get('missing')).rejects.toThrow('ya no está disponible');
        });
    });

    describe('save', () => {
        it('persists an operation association in Drive and the local cache', async () => {
            const saved = await driveStudyRepo.save({...baseDraft, operationId: 'operation-1'});
            expect(saved.operationId).toBe('operation-1');
            expect(JSON.parse(fakeDriveFile(saved.id)!.description).operationId).toBe('operation-1');
            expect((await driveStudyRepo.get(saved.id)).operationId).toBe('operation-1');
            expect((await driveStudyRepo.list({force: true})).find((study) => study.id === saved.id)?.operationId).toBe('operation-1');
        });
        it('creates a ficha-only study and shows it in the next list()', async () => {
            await driveStudyRepo.list();

            const saved = await driveStudyRepo.save(baseDraft);

            expect(saved).toMatchObject({title: 'Nuevo estudio', hasPdf: false, reportName: ''});
            expect(fakeDriveFile(saved.id)).toMatchObject({
                mimeType: 'application/json',
                name: '2024-03-01 Nuevo estudio.json'
            });
            // The cache is still "fresh", so this only passes if save() updated it.
            expect((await driveStudyRepo.list()).map((s) => s.id)).toContain(saved.id);
        });

        it('creates a study with a PDF attached', async () => {
            const file = new File(['%PDF-1.4 test'], 'informe-nuevo.pdf', {type: 'application/pdf'});

            const saved = await driveStudyRepo.save({...baseDraft, reportName: file.name, file});

            expect(uploadLog).toEqual(['multipart']);
            expect(saved).toMatchObject({hasPdf: true, reportName: 'informe-nuevo.pdf'});
            expect(fakeDriveFile(saved.id)).toMatchObject({mimeType: 'application/pdf', content: '%PDF-1.4 test'});
        });

        it('does not accept a retry when an existing PDF has different content', async () => {
            const original = new File(['%PDF-1.4 original'], 'informe.pdf', {type: 'application/pdf'});
            const changed = new File(['%PDF-1.4 diferente'], 'informe.pdf', {type: 'application/pdf'});
            await driveStudyRepo.save({...baseDraft, id: 'reserved-pdf', file: original});
            await expect(driveStudyRepo.save({
                ...baseDraft,
                id: 'reserved-pdf',
                file: changed
            })).rejects.toThrow('revis');
            expect(fakeDriveFile('reserved-pdf')?.content).toBe('%PDF-1.4 original');
        });

        it('keeps the stored PDF when only the ficha is edited', async () => {
            const updated = await driveStudyRepo.save({
                ...baseDraft,
                title: 'Ecografía abdominal (revisada)',
                date: '2024-01-15',
                reportName: '', // the form does not resend the current report name
                driveFileId: SEED_PDF_ID,
                revision: '1',
            });

            expect(updated).toMatchObject({
                id: SEED_PDF_ID,
                title: 'Ecografía abdominal (revisada)',
                hasPdf: true,
                reportName: 'Informe.pdf',
            });
            expect(fakeDriveFile(SEED_PDF_ID)).toMatchObject({mimeType: 'application/pdf', content: 'PDF content'});
            expect(JSON.parse(fakeDriveFile(SEED_PDF_ID)!.description)).toMatchObject({id: SEED_PDF_ID});
        });

        it('removes the PDF only when asked to', async () => {
            const updated = await driveStudyRepo.save({
                ...baseDraft,
                driveFileId: SEED_PDF_ID,
                revision: '1',
                removeReport: true
            });

            expect(updated).toMatchObject({id: SEED_PDF_ID, hasPdf: false, reportName: ''});
            expect(fakeDriveFile(SEED_PDF_ID)?.mimeType).toBe('application/json');
        });

        it('replaces the PDF when a new file is provided', async () => {
            const file = new File(['new pdf'], 'reemplazo.pdf', {type: 'application/pdf'});

            const updated = await driveStudyRepo.save({
                ...baseDraft,
                reportName: file.name,
                file,
                driveFileId: SEED_PDF_ID,
                revision: '1',
            });

            expect(updated).toMatchObject({hasPdf: true, reportName: 'reemplazo.pdf'});
            expect(fakeDriveFile(SEED_PDF_ID)?.content).toBe('new pdf');
        });

        it('advances the revision after each successful edit', async () => {
            const first = await driveStudyRepo.save({...baseDraft, driveFileId: SEED_PDF_ID, revision: '1'});
            expect(first.revision).toBe('2');

            await expect(
                driveStudyRepo.save({...baseDraft, driveFileId: SEED_PDF_ID, revision: '1'})
            ).rejects.toBeInstanceOf(DriveConflictError);

            const second = await driveStudyRepo.save({
                ...baseDraft,
                driveFileId: SEED_PDF_ID,
                revision: first.revision
            });
            expect(second.revision).toBe('3');
        });

        it('refuses to overwrite a study edited elsewhere', async () => {
            touchRemote(SEED_PDF_ID); // another device saved: Drive is now at revision 2

            await expect(
                driveStudyRepo.save({...baseDraft, title: 'Mi versión vieja', driveFileId: SEED_PDF_ID, revision: '1'})
            ).rejects.toThrow('cambió en Drive');

            expect(JSON.parse(fakeDriveFile(SEED_PDF_ID)!.description).title).toBe('Ecografía abdominal');
            expect(fakeDriveFile(SEED_PDF_ID)?.version).toBe(2);
        });

        it('requires a revision when editing', async () => {
            await expect(
                driveStudyRepo.save({...baseDraft, driveFileId: SEED_PDF_ID})
            ).rejects.toBeInstanceOf(DriveConflictError);
        });

        it('uploads large PDFs through the resumable flow', async () => {
            const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.pdf', {type: 'application/pdf'});

            const saved = await driveStudyRepo.save({...baseDraft, reportName: big.name, file: big});

            expect(uploadLog).toEqual(['resumable']);
            expect(saved).toMatchObject({hasPdf: true, reportName: 'grande.pdf'});
            expect(fakeDriveFile(saved.id)?.content).toHaveLength(5 * 1024 * 1024 + 1);
        });

        it('replaces an existing PDF with a large one through the resumable flow', async () => {
            const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.pdf', {type: 'application/pdf'});

            const updated = await driveStudyRepo.save({
                ...baseDraft,
                reportName: big.name,
                file: big,
                driveFileId: SEED_PDF_ID,
                revision: '1',
            });

            expect(uploadLog).toEqual(['resumable']);
            expect(updated).toMatchObject({id: SEED_PDF_ID, hasPdf: true, reportName: 'grande.pdf', revision: '2'});
            expect(fakeDriveFile(SEED_PDF_ID)?.content).toHaveLength(5 * 1024 * 1024 + 1);
        });

        it('a new PDF wins when the user also ticked "Quitar PDF actual"', async () => {
            const file = new File(['replacement'], 'nuevo.pdf', {type: 'application/pdf'});

            const updated = await driveStudyRepo.save({
                ...baseDraft,
                reportName: file.name,
                file,
                removeReport: true,
                driveFileId: SEED_PDF_ID,
                revision: '1',
            });

            expect(updated).toMatchObject({hasPdf: true, reportName: 'nuevo.pdf'});
            expect(fakeDriveFile(SEED_PDF_ID)?.content).toBe('replacement');
        });

        it('does not touch Drive when the study to edit is missing', async () => {
            await expect(driveStudyRepo.save({...baseDraft, driveFileId: 'missing', revision: '1'})).rejects.toThrow(
                'ya no está disponible'
            );
        });
    });

    describe('delete', () => {
        it('moves the study to the trash and out of the list', async () => {
            await driveStudyRepo.list();

            await driveStudyRepo.delete(SEED_PDF_ID, '1');

            expect(fakeDriveFile(SEED_PDF_ID)?.trashed).toBe(true);
            expect((await driveStudyRepo.list()).map((s) => s.id)).toEqual([SEED_JSON_ID]);
        });

        it('refuses to delete a study edited elsewhere', async () => {
            touchRemote(SEED_PDF_ID);

            await expect(driveStudyRepo.delete(SEED_PDF_ID, '1')).rejects.toBeInstanceOf(DriveConflictError);

            expect(fakeDriveFile(SEED_PDF_ID)?.trashed).toBe(false);
        });
    });

    describe('getPdfFile', () => {
        it('downloads the PDF content', async () => {
            const file = await driveStudyRepo.getPdfFile(SEED_PDF_ID);

            expect(file.type).toBe('application/pdf');
            expect(await file.text()).toBe('PDF content');
        });
    });

    it('clears the local study cache on sign-out', async () => {
        await driveStudyRepo.list();
        expect(await storage.getStudies()).not.toHaveLength(0);

        await driveAuth.signOut();

        expect(await storage.getStudies()).toEqual([]);
        expect(await storage.isStale()).toBe(true);
    });
});
