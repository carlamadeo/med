import {useEffect, useRef, useState} from 'preact/hooks';
import type {Appointment} from '@domain/models';
import {isLocalDemo, offline} from '../state/store';
import {getAppointmentPrescription} from '../utils/appointmentEditor';

export function AppointmentPrescriptionDownload({appointment}: { appointment: Appointment }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const current = useRef<Appointment | null>(appointment);
    current.current = appointment;
    useEffect(() => () => {
        current.current = null;
    }, []);

    async function download() {
        if (busy) return;
        setBusy(true);
        setError('');
        try {
            const file = await getAppointmentPrescription(appointment);
            if (current.current !== appointment) return;
            const url = URL.createObjectURL(file);
            const link = document.createElement('a');
            link.href = url;
            link.download = file.name;
            document.body.append(link);
            try {
                link.click();
            } finally {
                link.remove();
                window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
        } catch (cause) {
            if (current.current === appointment) {
                setError(cause instanceof Error ? cause.message : 'No se pudo descargar la receta.');
            }
        } finally {
            if (current.current) setBusy(false);
        }
    }

    const unavailable = offline.value && !isLocalDemo.value;
    return <div className="appointment-prescription">
        <span className="appointment-prescription-name">Receta · {appointment.prescription?.name}</span>
        {unavailable
            ? <p className="appointment-study-note">Conectate para descargar la receta.</p>
            : <button type="button" className="button secondary button-sm"
                      disabled={busy || Boolean(appointment.syncStatus)} onClick={() => void download()}>
                {busy ? 'Descargando…' : 'Descargar receta'}
            </button>}
        {error && <p className="form-error" role="alert">{error}</p>}
    </div>;
}
