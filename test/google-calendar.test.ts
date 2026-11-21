import {http, HttpResponse} from 'msw';
import {describe, expect, it} from 'vitest';
import {
    DriveAuthRepository,
    DriveClient,
    DriveSessionError,
    GoogleCalendarRepository,
} from '@data';
import {googleCalendarEventId} from '@domain/appointments';
import type {Appointment} from '@domain/models';
import {deleteFakeCalendar, fakeCalendarEvents, fakeCalendars} from './fake-calendar';
import {DRIVE_SCOPE, gis} from './fake-google';
import {server} from './server';

function makeAppointment(over: Partial<Appointment> = {}): Appointment {
    return {
        id: 'appt-1',
        revision: '1',
        date: '2026-11-25',
        time: '14:30',
        timeZone: 'America/Argentina/Buenos_Aires',
        professional: 'Dra. Perez',
        specialty: 'Cardiología',
        location: 'Av. Santa Fe 1234',
        notes: 'Llevar estudios previos',
        status: 'scheduled',
        cost: null,
        coverage: null,
        ...over,
    };
}

function createClients() {
    const client = new DriveClient();
    return {
        client,
        auth: new DriveAuthRepository(client),
        calendar: new GoogleCalendarRepository(client),
    };
}

describe('GoogleCalendarRepository', () => {
    it('creates the "Turnos" calendar once, stores its ID in Drive, and reuses it in another session', async () => {
        const first = createClients();
        await first.auth.signIn();

        const appointment = makeAppointment();
        expect(await first.calendar.syncAppointment(appointment)).toBe('synced');
        expect(fakeCalendars()).toHaveLength(1);
        const createdCal = fakeCalendars()[0]!;
        expect(createdCal.summary).toBe('Turnos');
        expect(createdCal.timeZone).toBe('America/Argentina/Buenos_Aires');

        const eventId = await googleCalendarEventId(appointment.id);
        expect(fakeCalendarEvents(createdCal.id)).toHaveLength(1);
        expect(fakeCalendarEvents(createdCal.id)[0]).toMatchObject({
            id: eventId,
            status: 'confirmed',
            summary: 'Turno Dra. Perez',
            location: 'Av. Santa Fe 1234',
            description: 'Especialidad: Cardiología\nLugar: Av. Santa Fe 1234\nNotas: Llevar estudios previos',
            reminders: {
                useDefault: false,
                overrides: [],
            },
        });

        const second = createClients();
        expect(second.auth.restoreSession()).toBe(true);
        await second.calendar.syncAppointment(makeAppointment({id: 'appt-2', professional: 'Dr. Gomez'}));
        expect(fakeCalendars()).toHaveLength(1);
        expect(fakeCalendarEvents(createdCal.id)).toHaveLength(2);
    });

    it('recreates the calendar and updates Drive config if the remote calendar was deleted', async () => {
        const first = createClients();
        await first.auth.signIn();
        await first.calendar.syncAppointment(makeAppointment());
        const oldCalId = fakeCalendars()[0]!.id;
        deleteFakeCalendar(oldCalId);

        const second = createClients();
        expect(second.auth.restoreSession()).toBe(true);
        await second.calendar.syncAppointment(makeAppointment({id: 'appt-2'}));
        expect(fakeCalendars()).toHaveLength(1);
        const newCalId = fakeCalendars()[0]!.id;
        expect(newCalId).not.toBe(oldCalId);
        expect(fakeCalendarEvents(newCalId)).toHaveLength(1);
    });

    it('updates, deletes, and revives cancelled events cleanly', async () => {
        const {auth, calendar} = createClients();
        await auth.signIn();
        const appt = makeAppointment();

        expect(await calendar.syncAppointment(appt)).toBe('synced');
        const calId = fakeCalendars()[0]!.id;
        const eventId = await googleCalendarEventId(appt.id);

        // Edit via preferUpdate
        expect(
            await calendar.syncAppointment(
                makeAppointment({time: '15:00', location: ''}),
                undefined,
                {preferUpdate: true},
            ),
        ).toBe('synced');
        expect(fakeCalendarEvents(calId)[0]).toMatchObject({
            location: '',
            reminders: {
                useDefault: false,
                overrides: [],
            },
        });

        // Cancel sets event to cancelled via DELETE (204)
        expect(await calendar.syncAppointment(makeAppointment({status: 'cancelled'}))).toBe('removed');
        expect(fakeCalendarEvents(calId)[0]?.status).toBe('cancelled');

        // Re-scheduling hits 409 on POST and revives via PUT with status: 'confirmed'
        expect(await calendar.syncAppointment(appt)).toBe('synced');
        expect(fakeCalendarEvents(calId)[0]).toMatchObject({id: eventId, status: 'confirmed'});

        // Deleting a second time treats 410 as already removed
        expect(await calendar.removeAppointment(appt.id)).toBe('removed');
        expect(await calendar.removeAppointment(appt.id)).toBe('removed');

        // Completed appointments are skipped
        expect(await calendar.syncAppointment(makeAppointment({status: 'completed'}))).toBe('skipped');
    });

    it('falls back from PUT 404 to POST when updating an appointment without a prior event', async () => {
        const {auth, calendar} = createClients();
        await auth.signIn();
        expect(await calendar.syncAppointment(makeAppointment(), undefined, {preferUpdate: true})).toBe('synced');
        const calId = fakeCalendars()[0]!.id;
        expect(fakeCalendarEvents(calId)).toHaveLength(1);
    });

    it('does not create a calendar when removing an appointment before any calendar exists', async () => {
        const {auth, calendar} = createClients();
        await auth.signIn();
        expect(await calendar.removeAppointment('appt-missing')).toBe('skipped');
        expect(fakeCalendars()).toHaveLength(0);
    });

    it('skips Calendar operations when the account did not grant Calendar scope', async () => {
        gis.tokenResponse = {access_token: 'drive-only', expires_in: 3600, scope: DRIVE_SCOPE};
        const {auth, calendar} = createClients();
        await auth.signIn();
        expect(await calendar.syncAppointment(makeAppointment())).toBe('skipped');
        expect(await calendar.removeAppointment('appt-1')).toBe('skipped');
        expect(fakeCalendars()).toHaveLength(0);
    });

    it('rejects with DriveSessionError if the session changes mid-sync', async () => {
        const {auth, calendar} = createClients();
        await auth.signIn();
        let release!: () => void;
        let started!: () => void;
        const wait = new Promise<void>((resolve) => {
            release = resolve;
        });
        const began = new Promise<void>((resolve) => {
            started = resolve;
        });
        server.use(
            http.post('https://www.googleapis.com/calendar/v3/calendars', async () => {
                started();
                await wait;
                return HttpResponse.json({id: 'cal-stale', summary: 'Turnos'});
            }),
        );
        const pending = calendar.syncAppointment(makeAppointment());
        const rejected = expect(pending).rejects.toBeInstanceOf(DriveSessionError);
        await began;
        await auth.signOut();
        gis.tokenResponse.access_token = 'other-account-token';
        await auth.signIn();
        release();
        await rejected;
    });
});
