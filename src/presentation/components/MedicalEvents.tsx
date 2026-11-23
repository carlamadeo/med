import {enqueueOffline} from '../utils/enqueueOffline';
import {buildProfessionalOptions, resolveProfessionalSpecialty, syncAutoField} from '../utils/appointmentEditor';
import {useEffect, useRef, useState} from 'preact/hooks';
import {driveAuth, driveMedicalEventRepo} from '@data';
import {Outbox} from '@data/outbox';
import {isValidDate, normalize} from '@domain/utils';
import {COMMON_SPECIALTIES, formatStudyDate, hasStudyAttachment, reportUrl, specialtyNames, studyAttachmentName} from '@domain/library';
import type {MedicalEvent, MedicalEventDraft} from '@domain/models';
import {
    doctorDirectory,
    isLocalDemo,
    medicalEvents,
    operations,
    studies,
    visibleAppointments,
    visibleDoctors,
    visibleMedicalEvents,
} from '../state/store';
import {useFocusTrap} from '../utils/focusTrap';
import {AutocompleteTextField} from './AutocompleteTextField';
import {ConfirmActionDialog} from './ConfirmActionDialog';
import {EventRelatedPicker} from './EventRelatedPicker';

const outbox = new Outbox();

export function MedicalEvents({query}: {query: string}) {
    const studyAttachments = studies.value.filter(hasStudyAttachment);
    const [editing, setEditing] = useState<MedicalEvent | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [formOpen, setFormOpen] = useState(false);
    const [doctor, setDoctor] = useState('');
    const [specialty, setSpecialty] = useState('');
    const [pendingDelete, setPendingDelete] = useState<MedicalEvent | null>(null);
    const dialogRef = useRef<HTMLDialogElement>(null);
    const autoSpecialtyRef = useRef<string | null>(null);

    useFocusTrap(dialogRef, formOpen);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (formOpen && !dialog.open) dialog.showModal();
        if (!formOpen && dialog.open) dialog.close();
    }, [formOpen]);

    const openNew = () => {
        setMessage('');
        setEditing(null);
        setDoctor('');
        setSpecialty('');
        autoSpecialtyRef.current = null;
        setFormOpen(true);
    };

    const openEdit = (event: MedicalEvent) => {
        const initialSpecialty = resolveProfessionalSpecialty(
            event.doctor,
            doctorDirectory.value,
            visibleAppointments.value,
            visibleMedicalEvents.value,
        );
        setMessage('');
        setEditing(event);
        setDoctor(event.doctor ?? '');
        setSpecialty(event.specialty ?? '');
        autoSpecialtyRef.current =
            event.specialty && initialSpecialty && normalize(initialSpecialty) === normalize(event.specialty)
                ? event.specialty
                : null;
        setFormOpen(true);
    };

    const closeForm = () => {
        setFormOpen(false);
        setEditing(null);
    };

    const cancelForm = () => {
        setMessage('');
        closeForm();
    };

    const handleDoctorChange = (nextValue: string) => {
        setDoctor(nextValue);
        const nextSpecialty = resolveProfessionalSpecialty(
            nextValue,
            doctorDirectory.value,
            visibleAppointments.value,
            visibleMedicalEvents.value,
        );
        syncAutoField(specialty, nextSpecialty, autoSpecialtyRef, setSpecialty);
    };

    async function save(form: HTMLFormElement) {
        const data = new FormData(form);
        const kind = String(data.get('kind'));
        if (kind !== 'consultation' && kind !== 'prescription') {
            setMessage('Elegí un tipo de evento válido.');
            return;
        }
        const draft: MedicalEventDraft = {
            kind,
            date: String(data.get('date') ?? ''), doctor: String(data.get('doctor') ?? '').trim(),
            specialty: String(data.get('specialty') ?? '').trim() || undefined,
            notes: String(data.get('notes') ?? '').trim(), studyIds: data.getAll('studyId').map(String),
            documentIds: data.getAll('documentId').map(String), id: editing?.id, revision: editing?.revision,
        };
        if (!isValidDate(draft.date)) {
            setMessage('Ingresá una fecha válida para el evento.');
            return;
        }
        setBusy(true);
        setMessage('');
        try {
            if (isLocalDemo.value) {
                const saved: MedicalEvent = {
                    ...draft,
                    id: draft.id || `demo-event-${Date.now()}`,
                    revision: '1',
                };
                medicalEvents.value = [...medicalEvents.value.filter((event) => event.id !== saved.id), saved];
                setEditing(null);
                form.reset();
                setFormOpen(false);
                return;
            }
            const token = await driveAuth.getAccessToken();
            const owner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
            if (!owner) {
                setMessage('Conectate primero para verificar tu cuenta.');
                setBusy(false);
                return;
            }
            if (draft.id && (await outbox.list(owner)).some((entry) => entry.eventId === draft.id)) {
                setMessage('Este evento ya tiene un cambio pendiente.');
                setBusy(false);
                return;
            }
            if (!navigator.onLine) {
                if (!navigator.locks) {
                    setMessage('Este navegador no admite la sincronización segura sin conexión.');
                    setBusy(false);
                    return;
                }
                await enqueueOffline(owner, () => outbox.enqueueEventSave(owner, draft), token);
                if (await driveAuth.getAccessToken() !== token) return;
                window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
                setMessage('Evento guardado en este dispositivo; queda pendiente de sincronización.');
            } else {
                if (await driveAuth.getAccessToken() !== token) throw new Error('La cuenta cambió. Volvé a intentar.');
                const saved = await driveMedicalEventRepo.save(draft);
                if (await driveAuth.getAccessToken() !== token) {
                    setBusy(false);
                    return;
                }
                medicalEvents.value = [...medicalEvents.value.filter((event) => event.id !== saved.id), saved];
            }
            if (await driveAuth.getAccessToken() !== token) {
                setBusy(false);
                return;
            }
            setEditing(null);
            form.reset();
            setFormOpen(false);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'No se pudo guardar el evento.');
        } finally {
            setBusy(false);
        }
    }

    function deleteEvent(event: MedicalEvent) {
        setPendingDelete(event);
    }

    async function executeDeleteEvent(event: MedicalEvent) {
        try {
            if (isLocalDemo.value) {
                medicalEvents.value = medicalEvents.value.filter((ev) => ev.id !== event.id);
                setMessage('Evento eliminado.');
                return;
            }
            const token = await driveAuth.getAccessToken();
            const owner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
            if (!owner) {
                setMessage('Conectate primero para verificar tu cuenta.');
                return;
            }
            if (!event.revision) {
                setMessage('El evento no tiene revisión válida.');
                return;
            }
            setBusy(true);
            if (!navigator.onLine) {
                if (!navigator.locks) {
                    setMessage('Este navegador no admite la sincronización segura sin conexión.');
                    setBusy(false);
                    return;
                }
                await enqueueOffline(owner, () => outbox.enqueueEventDelete(owner, event.id, event.revision), token);
                if (await driveAuth.getAccessToken() !== token) return;
                window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
                setMessage('Eliminación guardada en este dispositivo; queda pendiente de sincronización.');
            } else {
                if (await driveAuth.getAccessToken() !== token) throw new Error('La cuenta cambió. Volvé a intentar.');
                await driveMedicalEventRepo.delete(event.id, event.revision);
                if (await driveAuth.getAccessToken() !== token) {
                    setBusy(false);
                    return;
                }
                medicalEvents.value = medicalEvents.value.filter((ev) => ev.id !== event.id);
            }
            if (await driveAuth.getAccessToken() !== token) {
                setBusy(false);
                return;
            }
            if (navigator.onLine) setMessage('Evento eliminado.');
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'No se pudo eliminar el evento.');
        } finally {
            setBusy(false);
            setPendingDelete(null);
        }
    }

    const events = visibleMedicalEvents.value;
    const specialties = specialtyNames([...events, ...visibleDoctors.value, ...visibleAppointments.value], COMMON_SPECIALTIES);
    const professionalOptions = buildProfessionalOptions(
        doctorDirectory.value,
        visibleAppointments.value,
        events,
        operations.value,
    );
    const visible = events
        .filter((event) => {
            if (!query) return true;
            const relatedTitles = (event.studyIds ?? []).map((id) => studies.value.find((study) => study.id === id)?.title ?? '');
            return [event.kind === 'consultation' ? 'consulta' : 'receta', event.date, event.doctor, event.specialty, event.notes, ...relatedTitles]
                .some((value) => normalize(value ?? '').includes(query));
        })
        .sort((a, b) => b.date.localeCompare(a.date));

    return <section className="events" aria-labelledby="events-title">
        <div className="events-head">
            <div>
                <h3 id="events-title">Consultas y recetas sin turno</h3>
                <p className="events-desc">Consultas, indicaciones o recetas registradas sin turno previo.</p>
            </div>
            <div className="events-head-actions">
                <span className="count-badge">{events.length}</span>
                <button className="button secondary" type="button" onClick={openNew}>
                    <svg className="icon">
                        <use href="#i-plus"/>
                    </svg>
                    Registrar sin turno
                </button>
            </div>
        </div>

        {!formOpen && message && <p className="events-message" role="status">{message}</p>}

        {visible.length > 0 ? (
            <ul id="events-list" className="event-list">
                {visible.map((event) => {
                    const studyIds = event.studyIds ?? [];
                    const documentIds = event.documentIds ?? [];
                    const syncLabel = event.syncStatus === 'conflict' ? 'Requiere revisión'
                        : event.syncStatus === 'failed' ? 'No se puede sincronizar'
                            : event.syncStatus === 'pending' ? 'Pendiente de sincronización' : '';
                    const syncTone = event.syncStatus === 'conflict' || event.syncStatus === 'failed' ? 'danger' : 'warning';
                    const label = event.kind === 'consultation' ? 'Consulta' : 'Receta';
                    return <li className="event-card" key={event.id}>
                        <div className="event-top">
                            <span className="event-kind"
                                  data-tone={event.kind === 'consultation' ? 'primary' : 'neutral'}>
                                <svg className="icon"><use
                                    href={event.kind === 'consultation' ? '#i-stethoscope' : '#i-clipboard'}/></svg>
                                {label}
                            </span>
                            <time className="event-date" dateTime={event.date}>{formatStudyDate(event.date)}</time>
                            {syncLabel && <span className="status-pill" data-tone={syncTone}>{syncLabel}</span>}
                        </div>

                        <h4 className="event-title">{event.doctor || 'Profesional sin nombre'}</h4>
                        {event.specialty && <p className="event-specialty">{event.specialty}</p>}
                        {event.notes && <p className="event-notes">{event.notes}</p>}

                        {(studyIds.length > 0 || documentIds.length > 0) && (
                            <div className="event-links">
                                {studyIds.slice(0, 3).map((id) => {
                                    const study = studies.value.find((item) => item.id === id);
                                    return <span className="event-chip" key={`study-${id}`}>
                                        <svg className="icon"><use href="#i-file"/></svg>
                                        {study ? study.title : 'Estudio no disponible'}
                                    </span>;
                                })}
                                {documentIds.map((id) => {
                                    const source = studyAttachments.find((item) => item.id === id);
                                    return source
                                        ? <a className="event-doc" href={reportUrl(id)} target="_blank"
                                             rel="noopener noreferrer" key={`doc-${id}`}>
                                            <svg className="icon">
                                                <use href="#i-external"/>
                                            </svg>
                                            {studyAttachmentName(source)}
                                        </a>
                                        : <span className="event-chip" key={`doc-${id}`}>Documento no disponible</span>;
                                })}
                            </div>
                        )}

                        <div className="event-foot">
                            <span
                                className="count-badge">{studyIds.length} estudios · {documentIds.length} documentos</span>
                            <div className="event-actions">
                                <button className="button ghost button-sm" type="button"
                                        disabled={Boolean(event.syncStatus)} onClick={() => openEdit(event)}>Editar
                                </button>
                                <button className="button ghost button-sm event-delete" type="button"
                                        disabled={Boolean(event.syncStatus)}
                                        onClick={() => void deleteEvent(event)}>Eliminar
                                </button>
                            </div>
                        </div>
                    </li>;
                })}
            </ul>
        ) : (
            <div className="event-empty">
                <span className="event-empty-icon"><svg className="icon" aria-hidden="true"><use href="#i-clipboard"/></svg></span>
                <p>{query ? 'No hay consultas ni recetas que coincidan con la búsqueda.' : 'Todavía no hay consultas ni recetas sin turno.'}</p>
            </div>
        )}

        <dialog ref={dialogRef} id="event-dialog" className="dialog event-dialog" aria-labelledby="event-dialog-title"
                onCancel={(event) => {
                    event.preventDefault();
                    if (!busy) cancelForm();
                }}
                onClose={closeForm}>
            {formOpen && <form id="event-form" onSubmit={(event) => {
                event.preventDefault();
                void save(event.currentTarget);
            }}>
                <div className="dialog-heading">
                    <div>
                        <p className="eyebrow">Seguimiento</p>
                        <h2 id="event-dialog-title">{editing ? 'Editar consulta o receta' : 'Agregar consulta o receta'}</h2>
                    </div>
                    <button className="icon-button" type="button" aria-label="Cerrar" onClick={cancelForm}
                            disabled={busy}>
                        <svg className="icon">
                            <use href="#i-close"/>
                        </svg>
                    </button>
                </div>

                <div className="event-form-body">
                    <fieldset disabled={busy}>
                        <div className="event-form-grid">
                            <label>
                                Tipo
                                <span className="select-control">
                                    <select name="kind" required defaultValue={editing?.kind ?? 'consultation'}>
                                        <option value="consultation">Consulta</option>
                                        <option value="prescription">Receta</option>
                                    </select>
                                    <svg className="icon" aria-hidden="true"><use href="#i-chevron-down"/></svg>
                                </span>
                            </label>
                            <label>Fecha <input id="event-date" name="date" type="date" required
                                                defaultValue={editing?.date ?? ''}/></label>
                            <AutocompleteTextField
                                id="event-doctor"
                                name="doctor"
                                label="Médico o profesional"
                                value={doctor}
                                onChange={handleDoctorChange}
                                options={professionalOptions}
                                placeholder="Dra. Pérez"
                                listId="event-professionals"
                                className="wide"
                                disabled={busy}
                            />
                            <AutocompleteTextField
                                id="event-specialty"
                                name="specialty"
                                label="Especialidad"
                                value={specialty}
                                onChange={(nextValue) => {
                                    autoSpecialtyRef.current = null;
                                    setSpecialty(nextValue);
                                }}
                                options={specialties}
                                placeholder="Elegí o escribí una especialidad"
                                listId="event-specialties"
                                className="wide"
                                disabled={busy}
                            />
                            <label className="wide"><span className="field-label">Notas <small aria-hidden="true">Opcional</small></span> <textarea id="event-notes" name="notes"
                                                                    defaultValue={editing?.notes ?? ''}/></label>
                        </div>

                        <EventRelatedPicker name="studyId" initialIds={editing?.studyIds} options={studies.value.map(study => ({
                            id: study.id,
                            label: `${study.title} · ${formatStudyDate(study.date)}`,
                            keywords: `${study.doctor} ${study.portal} ${study.date}`,
                        }))}/>
                        <EventRelatedPicker name="documentId" initialIds={editing?.documentIds} options={studyAttachments.map(study => ({
                            id: study.id,
                            label: studyAttachmentName(study),
                            keywords: `${study.reportName} ${study.title} ${study.doctor} ${study.portal} ${study.date} ${formatStudyDate(study.date)}`,
                        }))}/>

                        {message && <p className="form-error" role="alert">{message}</p>}
                    </fieldset>
                </div>
                <div className="dialog-actions">
                    <button className="button secondary" type="button" onClick={cancelForm}
                            disabled={busy}>Cancelar
                    </button>
                    <button className="button primary" type="submit"
                            disabled={busy || (!driveAuth.configured && !isLocalDemo.value)}>{busy ? 'Guardando…' : 'Guardar evento'}</button>
                </div>
            </form>}
        </dialog>

        <ConfirmActionDialog
            open={Boolean(pendingDelete)}
            title="Eliminar evento"
            message={pendingDelete ? `¿Eliminar la ${pendingDelete.kind === 'consultation' ? 'consulta' : 'receta'} del ${pendingDelete.date}?` : ''}
            confirmLabel="Eliminar evento"
            busy={busy}
            onConfirm={() => {
                if (pendingDelete) void executeDeleteEvent(pendingDelete);
            }}
            onCancel={() => setPendingDelete(null)}
        />
    </section>;
}
