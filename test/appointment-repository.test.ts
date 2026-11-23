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

it('round-trips the chosen studies in Drive and removes them when cleared', async () => {
    const created = await driveAppointmentRepo.save({...draft, studyIds: ['study-1', 'study-2']});
    const [loaded] = await driveAppointmentRepo.list();
    expect(loaded?.studyIds).toEqual(['study-1', 'study-2']);

    await driveAppointmentRepo.save({...created, studyIds: []});
    expect((await driveAppointmentRepo.get(created.id)).studyIds ?? []).toEqual([]);
});

it('stores and downloads a prescription on the same turn while preserving later edits', async () => {
    const scheduled = await driveAppointmentRepo.save({...draft, specialty: 'Otorrinolaringología'});
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
    const completed = await driveAppointmentRepo.save({
        ...scheduled, status: 'completed', prescriptionFile: new File([png], 'receta.png', {type: 'image/png'}),
    });
    expect((await driveAppointmentRepo.list())[0]).toMatchObject({
        id: scheduled.id, specialty: 'Otorrinolaringología', status: 'completed',
        prescription: {name: 'receta.png', mimeType: 'image/png'},
    });
    const edited = await driveAppointmentRepo.save({...completed, notes: 'Control'});
    const downloaded = await driveAppointmentRepo.getPrescription(edited);
    expect(downloaded.name).toBe('receta.png');
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(png);
    await expect(driveAppointmentRepo.getPrescription(completed)).rejects.toBeInstanceOf(DriveConflictError);
    await driveAppointmentRepo.save({...edited, removePrescription: true});
    expect((await driveAppointmentRepo.get(edited.id)).prescription).toBeUndefined();
});

it('recovers a retried turn creation with the original prescription bytes', async () => {
    const createId = 'reserved-turn';
    const prescriptionFile = new File(['%PDF-1.7\nA'], 'receta.pdf', {type: 'application/pdf'});
    const created = await driveAppointmentRepo.save({...draft, createId, prescriptionFile});
    await expect(driveAppointmentRepo.save({
        ...draft,
        createId,
        prescriptionFile
    })).resolves.toMatchObject({id: created.id});
    const otherFile = new File(['%PDF-1.7\nB'], 'receta.pdf', {type: 'application/pdf'});
    await expect(driveAppointmentRepo.save({
        ...draft,
        createId,
        prescriptionFile: otherFile
    })).rejects.toBeInstanceOf(DriveConflictError);
    expect(await driveAppointmentRepo.list()).toHaveLength(1);
});

it('persists and clears appointment location in Drive', async () => {
    const created = await driveAppointmentRepo.save({...draft, location: '  Hospital Italiano · Sede Almagro  '});
    expect(created.location).toBe('Hospital Italiano · Sede Almagro');
    expect((await driveAppointmentRepo.list()).find((item) => item.id === created.id)?.location).toBe(
        'Hospital Italiano · Sede Almagro',
    );
    const cleared = await driveAppointmentRepo.save({...created, location: '   '});
    expect(cleared.location).toBeUndefined();
    expect((await driveAppointmentRepo.get(created.id)).location).toBeUndefined();
});
