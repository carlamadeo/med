import {useEffect, useRef, useState} from 'preact/hooks';
import {appointmentStatus} from '@domain/appointments';
import {normalize} from '@domain/utils';
import type {Appointment, AppointmentDraft} from '@domain/models';
import {visibleAppointments} from '../state/store';
import {deleteAppointment as removeAppointment, saveAppointment} from '../utils/appointmentEditor';
import {useFocusTrap} from '../utils/focusTrap';
import {AppointmentStudyList, AppointmentStudyPicker} from './AppointmentStudies';
import {ConfirmActionDialog} from './ConfirmActionDialog';

const TIMEZONE_OPTIONS: Array<{value: string; label: string}> = [
  {value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires (GMT-3)'},
  {value: 'America/Argentina/Cordoba', label: 'Córdoba (GMT-3)'},
  {value: 'America/Argentina/Mendoza', label: 'Mendoza (GMT-3)'},
  {value: 'America/Montevideo', label: 'Montevideo (GMT-3)'},
  {value: 'America/Santiago', label: 'Santiago (GMT-3)'},
  {value: 'America/Sao_Paulo', label: 'São Paulo (GMT-3)'},
  {value: 'America/Bogota', label: 'Bogotá (GMT-5)'},
  {value: 'America/Lima', label: 'Lima (GMT-5)'},
  {value: 'America/Mexico_City', label: 'Ciudad de México (GMT-6)'},
  {value: 'America/New_York', label: 'Nueva York (GMT-5)'},
  {value: 'Europe/Madrid', label: 'Madrid (GMT+1)'},
  {value: 'UTC', label: 'UTC'},
];

export function Appointments() {
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [permission, setPermission] = useState(() =>
    typeof Notification === 'undefined' ? 'unavailable' : Notification.permission
  );
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Appointment | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useFocusTrap(dialogRef, formOpen);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (formOpen && !dialog.open) {
      dialog.showModal();
    } else if (!formOpen && dialog.open) {
      dialog.close();
    }
  }, [formOpen]);

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(appointment: Appointment) {
    setEditing(appointment);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
  }

  async function save(form: HTMLFormElement) {
    const data = new FormData(form);
    const rawCost = String(data.get('cost') ?? '').trim();
    const draft: AppointmentDraft = {
      id: editing?.id,
      revision: editing?.revision,
      date: String(data.get('date') ?? ''),
      time: String(data.get('time') ?? ''),
      timeZone: String(data.get('timeZone') ?? ''),
      professional: String(data.get('professional') ?? '').trim(),
      notes: String(data.get('notes') ?? '').trim(),
      status: String(data.get('status')) as AppointmentDraft['status'],
      cost: rawCost ? Number(rawCost) : null,
      coverage: (String(data.get('coverage') ?? '') || null) as AppointmentDraft['coverage'],
      reminderMinutes: (Number(data.get('reminderMinutes')) ||
        null) as AppointmentDraft['reminderMinutes'],
      studyIds: data.getAll('studyId').map(String),
    };
    setBusy(true);
    setMessage('');
    try {
      const result = await saveAppointment(draft, editing);
      if (result.error) {
        setMessage(result.error);
        return;
      }
      if (result.message) setMessage(result.message);
      form.reset();
      closeForm();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo guardar el turno.');
    } finally {
      setBusy(false);
    }
  }

  function remove(appointment: Appointment) {
    setPendingDelete(appointment);
  }

  async function executeRemove(appointment: Appointment) {
    setBusy(true);
    setMessage('');
    try {
      const result = await removeAppointment(appointment);
      if (result.error) {
        setMessage(result.error);
        return;
      }
      if (result.message) {
        setMessage(result.message);
        return;
      }
      setMessage('Turno eliminado.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo eliminar el turno.');
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
  }

  const resolvedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Argentina/Buenos_Aires';
  const defaultTimeZone = editing?.timeZone ?? resolvedTimeZone;
  const timeZoneOptions = TIMEZONE_OPTIONS.some(option => option.value === defaultTimeZone)
    ? TIMEZONE_OPTIONS
    : [{value: defaultTimeZone, label: defaultTimeZone}, ...TIMEZONE_OPTIONS];

  const normalizedQuery = normalize(query);
  const visible = [...visibleAppointments.value]
    .filter(appointment => {
      if (!normalizedQuery) return true;
      return [appointment.date, appointment.time, appointment.professional, appointment.notes].some(
        value => normalize(value ?? '').includes(normalizedQuery)
      );
    })
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));

  return (
    <section className="appointments" aria-labelledby="appointments-title">
      <div className="appointments-head">
        <div>
          <p className="eyebrow">Seguimiento</p>
          <h2 id="appointments-title">Turnos médicos</h2>
          <p className="appointments-desc">
            Turnos médicos, profesionales y costos en un solo lugar.
          </p>
        </div>
        <div className="appointments-head-actions">
          <span className="count-badge">{visibleAppointments.value.length}</span>
          <button className="button primary" type="button" onClick={openNew}>
            <svg className="icon" aria-hidden="true">
              <use href="#i-plus" />
            </svg>
            Nuevo turno
          </button>
        </div>
      </div>

      <dialog
        ref={dialogRef}
        id="appointments-dialog"
        className="dialog appointment-dialog"
        aria-labelledby="appointments-dialog-title"
        onCancel={event => {
          event.preventDefault();
          if (!busy) closeForm();
        }}
        onClose={closeForm}
      >
        <form
          key={editing?.id ?? 'new'}
          className="appointments-form"
          onSubmit={event => {
            event.preventDefault();
            void save(event.currentTarget);
          }}
        >
          <div className="dialog-heading">
            <div>
              <p className="eyebrow">Seguimiento</p>
              <h2 id="appointments-dialog-title">
                {editing ? 'Editar turno' : 'Nuevo turno'}
              </h2>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Cerrar"
              onClick={closeForm}
              disabled={busy}
            >
              <svg className="icon" aria-hidden="true">
                <use href="#i-close" />
              </svg>
            </button>
          </div>
          <fieldset disabled={busy}>
            <legend className="sr-only">{editing ? 'Editar turno' : 'Nuevo turno'}</legend>
            <div className="appointment-form-grid">
              <label>
                Fecha <input name="date" type="date" required defaultValue={editing?.date ?? ''} />
              </label>
              <label>
                Hora <input name="time" type="time" required defaultValue={editing?.time ?? ''} />
              </label>
              <label className="wide">
                Zona horaria{' '}
                <select name="timeZone" required defaultValue={defaultTimeZone}>
                  {timeZoneOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wide">
                Profesional{' '}
                <input name="professional" defaultValue={editing?.professional ?? ''} />
              </label>
              <label className="wide">
                Detalles <textarea name="notes" defaultValue={editing?.notes ?? ''} />
              </label>
              <label>
                Estado{' '}
                <select name="status" defaultValue={editing?.status ?? 'scheduled'}>
                  <option value="scheduled">Programado</option>
                  <option value="completed">Realizado</option>
                  <option value="cancelled">Cancelado</option>
                  <option value="absent">No asistí</option>
                </select>
              </label>
              <label>
                Recordatorio{' '}
                <select
                  name="reminderMinutes"
                  defaultValue={String(editing?.reminderMinutes ?? '')}
                >
                  <option value="">Sin recordatorio</option>
                  <option value="1440">24 horas antes</option>
                  <option value="60">1 hora antes</option>
                  <option value="15">15 minutos antes</option>
                </select>
              </label>
              <label>
                Importe{' '}
                <input
                  name="cost"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={editing?.cost ?? ''}
                />
              </label>
              <label>
                Cobertura{' '}
                <select name="coverage" defaultValue={editing?.coverage ?? ''}>
                  <option value="">Desconocida</option>
                  <option value="all">Total</option>
                  <option value="partial">Parcial</option>
                  <option value="none">Sin cobertura</option>
                </select>
              </label>
            </div>
            <AppointmentStudyPicker studyIds={editing?.studyIds} />
            <p className="appointment-note">
              Los avisos requieren la aplicación abierta, una sesión activa y el turno sincronizado.
              Permiso:{' '}
              {permission === 'granted'
                ? 'concedido'
                : permission === 'denied'
                  ? 'denegado'
                  : permission === 'unavailable'
                    ? 'no disponible'
                    : 'pendiente'}
              .
            </p>
            {(!navigator.locks || !navigator.serviceWorker?.controller) && (
              <p className="appointment-note" role="status">
                Los avisos no están disponibles en este navegador o todavía se está iniciando la
                aplicación.
              </p>
            )}
            {permission === 'default' && (
              <button
                className="button secondary button-sm"
                type="button"
                onClick={() => {
                  void Notification.requestPermission().then(setPermission);
                }}
              >
                Activar notificaciones
              </button>
            )}
            <div className="dialog-actions">
              <button
                className="button secondary"
                type="button"
                onClick={closeForm}
                disabled={busy}
              >
                Cancelar
              </button>
              <button className="button primary" type="submit">
                {busy ? 'Guardando…' : 'Guardar turno'}
              </button>
            </div>
          </fieldset>
        </form>
      </dialog>

      <div className="appointments-toolbar">
        <label className="appointments-search">
          <svg className="icon" aria-hidden="true">
            <use href="#i-search" />
          </svg>
          <span className="sr-only">Buscar turnos</span>
          <input
            id="appointment-search"
            type="search"
            placeholder="Buscar por profesional, nota o fecha…"
            value={query}
            onInput={event => setQuery((event.target as HTMLInputElement).value)}
          />
        </label>
      </div>

      {message && (
        <p className="appointment-message" role="status">
          {message}
        </p>
      )}

      {visible.length ? (
        <ul id="appointments-list" className="appointment-list">
          {visible.map(item => {
            const status = appointmentStatus(item, new Date());
            const statusLabel =
              status === 'upcoming'
                ? 'Próximo'
                : status === 'overdue'
                  ? 'Vencido'
                  : status === 'completed'
                    ? 'Realizado'
                    : status === 'cancelled'
                      ? 'Cancelado'
                      : 'No asistí';
            const tone =
              status === 'upcoming'
                ? 'primary'
                : status === 'overdue'
                  ? 'warning'
                  : status === 'completed'
                    ? 'success'
                    : 'neutral';
            const [year, month, day] = item.date.split('-').map(Number);
            const monthLabel =
              year && month
                ? new Intl.DateTimeFormat('es-AR', {month: 'short'})
                    .format(new Date(year, month - 1, 1))
                    .replace('.', '')
                : '';
            const syncLabel =
              item.syncStatus === 'conflict'
                ? 'Requiere revisión'
                : item.syncStatus === 'pending'
                  ? 'Pendiente de sincronización'
                  : item.syncStatus === 'failed'
                    ? 'No se puede sincronizar'
                    : '';
            return (
              <li className="appointment-card" key={item.id}>
                <div className="appointment-date" aria-label={`${day ?? ''} de ${monthLabel}`}>
                  <span>{monthLabel || '—'}</span>
                  <strong>{day ?? '—'}</strong>
                </div>
                <div className="appointment-card-body">
                  <div className="appointment-card-top">
                    <h3>{item.professional || 'Turno médico'}</h3>
                    <span className="status-pill" data-tone={tone}>
                      {statusLabel}
                    </span>
                  </div>
                  <p className="appointment-card-meta">
                    {item.time} · {TIMEZONE_OPTIONS.find(option => option.value === item.timeZone)?.label ?? item.timeZone}
                  </p>
                  {item.notes && <p className="appointment-notes">{item.notes}</p>}
                  <AppointmentStudyList studyIds={item.studyIds} />
                  <div className="appointment-tags">
                    <span className="tag">
                      Importe: {item.cost === null ? 'Desconocido' : item.cost}
                    </span>
                    <span className="tag">
                      Cobertura:{' '}
                      {item.coverage === 'all'
                        ? 'Total'
                        : item.coverage === 'partial'
                          ? 'Parcial'
                          : item.coverage === 'none'
                            ? 'Sin cobertura'
                            : 'Desconocida'}
                    </span>
                    {item.reminderMinutes && (
                      <span className="tag">
                        Recordatorio:{' '}
                        {item.reminderMinutes === 1440
                          ? '24 horas'
                          : item.reminderMinutes === 60
                            ? '1 hora'
                            : '15 minutos'}{' '}
                        antes
                      </span>
                    )}
                  </div>
                  {syncLabel && (
                    <span
                      className="status-pill"
                      data-tone={item.syncStatus === 'conflict' ? 'danger' : 'warning'}
                    >
                      {syncLabel}
                    </span>
                  )}
                </div>
                <div className="appointment-actions">
                  <button
                    className="button ghost button-sm"
                    type="button"
                    disabled={Boolean(item.syncStatus)}
                    onClick={() => openEdit(item)}
                  >
                    Editar
                  </button>
                  <button
                    className="button ghost button-sm appointment-delete"
                    type="button"
                    disabled={Boolean(item.syncStatus)}
                    onClick={() => remove(item)}
                  >
                    Eliminar
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="appointment-empty">
          <span className="appointment-empty-icon">
            <svg className="icon" aria-hidden="true">
              <use href="#i-calendar" />
            </svg>
          </span>
          <p>
            {normalizedQuery
              ? 'No hay turnos que coincidan con la búsqueda.'
              : 'Todavía no hay turnos guardados.'}
          </p>
          {normalizedQuery ? (
            <button className="button secondary button-sm" type="button" onClick={() => setQuery('')}>
              Limpiar búsqueda
            </button>
          ) : (
            <button className="button secondary button-sm" type="button" onClick={openNew}>
              Nuevo turno
            </button>
          )}
        </div>
      )}

      <ConfirmActionDialog
        open={Boolean(pendingDelete)}
        title="Eliminar turno"
        message={
          pendingDelete
            ? `¿Eliminar el turno del ${pendingDelete.date} a las ${pendingDelete.time}?`
            : ''
        }
        confirmLabel="Eliminar turno"
        busy={busy}
        onConfirm={() => {
          if (pendingDelete) void executeRemove(pendingDelete);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}
