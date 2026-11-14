import {useState} from 'preact/hooks';
import {appointmentStatus} from '@domain/appointments';
import type {Appointment, AppointmentDraft} from '@domain/models';
import {visibleAppointments} from '../state/store';
import {deleteAppointment as removeAppointment, saveAppointment} from '../utils/appointmentEditor';
const labels = {
    upcoming: 'Próximo',
    overdue: 'Vencido',
    completed: 'Realizado',
    cancelled: 'Cancelado',
    absent: 'No asistí'
};

export function Appointments() {
    const [editing, setEditing] = useState<Appointment | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [permission, setPermission] = useState(() => typeof Notification === 'undefined' ? 'unavailable' : Notification.permission);

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

    return <section className="directory" aria-labelledby="appointments-title">
        <h2 id="appointments-title">Turnos médicos</h2>
        <form key={editing?.id ?? 'new'} onSubmit={event => {
            event.preventDefault();
            void save(event.currentTarget);
        }}>
            <fieldset disabled={busy}>
                <legend>{editing ? 'Editar turno' : 'Nuevo turno'}</legend>
                <label>Fecha <input name="date" type="date" required defaultValue={editing?.date ?? ''}/></label>
                <label>Hora <input name="time" type="time" required defaultValue={editing?.time ?? ''}/></label>
                <label>Zona horaria <input name="timeZone" required
                                           defaultValue={editing?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}/></label>
                <label>Profesional <input name="professional" defaultValue={editing?.professional ?? ''}/></label>
                <label>Detalles <textarea name="notes" defaultValue={editing?.notes ?? ''}/></label>
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
                <p>Los avisos requieren la aplicación abierta, una sesión activa y el turno sincronizado.
                    Permiso: {permission === 'granted' ? 'concedido' : permission === 'denied' ? 'denegado' : permission === 'unavailable' ? 'no disponible' : 'pendiente'}.</p>
                {(!navigator.locks || !navigator.serviceWorker?.controller) &&
                    <p role="status">Los avisos no están disponibles en este navegador o todavía se está iniciando la
                        aplicación.</p>}
                {permission === 'default' && <button type="button" onClick={() => {
                    void Notification.requestPermission().then(setPermission);
                }}>Activar notificaciones</button>}
                <label>Importe <input name="cost" type="number" min="0" step="0.01" defaultValue={editing?.cost ?? ''}/></label>
                <label>Cobertura <select name="coverage" defaultValue={editing?.coverage ?? ''}>
                    <option value="">Desconocida</option>
                    <option value="all">Total</option>
                    <option value="partial">Parcial</option>
                    <option value="none">Sin cobertura</option>
                </select></label>
                <button className="button primary" type="submit">Guardar turno</button>
                {editing && <button type="button" onClick={() => setEditing(null)}>Cancelar edición</button>}
            </fieldset>
        </form>
        {message && <p role="status">{message}</p>}
        <ul>{[...visibleAppointments.value].sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`)).map(item =>
            <li key={item.id}>
                <h3>{item.date} · {item.time}</h3><p>{labels[appointmentStatus(item, new Date())]} · {item.timeZone}</p>
                {item.professional && <p>{item.professional}</p>}{item.notes && <p>{item.notes}</p>}
                {item.reminderMinutes &&
                    <p>Recordatorio: {item.reminderMinutes === 1440 ? '24 horas' : item.reminderMinutes === 60 ? '1 hora' : '15 minutos'} antes</p>}
                <p>Importe: {item.cost === null ? 'Desconocido' : item.cost} ·
                    Cobertura: {item.coverage === 'all' ? 'Total' : item.coverage === 'partial' ? 'Parcial' : item.coverage === 'none' ? 'Sin cobertura' : 'Desconocida'}</p>
                {item.syncStatus &&
                    <p>{item.syncStatus === 'conflict' ? 'Requiere revisión' : 'Pendiente de sincronización'}</p>}
                <button type="button" disabled={Boolean(item.syncStatus)} onClick={() => setEditing(item)}>Editar
                </button>
                <button type="button" disabled={Boolean(item.syncStatus)}
                        onClick={() => remove(item)}>Eliminar
                </button>
            </li>)}</ul>
    </section>;
}
