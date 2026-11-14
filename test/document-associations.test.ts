import {expect, it} from 'vitest';
import {driveAuth, driveStudyRepo} from '@data';
import {fakeDriveFile, SEED_PDF_ID} from './fake-drive';

it('keeps one PDF and stores distinct document associations in the linked study', async () => {
    await driveAuth.signIn();
    const study = await driveStudyRepo.get('study-2');
    const updated = await driveStudyRepo.save({
        ...study,
        driveFileId: study.id,
        documentIds: [SEED_PDF_ID, SEED_PDF_ID]
    });
    expect(updated.documentIds).toEqual([SEED_PDF_ID]);
    expect((await driveStudyRepo.list({force: true})).find((item) => item.id === study.id)?.documentIds).toEqual([SEED_PDF_ID]);
    expect(fakeDriveFile(SEED_PDF_ID)?.trashed).toBe(false);
});

it('prevents removing a shared PDF and permits removing just its association', async () => {
    await driveAuth.signIn();
    const target = await driveStudyRepo.get('study-2');
    const linked = await driveStudyRepo.save({...target, driveFileId: target.id, documentIds: [SEED_PDF_ID]});
    const source = await driveStudyRepo.get(SEED_PDF_ID);
    await expect(driveStudyRepo.save({
        ...source,
        driveFileId: source.id,
        removeReport: true
    })).rejects.toThrow('Desvinculá');
    await expect(driveStudyRepo.delete(source.id, source.revision)).rejects.toThrow('Desvinculá');
    const unlinked = await driveStudyRepo.save({...linked, driveFileId: linked.id, documentIds: []});
    expect(unlinked.documentIds).toEqual([]);
    expect(fakeDriveFile(SEED_PDF_ID)?.trashed).toBe(false);
});
