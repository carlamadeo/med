import type { AppointmentDraft } from './models';
import { isValidDate } from './utils';

export function validateAppointment(appointment: AppointmentDraft): string[] {
  const errors: string[] = [];
  if (!isValidDate(appointment.date)) errors.push('Ingresá una fecha válida.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(appointment.time)) errors.push('Ingresá una hora válida.');
  try { new Intl.DateTimeFormat('es', { timeZone: appointment.timeZone }); }
  catch { errors.push('Ingresá una zona horaria válida.'); }
  if (appointment.cost !== null && (!Number.isFinite(appointment.cost) || appointment.cost < 0)) errors.push('Ingresá un importe válido.');
  if (appointment.reminderMinutes != null && ![15, 60, 1440].includes(appointment.reminderMinutes)) errors.push('Elegí un recordatorio válido.');
  return errors;
}

export function appointmentInstant(appointment: AppointmentDraft): Date | null {
  if (validateAppointment(appointment).length) return null;
  const [year, month, day] = appointment.date.split('-').map(Number);
  const [hour, minute] = appointment.time.split(':').map(Number);
  const wall = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: appointment.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const localValue = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, Number(part.value)]));
    return Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!);
  };
  const offsets = [-86400000, 0, 86400000].map(delta => localValue(wall + delta) - (wall + delta));
  const matches = offsets.map(offset => wall - offset).filter(instant => localValue(instant) === wall);
  return matches.length ? new Date(Math.min(...matches)) : null;
}

export function reminderDue(appointment: AppointmentDraft, now: Date): boolean {
  if (appointment.status !== 'scheduled' || !appointment.reminderMinutes) return false;
  const instant = appointmentInstant(appointment)?.getTime();
  return instant !== undefined && now.getTime() >= instant - appointment.reminderMinutes * 60000 && now.getTime() < instant;
}

export function appointmentStatus(appointment: AppointmentDraft, now: Date): 'upcoming' | 'overdue' | 'completed' | 'cancelled' | 'absent' {
  if (appointment.status !== 'scheduled') return appointment.status;
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: appointment.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
  const localNow = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  return localNow > `${appointment.date}T${appointment.time}` ? 'overdue' : 'upcoming';
}
