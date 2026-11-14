import {beforeEach, expect, it} from 'vitest';
import {driveAuth, driveAppointmentRepo, DriveConflictError} from '@data';
import {touchRemote} from './fake-drive';

const draft = {
    date: '2026-11-20',
    time: '10:30',
    timeZone: 'America/Argentina/Buenos_Aires',
    professional: '',
    notes: '',
    status: 'scheduled' as const,
    cost: null,
    coverage: null
};
beforeEach(async () => {
    await driveAuth.signOut();
    await driveAuth.signIn();
});

it('stores, lists and updates appointments with revision checks', async () => {
    const appointment = await driveAppointmentRepo.save(draft);
    expect((await driveAppointmentRepo.list())[0]).toMatchObject(draft);
    const completed = await driveAppointmentRepo.save({...appointment, status: 'completed', cost: 0});
    expect(completed).toMatchObject({status: 'completed', cost: 0});
    touchRemote(completed.id);
    await expect(driveAppointmentRepo.save({...completed, notes: 'Cambio'})).rejects.toBeInstanceOf(DriveConflictError);
});

it('persists and removes a reminder while preserving the appointment', async () => {
    const created = await driveAppointmentRepo.save({...draft, reminderMinutes: 60});
    expect((await driveAppointmentRepo.list())[0]?.reminderMinutes).toBe(60);
    const updated = await driveAppointmentRepo.save({...created, reminderMinutes: null});
    expect(updated.reminderMinutes).toBeUndefined();
});
