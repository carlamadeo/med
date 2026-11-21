import type {Appointment, AppointmentDraft} from './models';
import {isValidDate} from './utils';

export function validateAppointment(appointment: AppointmentDraft): string[] {
    const errors: string[] = [];
    if (!isValidDate(appointment.date)) errors.push('Ingresá una fecha válida.');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(appointment.time)) errors.push('Ingresá una hora válida.');
    try {
        new Intl.DateTimeFormat('es', {timeZone: appointment.timeZone});
    } catch {
        errors.push('Ingresá una zona horaria válida.');
    }
    if (appointment.cost !== null && (!Number.isFinite(appointment.cost) || appointment.cost < 0)) errors.push('Ingresá un importe válido.');
    if (appointment.reminderMinutes != null && ![15, 60, 1440].includes(appointment.reminderMinutes)) errors.push('Elegí un recordatorio válido.');
    if (appointment.studyIds !== undefined && (!Array.isArray(appointment.studyIds) ||
        appointment.studyIds.some(id => typeof id !== 'string' || !/^[\w-]+$/.test(id)))) {
        errors.push('Revisá los estudios vinculados al turno.');
    }
    return errors;
}

export function appointmentInstant(appointment: AppointmentDraft): Date | null {
    if (validateAppointment(appointment).length) return null;
    const [year, month, day] = appointment.date.split('-').map(Number);
    const [hour, minute] = appointment.time.split(':').map(Number);
    const wall = Date.UTC(year!, month! - 1, day!, hour!, minute!);
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: appointment.timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    });
    const localValue = (instant: number) => {
        const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, Number(part.value)]));
        return Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!);
    };
    const offsets = [-86400000, 0, 86400000].map(delta => localValue(wall + delta) - (wall + delta));
    const matches = offsets.map(offset => wall - offset).filter(instant => localValue(instant) === wall);
    return matches.length ? new Date(Math.min(...matches)) : null;
}

export function cleanLocation(value: unknown): string | undefined {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') || undefined : undefined;
}

const BASE32HEX = '0123456789abcdefghijklmnopqrstuv';

export async function googleCalendarEventId(appointmentId: string): Promise<string> {
    const bytes = new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mis-estudios:gcal:${appointmentId}`)),
    );
    let bits = 0;
    let value = 0;
    let out = '';
    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            out += BASE32HEX[(value >>> bits) & 31]!;
        }
    }
    if (bits > 0) out += BASE32HEX[(value << (5 - bits)) & 31]!;
    return out;
}

export function googleCalendarReminderMinutes(appointment: AppointmentDraft): number[] {
    const start = appointmentInstant(appointment);
    if (!start) return [];
    const [year, month, day] = appointment.date.split('-').map(Number);
    if (!year || !month || !day) return [];
    const seen = new Set<number>();
    const result: number[] = [];
    for (const deltaDays of [-7, -1]) {
        const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
        const targetDate = shifted.toISOString().slice(0, 10);
        const target = appointmentInstant({...appointment, date: targetDate, time: '11:00'});
        if (!target) continue;
        const minutes = Math.round((start.getTime() - target.getTime()) / 60_000);
        if (Number.isInteger(minutes) && minutes >= 0 && minutes <= 40_320 && !seen.has(minutes)) {
            seen.add(minutes);
            result.push(minutes);
        }
    }
    return result;
}

export interface GoogleCalendarEventPayload {
    id: string;
    status: 'confirmed';
    summary: string;
    location: string;
    description: string;
    start: {dateTime: string; timeZone: string};
    end: {dateTime: string; timeZone: string};
    reminders: {
        useDefault: false;
        overrides: Array<{method: 'popup'; minutes: number}>;
    };
}

export function buildGoogleCalendarEvent(
    appointment: Appointment,
    eventId: string,
): GoogleCalendarEventPayload {
    const start = appointmentInstant(appointment);
    if (!start) {
        throw new Error('El turno no tiene una fecha y hora válidas.');
    }
    const end = new Date(start.getTime() + 30 * 60_000);
    const location = cleanLocation(appointment.location);
    const specialty = appointment.specialty?.trim() || undefined;
    const notes = appointment.notes.trim();
    const descriptionLines = [
        specialty ? `Especialidad: ${specialty}` : '',
        location ? `Lugar: ${location}` : '',
        notes ? `Notas: ${notes}` : '',
    ].filter(Boolean);

    return {
        id: eventId,
        status: 'confirmed',
        summary: appointment.professional.trim() || 'Turno médico',
        location: location ?? '',
        description: descriptionLines.join('\n'),
        start: {dateTime: start.toISOString(), timeZone: appointment.timeZone},
        end: {dateTime: end.toISOString(), timeZone: appointment.timeZone},
        reminders: {
            useDefault: false,
            overrides: googleCalendarReminderMinutes(appointment).map((minutes) => ({
                method: 'popup',
                minutes,
            })),
        },
    };
}

export function appointmentStatus(appointment: AppointmentDraft, now: Date): 'upcoming' | 'overdue' | 'completed' | 'cancelled' | 'absent' {
    if (appointment.status !== 'scheduled') return appointment.status;
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: appointment.timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    });
    const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
    const localNow = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    return localNow > `${appointment.date}T${appointment.time}` ? 'overdue' : 'upcoming';
}
