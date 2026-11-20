import {expect, it} from 'vitest';
import {DriveConflictError, driveAuth, driveMedicalEventRepo, driveStudyRepo} from '@data';
import {touchRemote} from './fake-drive';

it('creates and updates a consultation while rejecting stale revisions', async () => {
    await driveAuth.signIn();
    const event = await driveMedicalEventRepo.save({
        kind: 'consultation',
        date: '2024-01-01',
        doctor: 'Dra. Prueba',
        specialty: '  Cardiología  ',
        notes: 'Nota',
        studyIds: ['study-1'],
        documentIds: []
    });
    expect((await driveMedicalEventRepo.list()).find((item) => item.id === event.id)).toMatchObject({
        kind: 'consultation',
        specialty: 'Cardiología',
        studyIds: ['study-1']
    });
    const updated = await driveMedicalEventRepo.save({...event, specialty: 'Clínica médica', notes: 'Actualizada'});
    expect(updated.revision).not.toBe(event.revision);
    expect((await driveMedicalEventRepo.get(event.id)).specialty).toBe('Clínica médica');
    const cleared = await driveMedicalEventRepo.save({...updated, specialty: ''});
    expect((await driveMedicalEventRepo.get(event.id)).specialty).toBeUndefined();
    touchRemote(event.id);
    await expect(driveMedicalEventRepo.save({...cleared, notes: 'Antigua'})).rejects.toBeInstanceOf(DriveConflictError);
});

it('does not remove a study or its PDF while an event references them', async () => {
    await driveAuth.signIn();
    const study = await driveStudyRepo.get('study-1');
    await driveMedicalEventRepo.save({
        kind: 'consultation',
        date: '2024-01-01',
        doctor: '',
        notes: '',
        studyIds: ['study-1'],
        documentIds: ['study-1']
    });
    await expect(driveStudyRepo.delete(study.id, study.revision)).rejects.toThrow('evento');
});
