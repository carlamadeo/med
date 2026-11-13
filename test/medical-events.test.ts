import { expect, it } from 'vitest';
import { DriveConflictError, driveAuth, driveMedicalEventRepo, driveStudyRepo } from '@data';
import { touchRemote } from './fake-drive';

it('creates and updates a consultation while rejecting stale revisions', async () => {
  await driveAuth.signIn();
  const event = await driveMedicalEventRepo.save({ kind: 'consultation', date: '2024-01-01', doctor: 'Dra. Prueba', notes: 'Nota', studyIds: ['study-1'], documentIds: [] });
  expect((await driveMedicalEventRepo.list()).find((item) => item.id === event.id)).toMatchObject({ kind: 'consultation', studyIds: ['study-1'] });
  const updated = await driveMedicalEventRepo.save({ ...event, notes: 'Actualizada' });
  expect(updated.revision).not.toBe(event.revision);
  touchRemote(event.id);
  await expect(driveMedicalEventRepo.save({ ...updated, notes: 'Antigua' })).rejects.toBeInstanceOf(DriveConflictError);
});

it('does not remove a study or its PDF while an event references them', async () => {
  await driveAuth.signIn();
  const study = await driveStudyRepo.get('study-1');
  await driveMedicalEventRepo.save({ kind: 'consultation', date: '2024-01-01', doctor: '', notes: '', studyIds: ['study-1'], documentIds: ['study-1'] });
  await expect(driveStudyRepo.delete(study.id, study.revision)).rejects.toThrow('evento');
});
