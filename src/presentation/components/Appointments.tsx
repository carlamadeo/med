import type {VNode} from 'preact';
import {useState} from 'preact/hooks';
import {appointmentStatus} from '@domain/appointments';
import {normalize} from '@domain/utils';
import type {Appointment} from '@domain/models';
import {setEditingAppointment, setEditingConsultation, visibleAppointments} from '../state/store';
import {deleteAppointment as removeAppointment} from '../utils/appointmentEditor';
import {AppointmentStudies} from './AppointmentStudies';
import {AppointmentPrescriptionDownload} from './AppointmentPrescriptionDownload';
import {ConfirmActionDialog} from './ConfirmActionDialog';
import {MedicalEvents} from './MedicalEvents';

export function Appointments() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Appointment | null>(null);

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

  const normalizedQuery = normalize(query);
  const visible = [...visibleAppointments.value]
    .filter(appointment => {
      if (!normalizedQuery) return true;
      return [appointment.date, appointment.time, appointment.professional, appointment.specialty,
        appointment.location, appointment.reason, appointment.notes, appointment.prescription?.name,
        appointment.prescription ? 'receta' : '',
        appointment.status === 'completed' ? 'consulta' : 'turno'].some(
        value => normalize(value ?? '').includes(normalizedQuery)
      );
    })
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));

  return (
    <section className="appointments" aria-labelledby="appointments-title">
      <div className="appointments-head">
        <div>
          <p className="eyebrow">Seguimiento</p>
          <h2 id="appointments-title">Turnos, consultas y recetas</h2>
          <p className="appointments-desc">
            Agendá un turno y, después de la consulta, guardá las notas y la receta.
          </p>
        </div>
        <div className="appointments-head-actions">
          <span className="count-badge">{visibleAppointments.value.length}</span>
          <button className="button primary" type="button" onClick={() => setEditingAppointment(null)}>
            <svg className="icon" aria-hidden="true">
              <use href="#i-plus" />
            </svg>
            Nuevo turno
          </button>
        </div>
      </div>

      <div className="appointments-toolbar">
        <label className="appointments-search">
          <svg className="icon" aria-hidden="true">
            <use href="#i-search" />
          </svg>
          <span className="sr-only">Buscar turnos, consultas y recetas</span>
          <input
            id="appointment-search"
            type="search"
            placeholder="Buscar turnos o consultas…"
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
            const renderCard = (studyList: VNode | null, prepareAction: VNode | null) => (
              <li className="appointment-card">
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
                  <p className="appointment-card-meta">{item.time}</p>
                  {item.specialty && <p className="event-specialty">{item.specialty}</p>}
                  {item.location && <p className="appointment-location">{item.location}</p>}
                  {item.reason && <p className="appointment-notes">Motivo: {item.reason}</p>}
                  {item.notes && <p className="appointment-notes">{item.notes}</p>}
                  {item.prescription && <AppointmentPrescriptionDownload appointment={item} />}
                  {studyList}
                  {(item.cost !== null || item.coverage) && (
                    <div className="appointment-tags">
                      {item.cost !== null && (
                        <span className="tag">
                          Importe: ${item.cost.toLocaleString('es-AR', {maximumFractionDigits: 2})}
                        </span>
                      )}
                      {item.coverage && (
                        <span className="tag">
                          Cobertura:{' '}
                          {item.coverage === 'all'
                            ? 'Total'
                            : item.coverage === 'partial'
                              ? 'Parcial'
                              : 'Sin cobertura'}
                        </span>
                      )}
                    </div>
                  )}
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
                  {prepareAction}
                  <button
                    className="button ghost button-sm"
                    type="button"
                    disabled={Boolean(item.syncStatus)}
                    onClick={() => setEditingAppointment(item)}
                  >
                    Editar turno
                  </button>
                  {status !== 'upcoming' && (
                    <button className="button secondary button-sm" type="button"
                            disabled={Boolean(item.syncStatus)}
                            onClick={() => setEditingConsultation(item)}>
                      {status === 'overdue' ? 'Registrar consulta' : 'Editar consulta'}
                    </button>
                  )}
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
            return <AppointmentStudies key={item.id} studyIds={item.studyIds} renderCard={renderCard} />;
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
            <button className="button secondary" type="button" onClick={() => setQuery('')}>
              Limpiar búsqueda
            </button>
          ) : (
            <button
              className="button secondary"
              type="button"
              onClick={() => setEditingAppointment(null)}
            >
              Agendar primer turno
            </button>
          )}
        </div>
      )}

      <MedicalEvents query={normalizedQuery} />

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
