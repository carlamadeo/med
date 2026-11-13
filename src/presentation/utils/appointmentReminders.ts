import { driveAuth } from '@data';
import { reminderDue } from '@domain/appointments';
import { visibleAppointments } from '../state/store';

export async function checkAppointmentReminders(): Promise<void> {
  const owner = driveAuth.cachedAccountId();
  if (!owner || typeof Notification === 'undefined' || Notification.permission !== 'granted' || !navigator.locks || !navigator.serviceWorker?.controller) return;
  const token = await driveAuth.getAccessToken();
  await navigator.locks.request(`mis-estudios-reminders:${owner}`, async () => {
    if (driveAuth.cachedAccountId() !== owner || await driveAuth.getAccessToken() !== token) return;
    for (const appointment of visibleAppointments.value) {
      if (appointment.syncStatus || !reminderDue(appointment, new Date())) continue;
      const key = `mis-estudios:reminder:${owner}:${appointment.id}:${appointment.date}:${appointment.time}:${appointment.timeZone}:${appointment.reminderMinutes}`;
      if (localStorage.getItem(key)) continue;
      const registration = await navigator.serviceWorker.ready;
      if (driveAuth.cachedAccountId() !== owner || await driveAuth.getAccessToken() !== token) return;
      const current = visibleAppointments.value.find(item => item.id === appointment.id);
      if (!current || current.syncStatus || !reminderDue(current, new Date()) || current.date !== appointment.date || current.time !== appointment.time || current.timeZone !== appointment.timeZone || current.reminderMinutes !== appointment.reminderMinutes) continue;
      await registration.showNotification('Recordatorio de turno', { body: 'Tenés un turno próximo. Abrí Mis estudios para consultar los detalles.' });
      localStorage.setItem(key, 'shown');
    }
  });
}
