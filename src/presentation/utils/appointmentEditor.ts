import { driveAppointmentRepo, driveAuth } from '@data';
import { Outbox } from '@data/outbox';
import { appointmentInstant, validateAppointment } from '@domain/appointments';
import type { Appointment, AppointmentDraft } from '@domain/models';
import { appointments } from '../state/store';
import { enqueueOffline } from './enqueueOffline';

const outbox = new Outbox();

interface AppointmentSaveResult {
  appointment?: Appointment;
  message?: string;
  error?: string;
}

interface AppointmentDeleteResult {
  message?: string;
  error?: string;
}

export async function saveAppointment(draft: AppointmentDraft, editing: Appointment | null): Promise<AppointmentSaveResult> {
  const validation = validateAppointment(draft);
  if (validation.length) return { error: validation[0]! };
  if (!appointmentInstant(draft)) return { error: 'La hora elegida no existe en esa zona horaria.' };

  const token = await driveAuth.getAccessToken();
  if (!token) return { error: 'Conectate primero para guardar un turno.' };
  const accountId = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
  if (!accountId) return { error: 'Conectate primero para verificar tu cuenta.' };

  if (!navigator.onLine) {
    if (!navigator.locks) return { error: 'Este navegador no admite la sincronización segura de cambios sin conexión.' };
    await enqueueOffline(accountId, () => outbox.enqueueAppointmentSave(accountId, draft), token);
    if (await driveAuth.getAccessToken() !== token) {
      return { message: 'La cuenta cambió mientras se guardaba. El turno quedó retenido con la cuenta anterior.' };
    }
    window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
    return { message: editing ? 'Cambios guardados en este dispositivo, pendientes de sincronización.' : 'Turno guardado en este dispositivo, pendiente de sincronización.' };
  }

  if (draft.id) {
    const entries = await outbox.list(accountId);
    const pending = entries.find((entry) => entry.appointmentId === draft.id);
    if (pending) return { error: pending.lastError || 'Este turno ya tiene un cambio pendiente. Sincronizalo o descartalo antes de editarlo.' };
  }

  if (await driveAuth.getAccessToken() !== token) return { error: 'La cuenta cambió. Volvé a intentar.' };

  const saved = await driveAppointmentRepo.save(draft);
  if (await driveAuth.getAccessToken() !== token) return {};
  appointments.value = [...appointments.value.filter((item) => item.id !== saved.id), saved];
  return { appointment: saved };
}

export async function deleteAppointment(appointment: Appointment): Promise<AppointmentDeleteResult> {
  if (!appointment.revision) return { error: 'No se encontró el turno remoto.' };
  const token = await driveAuth.getAccessToken();
  if (!token) return { error: 'Conectate primero para borrar un turno.' };
  const accountId = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
  if (!accountId) return { error: 'Conectate primero para verificar tu cuenta.' };

  if (!navigator.onLine) {
    if (!navigator.locks) return { error: 'Este navegador no admite la sincronización segura de cambios sin conexión.' };
    await enqueueOffline(accountId, () => outbox.enqueueAppointmentDelete(accountId, appointment.id, appointment.revision), token);
    if (await driveAuth.getAccessToken() !== token) {
      return { message: 'La cuenta cambió mientras se borraba. El turno quedó retenido con la cuenta anterior.' };
    }
    window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
    return { message: 'Turno borrado en este dispositivo, pendiente de sincronización.' };
  }

  const entries = await outbox.list(accountId);
  const pendingSave = entries.find((entry) => entry.appointmentId === appointment.id);
  if (pendingSave) return { error: pendingSave.lastError || 'Este turno tiene un cambio pendiente. Sincronizalo o descartalo antes de borrarlo.' };

  if (await driveAuth.getAccessToken() !== token) return { error: 'La cuenta cambió. Volvé a intentar.' };
  const driveId = appointment.id;
  await driveAppointmentRepo.delete(appointment.id, appointment.revision);
  if (await driveAuth.getAccessToken() !== token) return {};
  appointments.value = appointments.value.filter((item) => item.id !== driveId);
  return {};
}

