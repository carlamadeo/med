import {describe, expect, it} from 'vitest';
import {
    appointmentStatus,
    appointmentInstant,
    buildGoogleCalendarEvent,
    cleanLocation,
    googleCalendarEventId,
    validateAppointment,
} from '@domain/appointments';
import type {AppointmentDraft} from '@domain/models';

const draft: AppointmentDraft = {
    date: '2026-11-20',
    time: '10:30',
    timeZone: 'America/Argentina/Buenos_Aires',
    professional: '',
    notes: '',
    status: 'scheduled',
    cost: null,
    coverage: null
};

describe('appointments', () => {
    it('accepts optional details and distinguishes unknown cost from zero', () => {
        expect(validateAppointment(draft)).toEqual([]);
        expect(validateAppointment({...draft, cost: 0})).toEqual([]);
        expect(validateAppointment({...draft, cost: -1})).toContain('Ingresá un importe válido.');
    });

    it('validates date, time and time zone', () => {
        expect(validateAppointment({...draft, date: '2026-02-30', time: '25:00', timeZone: 'invalid'})).toHaveLength(3);
    });

    it('distinguishes overdue appointments from completed and cancelled ones', () => {
        const now = new Date('2026-11-20T14:00:00Z');
        expect(appointmentStatus(draft, now)).toBe('overdue');
        expect(appointmentStatus({...draft, status: 'completed'}, now)).toBe('completed');
        expect(appointmentStatus({...draft, status: 'cancelled'}, now)).toBe('cancelled');
        expect(appointmentStatus({...draft, status: 'absent'}, now)).toBe('absent');
        expect(appointmentStatus(draft, new Date('2026-11-20T13:00:00Z'))).toBe('upcoming');
    });

    it('resolves valid instants and rejects nonexistent local times while choosing the earliest repeated time', () => {
        expect(appointmentInstant(draft)?.toISOString()).toBe('2026-11-20T13:30:00.000Z');
        expect(appointmentInstant({
            ...draft,
            date: '2026-03-08',
            time: '02:30',
            timeZone: 'America/New_York'
        })).toBeNull();
        expect(appointmentInstant({
            ...draft,
            date: '2026-11-01',
            time: '01:30',
            timeZone: 'America/New_York'
        })?.toISOString()).toBe('2026-11-01T05:30:00.000Z');
    });

    it('normalizes optional locations and generates opaque base32hex Google Calendar IDs', async () => {
        expect(cleanLocation('  Av.   Santa Fe 1234  ')).toBe('Av. Santa Fe 1234');
        expect(cleanLocation('   ')).toBeUndefined();
        expect(cleanLocation(null)).toBeUndefined();

        const first = await googleCalendarEventId('drive-qa-123');
        const second = await googleCalendarEventId('drive-qa-123');
        expect(first).toBe(second);
        expect(first).toMatch(/^[a-v0-9]{52}$/);
        expect(first).not.toContain('drive-qa-123');
    });

    it('builds descriptive Google Calendar event payloads with "Turno ..." summary and no notifications', async () => {
        const eventId = await googleCalendarEventId('appt-1');
        const payload = buildGoogleCalendarEvent(
            {
                ...draft,
                id: 'appt-1',
                revision: '1',
                date: '2026-11-20',
                time: '14:30',
                professional: 'Dra. Perez',
                specialty: 'Cardiología',
                location: '  Av. Santa Fe 1234  ',
                notes: 'Llevar orden',
            },
            eventId,
        );
        expect(payload).toEqual({
            id: eventId,
            status: 'confirmed',
            summary: 'Turno Dra. Perez',
            location: 'Av. Santa Fe 1234',
            description: 'Especialidad: Cardiología\nLugar: Av. Santa Fe 1234\nNotas: Llevar orden',
            start: {dateTime: '2026-11-20T17:30:00.000Z', timeZone: 'America/Argentina/Buenos_Aires'},
            end: {dateTime: '2026-11-20T18:00:00.000Z', timeZone: 'America/Argentina/Buenos_Aires'},
            reminders: {
                useDefault: false,
                overrides: [],
            },
        });

        const bySpecialty = buildGoogleCalendarEvent(
            {...draft, id: 'appt-2', revision: '1', specialty: 'Cardiología'},
            eventId,
        );
        expect(bySpecialty.summary).toBe('Turno Cardiología');

        const prefixed = buildGoogleCalendarEvent(
            {...draft, id: 'appt-3', revision: '1', professional: 'Turno ecografía'},
            eventId,
        );
        expect(prefixed.summary).toBe('Turno ecografía');

        const minimal = buildGoogleCalendarEvent({...draft, id: 'appt-4', revision: '1'}, eventId);
        expect(minimal.summary).toBe('Turno médico');
        expect(minimal.location).toBe('');
        expect(minimal.description).toBe('');
    });
});
