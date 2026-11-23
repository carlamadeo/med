import {useEffect, useRef, useState} from 'preact/hooks';
import {DEFAULT_APPOINTMENT_TIME_ZONE} from '@domain/appointments';
import {findDoctorByName} from '@domain/doctors';
import {COMMON_SPECIALTIES, specialtyNames} from '@domain/library';
import type {Appointment, AppointmentDraft} from '@domain/models';
import {normalize} from '@domain/utils';
import {driveAuth} from '@data';
import {
    appointmentEditor,
    closeAppointmentEditor,
    doctorDirectory,
    isLocalDemo,
    operations,
    visibleAppointments,
    visibleDoctors,
    visibleMedicalEvents,
} from '../state/store';
import {
    buildProfessionalOptions,
    deleteAppointment,
    resolveProfessionalSpecialty,
    saveAppointment,
    syncAutoField,
} from '../utils/appointmentEditor';
import {useFocusTrap} from '../utils/focusTrap';
import {AppointmentStudyPicker} from './AppointmentStudies';
import {AutocompleteTextField} from './AutocompleteTextField';
import {ConfirmActionDialog} from './ConfirmActionDialog';

function parseCost(value: FormDataEntryValue | null): number | null {
    const raw = typeof value === 'string' ? value.trim().replace(',', '.') : '';
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
}

interface AppointmentFormProps {
    editor: NonNullable<typeof appointmentEditor.value>;
    busy: boolean;
    message: string;
    error: string | null;
    onSubmit: (event: Event) => Promise<void>;
    onClose: () => void;
    onRequestDelete: () => void;
}

