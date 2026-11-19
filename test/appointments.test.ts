import {describe, expect, it} from 'vitest';
import {appointmentStatus, appointmentInstant, createAppointmentCalendar, reminderDue, validateAppointment} from '@domain/appointments';
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
    it('exports a private calendar copy with the correct instant and a stable opaque ID', async () => {
        const appointment = {...draft, id: 'drive-qa-123', revision: '1', professional: 'Profesional reservado',
            notes: 'Información privada', studyIds: ['private-study'], reminderMinutes: 60 as const};
        const now = new Date('2026-11-19T10:03:02Z');
        const calendar = await createAppointmentCalendar(appointment, null, now);
        expect(calendar).toContain('DTSTART:20261120T133000Z\r\n');
        expect(calendar).toContain('DTSTAMP:20261119T100302Z\r\n');
        expect(calendar).toContain('SUMMARY:Turno\r\n');
        expect(calendar).not.toMatch(/drive-qa-123|private-study|Profesional reservado|Información privada|VALARM/);

        const moved = await createAppointmentCalendar({...appointment, time: '12:00'}, 15, now);
        expect(moved).toContain('DTSTART:20261120T150000Z\r\n');
        expect(moved).toContain('BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\n');
        expect(moved.match(/^UID:.+$/m)?.[0]).toBe(calendar.match(/^UID:.+$/m)?.[0]);
        await expect(createAppointmentCalendar({...appointment, status: 'cancelled'}, null, now))
            .rejects.toThrow('El turno no está disponible para exportar.');
    });
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

    it('calculates reminder windows in the appointment time zone', () => {
        const withReminder = {...draft, reminderMinutes: 60 as const};
        expect(appointmentInstant(withReminder)?.toISOString()).toBe('2026-11-20T13:30:00.000Z');
        expect(reminderDue(withReminder, new Date('2026-11-20T12:29:00Z'))).toBe(false);
        expect(reminderDue(withReminder, new Date('2026-11-20T12:30:00Z'))).toBe(true);
        expect(reminderDue({...withReminder, status: 'cancelled'}, new Date('2026-11-20T12:30:00Z'))).toBe(false);
        expect(reminderDue(withReminder, new Date('2026-11-20T13:31:00Z'))).toBe(false);
    });

    it('rejects nonexistent local times and chooses the earliest repeated time', () => {
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
});
