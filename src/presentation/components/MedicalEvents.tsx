import {enqueueOffline} from '../utils/enqueueOffline';
import { useEffect, useRef, useState } from 'preact/hooks';
import {driveAuth, driveMedicalEventRepo} from '@data';
import {Outbox} from '@data/outbox';
import {isValidDate, normalize} from '@domain/utils';
import {formatStudyDate, reportUrl} from '@domain/library';
import type {MedicalEvent, MedicalEventDraft} from '@domain/models';
import {medicalEvents, visibleMedicalEvents, studies} from '../state/store';

const outbox = new Outbox();

export function MedicalEvents() {
    const [editing, setEditing] = useState<MedicalEvent | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [formOpen, setFormOpen] = useState(false);
    const [query, setQuery] = useState('');
    const dialogRef = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (formOpen && !dialog.open) dialog.showModal();
        if (!formOpen && dialog.open) dialog.close();
    }, [formOpen]);

    const openNew = () => {
        setEditing(null);
        setFormOpen(true);
    };

    const openEdit = (event: MedicalEvent) => {
        setEditing(event);
        setFormOpen(true);
    };

    const closeForm = () => {
        setFormOpen(false);
        setEditing(null);
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

    async function deleteEvent(event: MedicalEvent) {
        if (!confirm(`Eliminar la ${event.kind === 'consultation' ? 'consulta' : 'receta'} del ${event.date}?`)) return;
        try {
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
        }
    }

    const normalizedQuery = normalize(query);
    const visible = [...visibleMedicalEvents.value]
        .filter((event) => {
            if (!normalizedQuery) return true;
            const relatedTitles = (event.studyIds ?? []).map((id) => studies.value.find((study) => study.id === id)?.title ?? '');
            return [event.kind === 'consultation' ? 'consulta' : 'receta', event.date, event.doctor, event.notes, ...relatedTitles]
                .some((value) => normalize(value ?? '').includes(normalizedQuery));
        })
        .sort((a, b) => b.date.localeCompare(a.date));

    return <section className="events" aria-labelledby="events-title">
        <div className="events-head">
            <div>
                <p className="eyebrow">Seguimiento</p>
                <h2 id="events-title">Consultas y recetas</h2>
                <p className="events-desc">Consultas médicas, indicaciones y recetas con sus estudios y documentos.</p>
            </div>
            <div className="events-head-actions">
                <span className="count-badge">{visibleMedicalEvents.value.length}</span>
                <button className="button primary" type="button" onClick={openNew}>
                    <svg className="icon"><use href="#i-plus" /></svg> Agregar consulta
                </button>
            </div>
        </div>

        <div className="events-toolbar">
            <label className="events-search">
                <svg className="icon"><use href="#i-search" /></svg>
                <span className="sr-only">Buscar consultas y recetas</span>
                <input id="event-search" type="search" placeholder="Buscar por profesional, nota o estudio…" value={query}
                       onInput={(event) => setQuery((event.target as HTMLInputElement).value)} />
            </label>
        </div>

        {message && <p className="events-message" role="status">{message}</p>}

        {visible.length ? (
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
                            <span className="event-kind" data-tone={event.kind === 'consultation' ? 'primary' : 'neutral'}>
                                <svg className="icon"><use href={event.kind === 'consultation' ? '#i-stethoscope' : '#i-message'} /></svg>
                                {label}
                            </span>
                            <time className="event-date" dateTime={event.date}>{formatStudyDate(event.date)}</time>
                            {syncLabel && <span className="status-pill" data-tone={syncTone}>{syncLabel}</span>}
                        </div>

                        <h3 className="event-title">{event.doctor || 'Profesional sin nombre'}</h3>
                        {event.notes && <p className="event-notes">{event.notes}</p>}

                        {(studyIds.length > 0 || documentIds.length > 0) && (
                            <div className="event-links">
                                {studyIds.slice(0, 3).map((id) => {
                                    const study = studies.value.find((item) => item.id === id);
                                    return <span className="event-chip" key={`study-${id}`}>
                                        <svg className="icon"><use href="#i-file" /></svg>
                                        {study ? study.title : 'Estudio no disponible'}
                                    </span>;
                                })}
                                {documentIds.map((id) => {
                                    const source = studies.value.find((item) => item.id === id && item.hasPdf);
                                    return source
                                        ? <a className="event-doc" href={reportUrl(id)} target="_blank" rel="noopener noreferrer" key={`doc-${id}`}>
                                            <svg className="icon"><use href="#i-external" /></svg>{source.reportName || source.title}
                                        </a>
                                        : <span className="event-chip" key={`doc-${id}`}>Documento no disponible</span>;
                                })}
                            </div>
                        )}

                        <div className="event-foot">
                            <span className="count-badge">{studyIds.length} estudios · {documentIds.length} documentos</span>
                            <div className="event-actions">
                                <button className="button ghost button-sm" type="button" disabled={Boolean(event.syncStatus)} onClick={() => openEdit(event)}>Editar</button>
                                <button className="button ghost button-sm event-delete" type="button" disabled={Boolean(event.syncStatus)} onClick={() => void deleteEvent(event)}>Eliminar</button>
                            </div>
                        </div>
                    </li>;
                })}
            </ul>
        ) : (
            <div className="event-empty">
                <span className="event-empty-icon"><svg className="icon"><use href="#i-stethoscope" /></svg></span>
                <p>{normalizedQuery ? 'No hay consultas ni recetas que coincidan con la búsqueda.' : 'Todavía no hay consultas ni recetas.'}</p>
                {normalizedQuery ? (
                    <button className="button secondary button-sm" type="button" onClick={() => setQuery('')}>Limpiar búsqueda</button>
                ) : (
                    <button className="button secondary button-sm" type="button" onClick={openNew}>Agregar consulta</button>
                )}
            </div>
        )}

        <dialog ref={dialogRef} id="event-dialog" className="dialog event-dialog" aria-labelledby="event-dialog-title" onClose={closeForm}>
            <form id="event-form" key={editing?.id ?? 'new'} onSubmit={(event) => {
                event.preventDefault();
                void save(event.currentTarget);
            }}>
                <div className="dialog-heading">
                    <div>
                        <p className="eyebrow">Seguimiento</p>
                        <h2 id="event-dialog-title">{editing ? 'Editar consulta o receta' : 'Agregar consulta o receta'}</h2>
                    </div>
                    <button className="icon-button" type="button" aria-label="Cerrar" onClick={closeForm} disabled={busy}>
                        <svg className="icon"><use href="#i-close" /></svg>
                    </button>
                </div>

                <fieldset disabled={busy}>
                    <div className="event-form-grid">
                        <label>Tipo <select name="kind" required defaultValue={editing?.kind ?? 'consultation'}>
                            <option value="consultation">Consulta</option>
                            <option value="prescription">Receta</option>
                        </select></label>
                        <label>Fecha <input id="event-date" name="date" type="date" required defaultValue={editing?.date ?? ''} /></label>
                        <label className="wide">Médico o profesional <input name="doctor" maxLength={120} defaultValue={editing?.doctor ?? ''} /></label>
                        <label className="wide">Notas <textarea id="event-notes" name="notes" defaultValue={editing?.notes ?? ''} /></label>
                    </div>

                    <fieldset className="event-related">
                        <legend>Estudios relacionados</legend>
                        {studies.value.length ? studies.value.map((study) => <label key={study.id}>
                            <input type="checkbox" name="studyId" data-event-study={study.id} value={study.id}
                                   defaultChecked={editing?.studyIds.includes(study.id)} />{study.title} · {study.date}
                        </label>) : <p className="event-related-empty">No hay estudios para vincular.</p>}
                        {editing?.studyIds.filter((id) => !studies.value.some((study) => study.id === id)).map((id) =>
                            <label key={id}><input type="checkbox" name="studyId" value={id} defaultChecked /> Estudio no disponible</label>)}
                    </fieldset>

                    <fieldset className="event-related">
                        <legend>Documentos relacionados</legend>
                        {studies.value.filter((study) => study.hasPdf).length ? studies.value.filter((study) => study.hasPdf).map((study) => <label key={study.id}>
                            <input type="checkbox" name="documentId" value={study.id}
                                   defaultChecked={editing?.documentIds.includes(study.id)} />{study.reportName || study.title}
                        </label>) : <p className="event-related-empty">No hay PDFs para vincular.</p>}
                        {editing?.documentIds.filter((id) => !studies.value.some((study) => study.id === id && study.hasPdf)).map((id) =>
                            <label key={id}><input type="checkbox" name="documentId" value={id} defaultChecked /> Documento no disponible</label>)}
                    </fieldset>

                    <div className="dialog-actions">
                        <button className="button secondary" type="button" onClick={closeForm} disabled={busy}>Cancelar</button>
                        <button className="button primary" type="submit" disabled={busy || !driveAuth.configured}>{busy ? 'Guardando…' : 'Guardar evento'}</button>
                    </div>
                </fieldset>
            </form>
        </dialog>
    </section>;
}
