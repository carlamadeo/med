import {beforeEach, expect, it, vi} from 'vitest';
import {
    driveAuth, driveAppointmentRepo, driveEpisodeRepo, driveMedicalEventRepo,
    driveOperationRepo, drivePortalRepo, DriveConflictError,
} from '@data';

beforeEach(async () => {
    await driveAuth.signOut();
    await driveAuth.signIn();
});

it('deletes and recovers an episode with its observations', async () => {
    const created = await driveEpisodeRepo.save({illness: 'Prueba', observations: [], medications: []});
    await driveEpisodeRepo.delete(created.id, created.revision);
    const deleted = (await driveEpisodeRepo.listDeleted()).find(item => item.id === created.id)!;
    expect(deleted.recoverable).toBe(true);
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect((await driveEpisodeRepo.listDeleted()).find(item => item.id === created.id)?.recoverable).toBe(true);
    online.mockRestore();
    await expect(driveEpisodeRepo.restore(created.id, 'stale')).rejects.toBeInstanceOf(DriveConflictError);
    expect(await driveEpisodeRepo.restore(created.id, deleted.revision)).toMatchObject({
        id: created.id,
        illness: 'Prueba'
    });
    expect(await driveEpisodeRepo.restore(created.id, deleted.revision)).toMatchObject({id: created.id});
});

it('deletes and recovers an appointment', async () => {
    const created = await driveAppointmentRepo.save({
        date: '2026-11-20',
        time: '10:30',
        timeZone: 'America/Argentina/Buenos_Aires',
        professional: '',
        notes: '',
        status: 'scheduled',
        cost: null,
        coverage: null
    });
    await driveAppointmentRepo.delete(created.id, created.revision);
    const deleted = (await driveAppointmentRepo.listDeleted()).find(item => item.id === created.id)!;
    expect(deleted.recoverable).toBe(true);
    await expect(driveAppointmentRepo.restore(created.id, 'stale')).rejects.toBeInstanceOf(DriveConflictError);
    expect(await driveAppointmentRepo.restore(created.id, deleted.revision)).toMatchObject({id: created.id});
    expect(await driveAppointmentRepo.restore(created.id, deleted.revision)).toMatchObject({id: created.id});
});

it('deletes and recovers a medical event', async () => {
    const created = await driveMedicalEventRepo.save({
        kind: 'consultation',
        date: '2024-01-01',
        doctor: '',
        notes: '',
        studyIds: [],
        documentIds: []
    });
    await driveMedicalEventRepo.delete(created.id, created.revision);
    const deleted = (await driveMedicalEventRepo.listDeleted()).find(item => item.id === created.id)!;
    expect(deleted.recoverable).toBe(true);
    await expect(driveMedicalEventRepo.restore(created.id, 'stale')).rejects.toBeInstanceOf(DriveConflictError);
    expect(await driveMedicalEventRepo.restore(created.id, deleted.revision)).toMatchObject({id: created.id});
    expect(await driveMedicalEventRepo.restore(created.id, deleted.revision)).toMatchObject({id: created.id});
});

it('deletes and recovers an operation', async () => {
    const created = await driveOperationRepo.save({name: 'Operación'});
    await driveOperationRepo.delete(created.id, created.revision!);
    const deleted = (await driveOperationRepo.listDeleted()).find(item => item.id === created.id)!;
    expect(deleted.recoverable).toBe(true);
    await expect(driveOperationRepo.restore(created.id, 'stale')).rejects.toBeInstanceOf(DriveConflictError);
    expect(await driveOperationRepo.restore(created.id, deleted.revision)).toMatchObject({id: created.id});
    expect(await driveOperationRepo.restore(created.id, deleted.revision)).toMatchObject({id: created.id});
});

it('deletes and recovers a portal', async () => {
    const created = await drivePortalRepo.save({name: 'portal', displayName: 'Portal', url: 'https://example.com'});
    await drivePortalRepo.delete(created);
    const deleted = (await drivePortalRepo.listDeleted()).find(item => item.id === created.id)!;
    expect(deleted.recoverable).toBe(true);
    await expect(drivePortalRepo.restore(created.id!, 'stale')).rejects.toBeInstanceOf(DriveConflictError);
    expect(await drivePortalRepo.restore(created.id!, deleted.revision)).toMatchObject({id: created.id});
    expect(await drivePortalRepo.restore(created.id!, deleted.revision)).toMatchObject({id: created.id});
});
