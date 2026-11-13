import { describe, expect, it } from 'vitest';
import { appointmentStatus, appointmentInstant, reminderDue, validateAppointment } from '@domain/appointments';
import type { AppointmentDraft } from '@domain/models';

const draft: AppointmentDraft = { date: '2026-11-20', time: '10:30', timeZone: 'America/Argentina/Buenos_Aires', professional: '', notes: '', status: 'scheduled', cost: null, coverage: null };

describe('appointments', () => {
  it('accepts optional details and distinguishes unknown cost from zero', () => {
    expect(validateAppointment(draft)).toEqual([]);
    expect(validateAppointment({ ...draft, cost: 0 })).toEqual([]);
    expect(validateAppointment({ ...draft, cost: -1 })).toContain('Ingresá un importe válido.');
  });

  it('validates date, time and time zone', () => {
    expect(validateAppointment({ ...draft, date: '2026-02-30', time: '25:00', timeZone: 'invalid' })).toHaveLength(3);
  });

  it('distinguishes overdue appointments from completed and cancelled ones', () => {
    const now = new Date('2026-11-20T14:00:00Z');
    expect(appointmentStatus(draft, now)).toBe('overdue');
    expect(appointmentStatus({ ...draft, status: 'completed' }, now)).toBe('completed');
    expect(appointmentStatus({ ...draft, status: 'cancelled' }, now)).toBe('cancelled');
    expect(appointmentStatus({ ...draft, status: 'absent' }, now)).toBe('absent');
    expect(appointmentStatus(draft, new Date('2026-11-20T13:00:00Z'))).toBe('upcoming');
  });

  it('calculates reminder windows in the appointment time zone', () => {
    const withReminder = { ...draft, reminderMinutes: 60 as const };
    expect(appointmentInstant(withReminder)?.toISOString()).toBe('2026-11-20T13:30:00.000Z');
    expect(reminderDue(withReminder, new Date('2026-11-20T12:29:00Z'))).toBe(false);
    expect(reminderDue(withReminder, new Date('2026-11-20T12:30:00Z'))).toBe(true);
    expect(reminderDue({ ...withReminder, status: 'cancelled' }, new Date('2026-11-20T12:30:00Z'))).toBe(false);
    expect(reminderDue(withReminder, new Date('2026-11-20T13:31:00Z'))).toBe(false);
  });

  it('rejects nonexistent local times and chooses the earliest repeated time', () => {
    expect(appointmentInstant({ ...draft, date: '2026-03-08', time: '02:30', timeZone: 'America/New_York' })).toBeNull();
    expect(appointmentInstant({ ...draft, date: '2026-11-01', time: '01:30', timeZone: 'America/New_York' })?.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });
});