function AppointmentForm({
                             editor,
                             busy,
                             message,
                             error,
                             onSubmit,
                             onClose,
                             onRequestDelete,
                         }: AppointmentFormProps) {
    const appointment = editor.appointment;
    const consultation = editor.mode === 'consultation';
    const registering = consultation && appointment?.status === 'scheduled';
    const directory = doctorDirectory.value;
    const initialDoctor = findDoctorByName(directory, appointment?.professional ?? '');

    const [professional, setProfessional] = useState(appointment?.professional ?? '');
    const [specialty, setSpecialty] = useState(appointment?.specialty ?? '');
    const [location, setLocation] = useState(appointment?.location ?? '');

    const autoLocationRef = useRef<string | null>(
        appointment?.location &&
        initialDoctor?.addresses.some((addr) => normalize(addr) === normalize(appointment.location!))
            ? appointment.location
            : null,
    );
    const initialResolvedSpecialty = resolveProfessionalSpecialty(
        appointment?.professional ?? '',
        directory,
        visibleAppointments.value,
        visibleMedicalEvents.value,
    );
    const autoSpecialtyRef = useRef<string | null>(
        appointment?.specialty &&
        initialResolvedSpecialty &&
        normalize(initialResolvedSpecialty) === normalize(appointment.specialty)
            ? appointment.specialty
            : null,
    );

    const handleProfessionalChange = (nextValue: string) => {
        setProfessional(nextValue);
        const matched = findDoctorByName(directory, nextValue);
        const nextDefault = matched?.addresses[0] ?? '';
        syncAutoField(location, nextDefault, autoLocationRef, setLocation);

        const nextSpecialty = resolveProfessionalSpecialty(
            nextValue,
            directory,
            visibleAppointments.value,
            visibleMedicalEvents.value,
        );
        syncAutoField(specialty, nextSpecialty, autoSpecialtyRef, setSpecialty);
    };

    const specialties = !consultation
        ? specialtyNames(
            [...visibleAppointments.value, ...visibleMedicalEvents.value, ...visibleDoctors.value],
            COMMON_SPECIALTIES,
        )
        : [];

    const professionalOptions = !consultation
        ? buildProfessionalOptions(
            directory,
            visibleAppointments.value,
            visibleMedicalEvents.value,
            operations.value,
        )
        : [];

    const selectedDoctor = !consultation ? findDoctorByName(directory, professional) : undefined;
    const title = consultation
        ? registering
            ? 'Registrar consulta'
            : 'Editar consulta'
        : appointment
            ? 'Editar turno'
            : 'Agendar turno';
    const saveLabel = consultation ? 'Guardar consulta' : 'Guardar turno';

    return (
        <form id="appointment-form" onSubmit={onSubmit}>
            <div className="dialog-heading">
                <div>
                    <p className="eyebrow">Seguimiento</p>
                    <h2 id="appointment-dialog-title">{title}</h2>
                </div>
                <button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose} disabled={busy}>
                    <svg className="icon">
                        <use href="#i-close"/>
                    </svg>
                </button>
            </div>

            <div className="form-grid two">
                {!consultation && (
                    <>
                        <label className="field">
                            <span>Fecha</span>
                            <input
                                id="appointment-date"
                                name="date"
                                type="date"
                                defaultValue={appointment?.date ?? ''}
                                required
                                disabled={busy}
                            />
                        </label>
                        <label className="field">
                            <span>Hora</span>
                            <input
                                id="appointment-time"
                                name="time"
                                type="time"
                                defaultValue={appointment?.time ?? ''}
                                required
                                disabled={busy}
                            />
                        </label>
                        <AutocompleteTextField
                            id="appointment-professional"
                            name="professional"
                            label="Profesional"
                            value={professional}
                            onChange={handleProfessionalChange}
                            options={professionalOptions}
                            placeholder="Dra. Pérez"
                            listId="appointment-professionals"
                            className="field wide"
                            disabled={busy}
                        />
                        <AutocompleteTextField
                            id="appointment-specialty"
                            name="specialty"
                            label="Especialidad"
                            value={specialty}
                            onChange={(nextValue) => {
                                autoSpecialtyRef.current = null;
                                setSpecialty(nextValue);
                            }}
                            options={specialties}
                            placeholder="Elegí o escribí una especialidad"
                            listId="appointment-specialties"
                            className="field wide"
                            disabled={busy}
                        />
                        <label className="field wide" htmlFor="appointment-location">
                            <span className="field-label">
                                Lugar o dirección <small aria-hidden="true">Opcional</small>
                            </span>
                            <input
                                id="appointment-location"
                                name="location"
                                type="text"
                                maxLength={240}
                                autoComplete="street-address"
                                placeholder="Consultorio, institución o dirección"
                                value={location}
                                onInput={(event) => {
                                    autoLocationRef.current = null;
                                    setLocation(event.currentTarget.value);
                                }}
                                disabled={busy}
                            />
                        </label>
                        {selectedDoctor && selectedDoctor.addresses.length > 0 && (
                            <div
                                className="appointment-doctor-addresses field wide"
                                role="group"
                                aria-label={`Direcciones de ${selectedDoctor.name}`}
                            >
                                <span className="appointment-addresses-label">Direcciones guardadas</span>
                                <div className="appointment-address-options">
                                    {selectedDoctor.addresses.map((address, index) => {
                                        const selected = normalize(location) === normalize(address);
                                        return (
                                            <button
                                                key={address}
                                                type="button"
                                                className={`appointment-address-option ${selected ? 'is-selected' : ''}`}
                                                aria-pressed={selected}
                                                disabled={busy}
                                                onClick={() => {
                                                    autoLocationRef.current = address;
                                                    setLocation(address);
                                                }}
                                            >
                                                <span>{address}</span>
                                                {index === 0 && (
                                                    <span className="appointment-address-badge">Predeterminada</span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </>
                )}
                <label className={consultation ? 'field' : 'field wide'}>
                    <span>Estado</span>
                    <span className="select-control">
                        <select
                            id="appointment-status"
                            name="status"
                            defaultValue={registering ? 'completed' : (appointment?.status ?? 'scheduled')}
                            disabled={busy}
                        >
                            <option value="scheduled">Programado</option>
                            <option value="completed">Realizado</option>
                            <option value="cancelled">Cancelado</option>
                            <option value="absent">No asistí</option>
                        </select>
                        <svg className="icon" aria-hidden="true">
                            <use href="#i-chevron-down"/>
                        </svg>
                    </span>
                </label>
                <label className="field">
                    <span className="field-label">
                        Importe <small aria-hidden="true">Opcional</small>
                    </span>
                    <input
                        id="appointment-cost"
                        name="cost"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0,00"
                        defaultValue={appointment?.cost ?? ''}
                        disabled={busy}
                    />
                </label>
                {!consultation && (
                    <>
                        <label className="field">
                            <span className="field-label">
                                Cobertura <small aria-hidden="true">Opcional</small>
                            </span>
                            <span className="select-control">
                                <select
                                    id="appointment-coverage"
                                    name="coverage"
                                    defaultValue={appointment?.coverage ?? ''}
                                    disabled={busy}
                                >
                                    <option value="">Desconocida</option>
                                    <option value="all">Total</option>
                                    <option value="partial">Parcial</option>
                                    <option value="none">Sin cobertura</option>
                                </select>
                                <svg className="icon" aria-hidden="true">
                                    <use href="#i-chevron-down"/>
                                </svg>
                            </span>
                        </label>
                        <label className="field wide">
                            <span className="field-label">
                                Motivo de la consulta <small aria-hidden="true">Opcional</small>
                            </span>
                            <textarea
                                id="appointment-reason"
                                name="reason"
                                defaultValue={appointment?.reason ?? ''}
                                disabled={busy}
                            />
                        </label>
                    </>
                )}
                {consultation && (
                    <label className="field wide">
                        <span className="field-label">
                            Notas de la consulta <small aria-hidden="true">Opcional</small>
                        </span>
                        <textarea
                            id="appointment-notes"
                            name="notes"
                            placeholder="Estudio, indicaciones o comentarios"
                            defaultValue={appointment?.notes ?? ''}
                            disabled={busy}
                        />
                    </label>
                )}
            </div>

            {consultation && (
                <fieldset className="appointment-study-picker" disabled={busy || Boolean(message)}>
                    <legend>Receta</legend>
                    {appointment?.prescription && (
                        <p className="appointment-prescription-name">{appointment.prescription.name}</p>
                    )}
                    <label className="field">
                        <span>{appointment?.prescription ? 'Reemplazar receta' : 'Adjuntar receta'} (PDF, JPG o PNG)</span>
                        <input
                            id="appointment-prescription"
                            name="prescriptionFile"
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                        />
                    </label>
                    {appointment?.prescription && (
                        <label className="appointment-prescription-remove">
                            <input type="checkbox" name="removePrescription"/> Quitar la receta actual
                        </label>
                    )}
                </fieldset>
            )}
            {!consultation && (
                <>
                    <AppointmentStudyPicker studyIds={appointment?.studyIds} disabled={busy}/>
                    {!isLocalDemo.value && (
                        <p className="appointment-note">
                            {driveAuth.hasCalendarAccess()
                                ? 'Se sincroniza automáticamente con tu calendario «Turnos» en Google Calendar, sin notificaciones.'
                                : 'Para sincronizar con tu calendario «Turnos» en Google Calendar, salí y volvé a conectar tu cuenta autorizando Calendario.'}
                        </p>
                    )}
                </>
            )}

            {message && (
                <p className="form-message" role="status">
                    {message}
                </p>
            )}
            {error && (
                <p className="form-error" role="alert">
                    {error}
                </p>
            )}
            {!navigator.locks && navigator.onLine && (
                <p className="small-note">
                    Este navegador no expone Web Locks, necesario para sincronizar cambios entre pestañas.
                </p>
            )}
            {navigator.serviceWorker && !navigator.onLine && (
                <p className="small-note">Guardado sin conexión: se sincronizará al recuperar la red.</p>
            )}

            <div className="dialog-actions">
                {appointment && !consultation && (
                    <button
                        className="button danger"
                        type="button"
                        onClick={onRequestDelete}
                        disabled={busy || Boolean(message)}
                    >
                        Borrar turno
                    </button>
                )}
                <button className="button secondary" type="button" onClick={onClose} disabled={busy}>
                    {message ? 'Cerrar' : 'Cancelar'}
                </button>
                <button
                    className="button primary"
                    type="submit"
                    disabled={busy || Boolean(message) || (!driveAuth.configured && !isLocalDemo.value)}
                >
                    {busy ? 'Guardando…' : saveLabel}
                </button>
            </div>
        </form>
    );
}

export function AppointmentDialog() {
    const editor = appointmentEditor.value;
    const appointment = editor?.appointment ?? null;
    const open = editor !== null;
    const consultation = editor?.mode === 'consultation';
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
            timeZone: DEFAULT_APPOINTMENT_TIME_ZONE,
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
                {editor && (
                    <AppointmentForm
                        key={`${editor.mode}:${appointment?.id ?? 'new'}`}
                        editor={editor}
                        busy={busy}
                        message={message}
                        error={error}
                        onSubmit={submit}
                        onClose={close}
                        onRequestDelete={remove}
                    />
                )}
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
