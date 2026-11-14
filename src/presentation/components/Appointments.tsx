import {useState} from 'preact/hooks';
import {appointmentStatus} from '@domain/appointments';
import {normalize} from '@domain/utils';
import type {Appointment, AppointmentDraft} from '@domain/models';
import {visibleAppointments} from '../state/store';
import {deleteAppointment as removeAppointment, saveAppointment} from '../utils/appointmentEditor';


export function Appointments() {
    const [editing, setEditing] = useState<Appointment | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [permission, setPermission] = useState(() => typeof Notification === 'undefined' ? 'unavailable' : Notification.permission);
    const [query, setQuery] = useState('');

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
            reminderMinutes: (Number(data.get('reminderMinutes')) || null) as AppointmentDraft['reminderMinutes'],
        };
        setBusy(true);
        setMessage('');
        try {
            const result = await saveAppointment(draft, editing);
            if (result.error) {
                setMessage(result.error);
                return;
            }
            if (result.message) {
                setMessage(result.message);
            } else {
                form.reset();
            }
            setEditing(null);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'No se pudo guardar el turno.');
        } finally {
            setBusy(false);
        }
    }

    async function remove(appointment: Appointment) {
        if (!confirm(`Eliminar el turno del ${appointment.date} a las ${appointment.time}?`)) return;
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
        }
    }

    const normalizedQuery = normalize(query);
    const visible = [...visibleAppointments.value]
        .filter((appointment) => {
            if (!normalizedQuery) return true;
            return [appointment.date, appointment.time, appointment.professional, appointment.notes]
                .some((value) => normalize(value ?? '').includes(normalizedQuery));
        })
        .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));

    return <section className="appointments" aria-labelledby="appointments-title">
        <div className="appointments-head">
            <div>
                <p className="eyebrow">Seguimiento</p>
                <p className="appointments-desc">Turnos médicos, profesionales y costos en un solo lugar.</p>
            </div>
            <div className="appointments-head-actions">
                <span className="count-badge">{visibleAppointments.value.length}</span>
                <button className="button secondary" type="button" onClick={() => {
                    setEditing(null);
                    document.querySelector<HTMLInputElement>('.appointments input[name="date"]')?.focus();
                }}>Nuevo turno
                </button>
            </div>
        </div>

        <h2 id="appointments-title">Turnos médicos</h2>
        <form key={editing?.id ?? 'new'} className="appointments-form" onSubmit={(event) => {
            event.preventDefault();
            void save(event.currentTarget);
        }}>
            <fieldset disabled={busy}>
                <legend>{editing ? 'Editar turno' : 'Nuevo turno'}</legend>
                <div className="appointment-form-grid">
                    <label>Fecha <input name="date" type="date" required defaultValue={editing?.date ?? ''}/></label>
                    <label>Hora <input name="time" type="time" required defaultValue={editing?.time ?? ''}/></label>
                    <label className="wide">Zona horaria <input name="timeZone" required
                                                                defaultValue={editing?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}/></label>
                    <label className="wide">Profesional <input name="professional"
                                                               defaultValue={editing?.professional ?? ''}/></label>
                    <label className="wide">Detalles <textarea name="notes"
                                                               defaultValue={editing?.notes ?? ''}/></label>
                    <label>Estado <select name="status" defaultValue={editing?.status ?? 'scheduled'}>
                        <option value="scheduled">Programado</option>
                        <option value="completed">Realizado</option>
                        <option value="cancelled">Cancelado</option>
                        <option value="absent">No asistí</option>
                    </select></label>
                    <label>Recordatorio <select name="reminderMinutes"
                                                defaultValue={String(editing?.reminderMinutes ?? '')}>
                        <option value="">Sin recordatorio</option>
                        <option value="1440">24 horas antes</option>
                        <option value="60">1 hora antes</option>
                        <option value="15">15 minutos antes</option>
                    </select></label>
                    <label>Importe <input name="cost" type="number" min="0" step="0.01"
                                          defaultValue={editing?.cost ?? ''}/></label>
                    <label>Cobertura <select name="coverage" defaultValue={editing?.coverage ?? ''}>
                        <option value="">Desconocida</option>
                        <option value="all">Total</option>
                        <option value="partial">Parcial</option>
                        <option value="none">Sin cobertura</option>
                    </select></label>
                </div>
                <p className="appointment-note">Los avisos requieren la aplicación abierta, una sesión activa y el turno
                    sincronizado.
                    Permiso: {permission === 'granted' ? 'concedido' : permission === 'denied' ? 'denegado' : permission === 'unavailable' ? 'no disponible' : 'pendiente'}.</p>
                {(!navigator.locks || !navigator.serviceWorker?.controller) &&
                    <p className="appointment-note" role="status">Los avisos no están disponibles en este navegador o
                        todavía se está iniciando la aplicación.</p>}
                {permission === 'default' &&
                    <button className="button secondary button-sm" type="button" onClick={() => {
                        void Notification.requestPermission().then(setPermission);
                    }}>Activar notificaciones</button>}
                <div className="dialog-actions">
                    {editing && <button className="button quiet" type="button" onClick={() => setEditing(null)}>Cancelar
                        edición</button>}
                    <button className="button primary" type="submit">Guardar turno</button>
                </div>
            </fieldset>
        </form>

        <div className="appointments-toolbar">
            <label className="appointments-search">
                <svg className="icon">
                    <use href="#i-search"/>
                </svg>
                <span className="sr-only">Buscar turnos</span>
                <input id="appointment-search" type="search" placeholder="Buscar por profesional, nota o fecha…"
                       value={query}
                       onInput={(event) => setQuery((event.target as HTMLInputElement).value)}/>
            </label>
        </div>

        {message && <p className="appointment-message" role="status">{message}</p>}

        {visible.length ? (
            <ul id="appointments-list" className="appointment-list">
                {visible.map((item) => {
                    const status = appointmentStatus(item, new Date());
                    const statusLabel = status === 'upcoming' ? 'Próximo' : status === 'overdue' ? 'Vencido' : status === 'completed' ? 'Realizado' : status === 'cancelled' ? 'Cancelado' : 'No asistí';
                    const tone = status === 'upcoming' ? 'primary' : status === 'overdue' ? 'warning' : status === 'completed' ? 'success' : 'neutral';
                    const [year, month, day] = item.date.split('-').map(Number);
                    const monthLabel = year && month ? new Intl.DateTimeFormat('es-AR', {month: 'short'}).format(new Date(year, month - 1, 1)).replace('.', '') : '';
                    const syncLabel = item.syncStatus === 'conflict' ? 'Requiere revisión' : item.syncStatus === 'pending' ? 'Pendiente de sincronización' : item.syncStatus === 'failed' ? 'No se puede sincronizar' : '';
                    return <li className="appointment-card" key={item.id}>
                        <div className="appointment-date" aria-label={`${day ?? ''} de ${monthLabel}`}>
                            <span>{monthLabel || '—'}</span>
                            <strong>{day ?? '—'}</strong>
                        </div>
                        <div className="appointment-card-body">
                            <div className="appointment-card-top">
                                <h3>{item.professional || 'Turno médico'}</h3>
                                <span className="status-pill" data-tone={tone}>{statusLabel}</span>
                            </div>
                            <p className="appointment-card-meta">{item.time} · {item.timeZone}</p>
                            {item.notes && <p className="appointment-notes">{item.notes}</p>}
                            <div className="appointment-tags">
                                <span className="tag">Importe: {item.cost === null ? 'Desconocido' : item.cost}</span>
                                <span
                                    className="tag">Cobertura: {item.coverage === 'all' ? 'Total' : item.coverage === 'partial' ? 'Parcial' : item.coverage === 'none' ? 'Sin cobertura' : 'Desconocida'}</span>
                                {item.reminderMinutes && <span
                                    className="tag">Recordatorio: {item.reminderMinutes === 1440 ? '24 horas' : item.reminderMinutes === 60 ? '1 hora' : '15 minutos'} antes</span>}
                            </div>
                            {syncLabel && <span className="status-pill"
                                                data-tone={item.syncStatus === 'conflict' ? 'danger' : 'warning'}>{syncLabel}</span>}
                        </div>
                        <div className="appointment-actions">
                            <button className="button ghost button-sm" type="button" disabled={Boolean(item.syncStatus)}
                                    onClick={() => setEditing(item)}>Editar
                            </button>
                            <button className="button ghost button-sm appointment-delete" type="button"
                                    disabled={Boolean(item.syncStatus)} onClick={() => remove(item)}>Eliminar
                            </button>
                        </div>
                    </li>;
                })}
            </ul>
        ) : (
            <div className="appointment-empty">
                <span className="appointment-empty-icon"><svg className="icon"><use href="#i-calendar"/></svg></span>
                <p>{normalizedQuery ? 'No hay turnos que coincidan con la búsqueda.' : 'Todavía no hay turnos guardados.'}</p>
                {normalizedQuery &&
                    <button className="button secondary button-sm" type="button" onClick={() => setQuery('')}>Limpiar
                        búsqueda</button>}
            </div>
        )}
    </section>;
}
