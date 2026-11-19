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

export async function createAppointmentCalendar(
    appointment: Appointment,
    reminder: 15 | 60 | 1440 | null,
    now = new Date(),
): Promise<string> {
    const start = appointmentInstant(appointment);
    if (!start || appointment.status !== 'scheduled' || appointment.syncStatus) {
        throw new Error('El turno no está disponible para exportar.');
    }
    const utc = (date: Date) => date.toISOString().replace(/[-:]|\.\d{3}/g, '');
    const bytes = new TextEncoder().encode(`mis-estudios:calendar:${appointment.id}`);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    const id = Array.from(new Uint8Array(hash, 0, 16), byte => byte.toString(16).padStart(2, '0')).join('');
    const alarm = reminder ? [
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `TRIGGER:${reminder === 1440 ? '-P1D' : `-PT${reminder}M`}`,
        'DESCRIPTION:Recordatorio de turno',
        'END:VALARM',
    ] : [];
    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Mis estudios//Calendario//ES',
        'BEGIN:VEVENT',
        `UID:${id}@mis-estudios`,
        `DTSTAMP:${utc(now)}`,
        `DTSTART:${utc(start)}`,
        'SUMMARY:Turno',
        'CLASS:PRIVATE',
        ...alarm,
        'END:VEVENT',
        'END:VCALENDAR',
        '',
    ].join('\r\n');
}

export function reminderDue(appointment: AppointmentDraft, now: Date): boolean {
    if (appointment.status !== 'scheduled' || !appointment.reminderMinutes) return false;
    const instant = appointmentInstant(appointment)?.getTime();
    return instant !== undefined && now.getTime() >= instant - appointment.reminderMinutes * 60000 && now.getTime() < instant;
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
