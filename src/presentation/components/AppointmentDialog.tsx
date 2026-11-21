import {useEffect, useRef, useState} from 'preact/hooks';
import {COMMON_SPECIALTIES, specialtyNames} from '@domain/library';
import type {Appointment, AppointmentDraft} from '@domain/models';
import {driveAuth} from '@data';
import {
    appointmentEditor, closeAppointmentEditor, isLocalDemo,
    visibleAppointments, visibleMedicalEvents,
} from '../state/store';
import {deleteAppointment, getTimeZoneOptions, normalizeTimeZone, saveAppointment} from '../utils/appointmentEditor';
import {useFocusTrap} from '../utils/focusTrap';
import {AppointmentStudyPicker} from './AppointmentStudies';
import {ConfirmActionDialog} from './ConfirmActionDialog';

function parseCost(value: FormDataEntryValue | null): number | null {
    const raw = typeof value === 'string' ? value.trim().replace(',', '.') : '';
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
}

export function AppointmentDialog() {
    const editor = appointmentEditor.value;
    const appointment = editor?.appointment ?? null;
    const open = editor !== null;
    const consultation = editor?.mode === 'consultation';
    const registering = consultation && appointment?.status === 'scheduled';
    const dialogRef = useRef<HTMLDialogElement>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [confirmingDelete, setConfirmingDelete] = useState(false);

    useFocusTrap(dialogRef, open);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!open) {
            if (dialog?.open) dialog.close();
            setConfirmingDelete(false);
            return;
        }
        if (dialog && !dialog.open) dialog.showModal();
        setMessage('');
        setError(null);
        setBusy(false);
    }, [editor]);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        dialog.addEventListener('close', closeAppointmentEditor);
        return () => dialog.removeEventListener('close', closeAppointmentEditor);
    }, []);

    const close = () => {
        if (dialogRef.current?.open) dialogRef.current.close();
        closeAppointmentEditor();
    };

    const submit = async (event: Event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        if (busy || message) return;
        const data = new FormData(form);
        const draft: AppointmentDraft = {
            id: appointment?.id,
            revision: appointment?.revision,
            date: String(data.get('date') ?? appointment?.date ?? ''),
            time: String(data.get('time') ?? appointment?.time ?? ''),
            timeZone: String(data.get('timeZone') ?? appointment?.timeZone ?? ''),
            professional: String(data.get('professional') ?? appointment?.professional ?? '').trim(),
            specialty: String(data.get('specialty') ?? appointment?.specialty ?? ''),
            location: String(data.get('location') ?? appointment?.location ?? '').trim() || undefined,
            reason: String(data.get('reason') ?? appointment?.reason ?? '').trim() || undefined,
            prescriptionFile: form.querySelector<HTMLInputElement>('#appointment-prescription')?.files?.[0],
            removePrescription: data.has('removePrescription'),
            notes: String(data.get('notes') ?? appointment?.notes ?? ''),
            status: (data.get('status') as Appointment['status']) ?? 'scheduled',
            cost: parseCost(data.get('cost')),
            coverage: ((data.get('coverage') ?? appointment?.coverage) as Appointment['coverage'] | '') || null,
            studyIds: consultation ? appointment?.studyIds : data.getAll('studyId').map(String),
        };
        setBusy(true);
        setMessage('');
        setError(null);
        try {
            const result = await saveAppointment(draft, appointment);
            if (!form.isConnected) return;
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
            if (form.isConnected) setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            if (form.isConnected) setBusy(false);
        }
    };

    const remove = () => {
        const form = dialogRef.current?.querySelector('form');
        if (!appointment || !form) return;
        setConfirmingDelete(true);
    };

    const executeRemove = async () => {
        const form = dialogRef.current?.querySelector('form');
        if (!appointment || !form) {
            setConfirmingDelete(false);
            return;
        }
        setBusy(true);
        setMessage('');
        setError(null);
        try {
            const result = await deleteAppointment(appointment);
            if (!form.isConnected) return;
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
            if (form.isConnected) setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            if (form.isConnected) {
                setBusy(false);
                setConfirmingDelete(false);
            }
        }
    };

    const resolvedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Argentina/Buenos_Aires';
    const defaultTimeZone = normalizeTimeZone(appointment?.timeZone ?? resolvedTimeZone);
    const timeZoneOptions = getTimeZoneOptions(defaultTimeZone);
    const specialties = open && !consultation
        ? specialtyNames([...visibleAppointments.value, ...visibleMedicalEvents.value], COMMON_SPECIALTIES)
        : [];
    const title = consultation
        ? (registering ? 'Registrar consulta' : 'Editar consulta')
        : (appointment ? 'Editar turno' : 'Agendar turno');
    const saveLabel = consultation ? 'Guardar consulta' : 'Guardar turno';

    return (
        <>
            <dialog
                ref={dialogRef}
                id="appointment-dialog"
                className="dialog appointment-dialog"
                aria-labelledby="appointment-dialog-title"
                onCancel={(event) => {
                    if (busy) event.preventDefault();
                }}
            >
            {editor && <form id="appointment-form" key={`${editor.mode}:${appointment?.id ?? 'new'}`} onSubmit={submit}>
                <div className="dialog-heading">
                    <div>
                        <p className="eyebrow">Seguimiento</p>
                        <h2 id="appointment-dialog-title">{title}</h2>
                    </div>
                    <button className="icon-button" type="button" aria-label="Cerrar" onClick={close} disabled={busy}>
                        <svg className="icon">
                            <use href="#i-close"/>
                        </svg>
                    </button>
                </div>

                <div className="form-grid two">
                    {!consultation && <>
                        <label className="field">
                            <span>Fecha</span>
                            <input id="appointment-date" name="date" type="date" defaultValue={appointment?.date ?? ''}
                                   required disabled={busy}/>
                        </label>
                        <label className="field">
                            <span>Hora</span>
                            <input id="appointment-time" name="time" type="time" defaultValue={appointment?.time ?? ''}
                                   required disabled={busy}/>
                        </label>
                        <label className="field wide">
                            <span>Zona horaria</span>
                            <span className="select-control">
                                <select id="appointment-timezone" name="timeZone"
                                        defaultValue={defaultTimeZone}
                                        disabled={busy}>
                                    {timeZoneOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                                <svg className="icon" aria-hidden="true"><use href="#i-chevron-down"/></svg>
                            </span>
                        </label>
                        <label className="field wide">
                            <span className="field-label">Profesional <small aria-hidden="true">Opcional</small></span>
                            <input id="appointment-professional" name="professional" type="text" placeholder="Dra. Pérez"
                                   defaultValue={appointment?.professional ?? ''} disabled={busy}/>
                        </label>
                        <label className="field wide">
                            <span className="field-label">Especialidad <small aria-hidden="true">Opcional</small></span>
                            <input name="specialty" list="appointment-specialties" maxLength={120}
                                   placeholder="Elegí o escribí una especialidad"
                                   defaultValue={appointment?.specialty ?? ''} disabled={busy}/>
                        </label>
                        <datalist id="appointment-specialties">
                            {specialties.map(name => <option key={name} value={name}/>)}
                        </datalist>
                        <label className="field wide">
                            <span className="field-label">Lugar o dirección <small aria-hidden="true">Opcional</small></span>
                            <input id="appointment-location" name="location" type="text" maxLength={240}
                                   placeholder="Consultorio, institución o dirección"
                                   defaultValue={appointment?.location ?? ''} disabled={busy}/>
                        </label>
                    </>}
                    <label className={consultation ? 'field' : 'field wide'}>
                        <span>Estado</span>
                        <span className="select-control">
                            <select id="appointment-status" name="status"
                                    defaultValue={registering ? 'completed' : appointment?.status ?? 'scheduled'}
                                    disabled={busy}>
                                <option value="scheduled">Programado</option>
                                <option value="completed">Realizado</option>
                                <option value="cancelled">Cancelado</option>
                                <option value="absent">No asistí</option>
                            </select>
                            <svg className="icon" aria-hidden="true"><use href="#i-chevron-down"/></svg>
                        </span>
                    </label>
                    <label className="field">
                        <span className="field-label">Importe <small aria-hidden="true">Opcional</small></span>
                        <input id="appointment-cost" name="cost" type="number" min="0" step="0.01" placeholder="0,00"
                               defaultValue={appointment?.cost ?? ''} disabled={busy}/>
                    </label>
                    {!consultation && <>
                        <label className="field">
                            <span className="field-label">Cobertura <small aria-hidden="true">Opcional</small></span>
                            <span className="select-control">
                                <select id="appointment-coverage" name="coverage" defaultValue={appointment?.coverage ?? ''}
                                        disabled={busy}>
                                    <option value="">Desconocida</option>
                                    <option value="all">Total</option>
                                    <option value="partial">Parcial</option>
                                    <option value="none">Sin cobertura</option>
                                </select>
                                <svg className="icon" aria-hidden="true"><use href="#i-chevron-down"/></svg>
                            </span>
                        </label>
                        <label className="field wide">
                            <span className="field-label">Motivo de la consulta <small aria-hidden="true">Opcional</small></span>
                            <textarea id="appointment-reason" name="reason"
                                      defaultValue={appointment?.reason ?? ''} disabled={busy}/>
                        </label>
                    </>}
                    {consultation && <label className="field wide">
                        <span className="field-label">Notas de la consulta <small aria-hidden="true">Opcional</small></span>
                        <textarea id="appointment-notes" name="notes" placeholder="Estudio, indicaciones o comentarios"
                                  defaultValue={appointment?.notes ?? ''} disabled={busy}/>
                    </label>}
                </div>

                {consultation && <fieldset className="appointment-study-picker" disabled={busy || Boolean(message)}>
                    <legend>Receta</legend>
                    {appointment?.prescription && <p className="appointment-prescription-name">{appointment.prescription.name}</p>}
                    <label className="field">
                        <span>{appointment?.prescription ? 'Reemplazar receta' : 'Adjuntar receta'} (PDF, JPG o PNG)</span>
                        <input id="appointment-prescription" name="prescriptionFile" type="file"
                               accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"/>
                    </label>
                    {appointment?.prescription && <label className="appointment-prescription-remove">
                        <input type="checkbox" name="removePrescription"/> Quitar la receta actual
                    </label>}
                </fieldset>}
                {!consultation && <>
                    <AppointmentStudyPicker studyIds={appointment?.studyIds} disabled={busy}/>
                    {!isLocalDemo.value && (
                        <p className="appointment-note">
                            {driveAuth.hasCalendarAccess()
                                ? 'Se sincroniza automáticamente con tu calendario «Turnos» en Google Calendar (avisos: 1 semana antes a las 11:00 y el día anterior a las 11:00).'
                                : 'Para sincronizar con tu calendario «Turnos» en Google Calendar, salí y volvé a conectar tu cuenta autorizando Calendario.'}
                        </p>
                    )}
                </>}

                {message && <p className="form-message" role="status">{message}</p>}
                {error && <p className="form-error" role="alert">{error}</p>}
                {!navigator.locks && navigator.onLine && (
                    <p className="small-note">Este navegador no expone Web Locks, necesario para sincronizar cambios
                        entre pestañas.</p>
                )}
                {navigator.serviceWorker && !navigator.onLine &&
                    <p className="small-note">Guardado sin conexión: se sincronizará al recuperar la red.</p>}

                <div className="dialog-actions">
                    {appointment && !consultation && (
                        <button className="button danger" type="button" onClick={remove} disabled={busy || Boolean(message)}>Borrar
                            turno</button>
                    )}
                    <button className="button secondary" type="button" onClick={close} disabled={busy}>{message ? 'Cerrar' : 'Cancelar'}</button>
                    <button className="button primary" type="submit" disabled={busy || Boolean(message) || (!driveAuth.configured && !isLocalDemo.value)}>
                        {busy ? 'Guardando…' : saveLabel}
                    </button>
                </div>
            </form>}
            </dialog>
            <ConfirmActionDialog
                open={confirmingDelete}
                title="Eliminar turno"
                message={appointment ? `¿Borrar el turno de ${appointment.professional || 'este profesional'}?` : ''}
                confirmLabel="Eliminar turno"
                busy={busy}
                onConfirm={executeRemove}
                onCancel={() => setConfirmingDelete(false)}
            />
        </>
    );
}
