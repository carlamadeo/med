import {useEffect, useRef, useState} from 'preact/hooks';
import {createAppointmentCalendar} from '@domain/appointments';
import type {Appointment} from '@domain/models';
import {driveAuth} from '@data';
import {isSignedIn} from '../state/store';

export function AppointmentCalendar({appointment}: {appointment: Appointment}) {
    const [error, setError] = useState('');
    const active = useRef<Appointment | null>(appointment);
    useEffect(() => {
        active.current = appointment;
        return () => { active.current = null; };
    }, [appointment]);
    if (appointment.status !== 'scheduled' || appointment.syncStatus) return null;

    const download = async (value: FormDataEntryValue | null) => {
        setError('');
        const reminder = value === '15' ? 15 : value === '60' ? 60 : value === '1440' ? 1440 : null;
        const owner = driveAuth.cachedAccountId();
        try {
            const calendar = await createAppointmentCalendar(appointment, reminder);
            if (!isSignedIn.value || active.current !== appointment || driveAuth.cachedAccountId() !== owner) return;
            const url = URL.createObjectURL(new Blob([calendar], {type: 'text/calendar;charset=utf-8'}));
            const link = document.createElement('a');
            link.href = url;
            link.download = 'turno.ics';
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
        } catch {
            if (active.current === appointment) setError('No se pudo descargar el turno. Revisá la fecha y la zona horaria.');
        }
    };

    return (
        <details className="appointment-calendar">
            <summary>Agregar al calendario</summary>
            <form onSubmit={event => {
                event.preventDefault();
                void download(new FormData(event.currentTarget).get('calendarReminder'));
            }}>
                <label className="field">
                    <span>Aviso del calendario</span>
                    <select name="calendarReminder">
                        <option value="">Sin aviso</option>
                        <option value="15">15 minutos antes</option>
                        <option value="60">1 hora antes</option>
                        <option value="1440">24 horas antes</option>
                    </select>
                </label>
                <p className="appointment-note">Si reprogramás el turno, descargá otra copia y reemplazá el evento anterior en tu calendario.</p>
                <button className="button secondary button-sm" type="submit">Descargar turno (.ics)</button>
                {error && <p className="form-error" role="alert">{error}</p>}
            </form>
        </details>
    );
}
