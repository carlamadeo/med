import { useEffect, useRef, useState } from 'preact/hooks';
import { validateAppointment } from '@domain/appointments';
import type { Appointment, AppointmentDraft } from '@domain/models';
import { driveAuth } from '@data';
import { editingAppointment, isAppointmentEditorOpen, setAppointmentEditorOpen } from '../state/store';
import { deleteAppointment, saveAppointment } from '../utils/appointmentEditor';

function parseCost(value: FormDataEntryValue | null): number | null {
  const raw = typeof value === 'string' ? value.trim().replace(',', '.') : '';
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseReminder(value: FormDataEntryValue | null): 15 | 60 | 1440 | null {
  if (value === '15' || value === '60' || value === '1440') return Number(value) as 15 | 60 | 1440;
  return null;
}

export function AppointmentDialog() {
  const appointment = editingAppointment.value;
  const open = isAppointmentEditorOpen.value;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    setMessage('');
    setError(null);
    setBusy(false);
    if ('Notification' in window) setPermission(Notification.permission);
  }, [open, appointment]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => setAppointmentEditorOpen(false);
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, []);

  const close = () => {
    if (dialogRef.current?.open) dialogRef.current.close();
    setAppointmentEditorOpen(false);
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const draft: AppointmentDraft = {
      id: appointment?.id,
      revision: appointment?.revision,
      date: String(data.get('date') ?? ''),
      time: String(data.get('time') ?? ''),
      timeZone: String(data.get('timeZone') ?? ''),
      professional: String(data.get('professional') ?? ''),
      notes: String(data.get('notes') ?? ''),
      status: (data.get('status') as Appointment['status']) ?? 'scheduled',
      cost: parseCost(data.get('cost')),
      coverage: (data.get('coverage') as Appointment['coverage'] | '') || null,
      reminderMinutes: parseReminder(data.get('reminder')),
    };
    const validation = validateAppointment(draft);
    if (validation.length) {
      setError(validation[0] ?? 'Revisá los datos del turno.');
      return;
    }
    setBusy(true);
    setMessage('');
    setError(null);
    try {
      const result = await saveAppointment(draft, appointment);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.message) {
        setMessage(result.message);
        if (!result.appointment) return;
      }
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!appointment) return;
    if (!window.confirm(`¿Borrar el turno de ${appointment.professional || 'este profesional'}?`)) return;
    setBusy(true);
    setMessage('');
    setError(null);
    try {
      const result = await deleteAppointment(appointment);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.message) {
        setMessage(result.message);
        return;
      }
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const enableNotifications = async () => {
    if (!('Notification' in window)) {
      setPermission('unsupported');
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
  };

  return (
    <dialog
      ref={dialogRef}
      id="appointment-dialog"
      className="dialog appointment-dialog"
      aria-labelledby="appointment-dialog-title"
      onCancel={(event) => { if (busy) event.preventDefault(); }}
    >
      <form id="appointment-form" key={appointment?.id ?? 'new'} onSubmit={submit}>
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">Seguimiento</p>
            <h2 id="appointment-dialog-title">{appointment ? 'Editar turno' : 'Agendar turno'}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar" onClick={close} disabled={busy}>
            <svg className="icon"><use href="#i-close" /></svg>
          </button>
        </div>

        <div className="form-grid two">
          <label className="field">
            <span>Fecha</span>
            <input id="appointment-date" name="date" type="date" defaultValue={appointment?.date ?? ''} required disabled={busy} />
          </label>
          <label className="field">
            <span>Hora</span>
            <input id="appointment-time" name="time" type="time" defaultValue={appointment?.time ?? ''} required disabled={busy} />
          </label>
          <label className="field wide">
            <span>Zona horaria</span>
            <select id="appointment-timezone" name="timeZone" defaultValue={appointment?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone} disabled={busy}>
              <option value="America/Argentina/Buenos_Aires">Buenos Aires (GMT-3)</option>
              <option value="America/Argentina/Cordoba">Córdoba (GMT-3)</option>
              <option value="America/Argentina/Mendoza">Mendoza (GMT-3)</option>
              <option value="America/Montevideo">Montevideo (GMT-3)</option>
              <option value="America/Santiago">Santiago (GMT-3)</option>
              <option value="America/Sao_Paulo">São Paulo (GMT-3)</option>
              <option value="America/New_York">Nueva York (GMT-5)</option>
              <option value="Europe/Madrid">Madrid (GMT+1)</option>
              <option value="UTC">UTC</option>
            </select>
          </label>
          <label className="field wide">
            <span>Profesional</span>
            <input id="appointment-professional" name="professional" type="text" placeholder="Dra. Pérez" defaultValue={appointment?.professional ?? ''} disabled={busy} />
          </label>
          <label className="field">
            <span>Estado</span>
            <select id="appointment-status" name="status" defaultValue={appointment?.status ?? 'scheduled'} disabled={busy}>
              <option value="scheduled">Programado</option>
              <option value="completed">Realizado</option>
              <option value="cancelled">Cancelado</option>
              <option value="absent">No asistí</option>
            </select>
          </label>
          <label className="field">
            <span>Recordatorio</span>
            <select id="appointment-reminder" name="reminder" defaultValue={appointment?.reminderMinutes ? String(appointment.reminderMinutes) : ''} disabled={busy}>
              <option value="">Sin recordatorio</option>
              <option value="15">15 minutos antes</option>
              <option value="60">1 hora antes</option>
              <option value="1440">1 día antes</option>
            </select>
          </label>
          <label className="field">
            <span>Importe</span>
            <input id="appointment-cost" name="cost" type="number" min="0" step="0.01" placeholder="0,00" defaultValue={appointment?.cost ?? ''} disabled={busy} />
          </label>
          <label className="field">
            <span>Cobertura</span>
            <select id="appointment-coverage" name="coverage" defaultValue={appointment?.coverage ?? ''} disabled={busy}>
              <option value="">Sin especificar</option>
              <option value="all">Total</option>
              <option value="partial">Parcial</option>
              <option value="none">Ninguna</option>
            </select>
          </label>
          <label className="field wide">
            <span>Notas</span>
            <textarea id="appointment-notes" name="notes" placeholder="Estudio, indicaciones o comentarios" defaultValue={appointment?.notes ?? ''} disabled={busy} />
          </label>
        </div>

        {permission !== 'unsupported' && permission !== 'granted' && (
          <button className="button secondary" type="button" onClick={enableNotifications} disabled={busy}>
            Activar recordatorios del navegador
          </button>
        )}
        {permission === 'unsupported' && <p className="small-note">Este navegador no admite recordatorios del sistema.</p>}

        {message && <p className="form-message" role="status">{message}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {!navigator.locks && navigator.onLine && (
          <p className="small-note">Este navegador no expone Web Locks, necesario para sincronizar cambios entre pestañas.</p>
        )}
        {navigator.serviceWorker && !navigator.onLine && <p className="small-note">Guardado sin conexión: se sincronizará al recuperar la red.</p>}

        <div className="dialog-actions">
          {appointment && (
            <button className="button danger" type="button" onClick={remove} disabled={busy}>Borrar turno</button>
          )}
          <button className="button secondary" type="button" onClick={close} disabled={busy}>Cancelar</button>
          <button className="button primary" type="submit" disabled={busy || !driveAuth.configured}>
            {busy ? 'Guardando…' : 'Guardar turno'}
          </button>
        </div>
      </form>
    </dialog>
  );
}