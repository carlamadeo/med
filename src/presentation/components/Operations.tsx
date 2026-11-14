import {enqueueOffline} from '../utils/enqueueOffline';
import {useEffect, useRef, useState} from 'preact/hooks';
import {driveAuth, driveOperationRepo, driveStudyRepo, DriveConflictError} from '@data';
import {Outbox} from '@data/outbox';
import {isValidDate, normalize} from '@domain/utils';
import type {Operation, OperationDraft, Study} from '@domain/models';
import {operations, visibleOperations, studies, filters, view} from '../state/store';

const outbox = new Outbox();

async function getOwner(): Promise<string | null> {
    return driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
}

async function checkOfflineSupport(): Promise<boolean> {
    return !!navigator.locks;
}

async function handleOfflineOperation<T>(
    owner: string,
    action: () => Promise<T>,
    offlineAction: () => Promise<void>,
    _successMessage: string
): Promise<T | null> {
    if (!navigator.onLine) {
        if (!await checkOfflineSupport()) {
            throw new Error('Este navegador no admite la sincronización segura sin conexión.');
        }
        await offlineAction();
        window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
        return null;
    }
    return action();
}

export function Operations() {
    const [editing, setEditing] = useState<Operation | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [detailId, setDetailId] = useState<string | null>(null);
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

    const openEdit = (operation: Operation) => {
        setEditing(operation);
        setFormOpen(true);
    };

    const closeForm = () => {
        setFormOpen(false);
        setEditing(null);
    };

    async function save(form: HTMLFormElement) {
        const data = new FormData(form);
        const draft: OperationDraft = {
            name: String(data.get('name') ?? ''),
            date: String(data.get('date') ?? ''),
            surgeon: String(data.get('surgeon') ?? ''),
            institution: String(data.get('institution') ?? ''),
            type: String(data.get('type') ?? ''),
            notes: String(data.get('notes') ?? ''),
            id: editing?.id,
            revision: editing?.revision
        };
        setBusy(true);
        setMessage('');

        if (!draft.name.trim()) {
            setMessage('Ingresá un nombre para la operación.');
            setBusy(false);
            return;
        }
        if (!isValidDate(draft.date)) {
            setMessage('Ingresá una fecha válida.');
            setBusy(false);
            return;
        }
        if (!draft.type?.trim()) {
            setMessage('Ingresá el procedimiento.');
            setBusy(false);
            return;
        }

        try {
            const token = await driveAuth.getAccessToken();
            const owner = await getOwner();
            if (!owner) {
                setMessage('Conectate primero para verificar tu cuenta.');
                setBusy(false);
                return;
            }
            if (draft.id && (await outbox.list(owner)).some((item) => item.operationId === draft.id)) {
                setMessage('Esta operación ya tiene un cambio pendiente.');
                setBusy(false);
                return;
            }

            const result = await handleOfflineOperation(
                owner,
                async () => {
                    if (await driveAuth.getAccessToken() !== token) throw new Error('La cuenta cambió. Volvé a intentar.');
                    const saved = await driveOperationRepo.save(draft);
                    if (await driveAuth.getAccessToken() !== token) throw new Error('La cuenta cambió. Volvé a intentar.');
                    operations.value = [...operations.value.filter((op) => op.id !== saved.id), saved];
                    return saved;
                },
                async () => {
                    await enqueueOffline(owner, () => outbox.enqueueOperationSave(owner, draft), token);
                },
                'Operación guardada en este dispositivo; se sincronizará al volver la conexión.'
            );
            if (await driveAuth.getAccessToken() !== token) return;
            if (result === null) {
                setEditing(null);
                form.reset();
                setFormOpen(false);
                setMessage('Operación guardada en este dispositivo; se sincronizará al volver la conexión.');
            } else {
                setEditing(null);
                form.reset();
                setFormOpen(false);
            }
        } catch (err) {
            setMessage(err instanceof Error ? err.message : 'No se pudo guardar la operación.');
        } finally {
            setBusy(false);
        }
    }

    async function remove(op: Operation) {
        if (studies.value.some((study) => study.operationId === op.id)) {
            setMessage('Desvinculá los estudios antes de eliminar esta operación.');
            return;
        }
        if (!window.confirm(`¿Eliminar la operación ${op.name}?`)) return;
        setBusy(true);
        setMessage('');

        try {
            const token = await driveAuth.getAccessToken();
            const owner = await getOwner();
            if (!owner) {
                setMessage('Conectate primero para verificar tu cuenta.');
                setBusy(false);
                return;
            }
            const pending = await outbox.list(owner);
            if (pending.some((item) => item.operationId === op.id)) {
                setMessage('Esta operación ya tiene un cambio pendiente.');
                setBusy(false);
                return;
            }
            if (pending.some((item) => item.draft?.operationId === op.id)) {
                setMessage('Hay un estudio pendiente vinculado a esta operación.');
                setBusy(false);
                return;
            }

            await handleOfflineOperation(
                owner,
                async () => {
                    if (await driveAuth.getAccessToken() !== token) throw new Error('La cuenta cambió. Volvé a intentar.');
                    await driveOperationRepo.delete(op.id, op.revision ?? '');
                    if (await driveAuth.getAccessToken() !== token) throw new Error('La cuenta cambió. Volvé a intentar.');
                    operations.value = operations.value.filter((item) => item.id !== op.id);
                },
                async () => {
                    await enqueueOffline(owner, () => outbox.enqueueOperationDelete(owner, op.id, op.revision ?? ''), token);
                },
                'Eliminación pendiente de sincronización.'
            );
            if (await driveAuth.getAccessToken() !== token) return;
            setMessage('Operación eliminada.');
        } catch (err) {
            setMessage(err instanceof Error ? err.message : 'No se pudo eliminar la operación.');
        } finally {
            setBusy(false);
        }
    }

    async function setLink(study: Study, operationId: string) {
        setBusy(true);
        setMessage('');

        try {
            const token = await driveAuth.getAccessToken();
            const owner = await getOwner();
            if (!owner) {
                setMessage('Conectate primero para verificar tu cuenta.');
                setBusy(false);
                return;
            }
            const pending = await outbox.list(owner);
            if (pending.some((item) => item.studyId === study.id)) {
                setMessage('Este estudio ya tiene un cambio pendiente.');
                setBusy(false);
                return;
            }
            if (operationId && pending.some((item) => item.kind === 'operation-delete' && item.operationId === operationId)) {
                setMessage('La operación tiene una eliminación pendiente.');
                setBusy(false);
                return;
            }

            await handleOfflineOperation(
                owner,
                async () => {
                    if (await driveAuth.getAccessToken() !== token) throw new Error('La cuenta cambió. Volvé a intentar.');
                    const saved = await driveStudyRepo.save({...study, driveFileId: study.id, operationId});
                    if (await driveAuth.getAccessToken() !== token) throw new Error('La cuenta cambió. Volvé a intentar.');
                    studies.value = studies.value.map((item) => item.id === saved.id ? saved : item);
                },
                async () => {
                    await enqueueOffline(owner, () => outbox.enqueueSave(owner, {
                        ...study,
                        driveFileId: study.id,
                        operationId
                    }), token);
                },
                'Vínculo pendiente de sincronización.'
            );
            if (await driveAuth.getAccessToken() !== token) return;
            setMessage('Estudio actualizado.');
        } catch (err) {
            setMessage(err instanceof Error ? err.message : 'No se pudo actualizar el estudio.');
            if (err instanceof DriveConflictError) {
                try {
                    studies.value = await driveStudyRepo.list({force: true});
                } catch { /* Keep the displayed list if refresh also fails. */
                }
            }
        } finally {
            setBusy(false);
        }
    }

    const detail = operations.value.find((op) => op.id === detailId);
    const normalizedQuery = normalize(query);
    const visible = [...visibleOperations.value]
        .filter((operation) => {
            if (!normalizedQuery) return true;
            return [operation.name, operation.date, operation.surgeon, operation.institution, operation.type]
                .some((value) => normalize(value ?? '').includes(normalizedQuery));
        })
        .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

    if (detail) {
        const orderedStudies = [...studies.value].sort((a, b) => b.date.localeCompare(a.date));
        const linkedCount = orderedStudies.filter((study) => study.operationId === detail.id).length;
        return <section className="operation-detail" id="operation-detail" aria-labelledby="operation-detail-title">
            <button className="button ghost button-sm operation-back" type="button" onClick={() => setDetailId(null)}>
                <svg className="icon">
                    <use href="#i-chevron-left"/>
                </svg>
                Volver a operaciones
            </button>

            <div className="operation-detail-head">
                <div>
                    <p className="eyebrow">Ficha</p>
                    <h2 id="operation-detail-title">{detail.name}</h2>
                    <p className="operation-meta">{[detail.date, detail.surgeon, detail.institution, detail.type].filter(Boolean).join(' · ')}</p>
                </div>
                <span className="count-badge">{linkedCount} {linkedCount === 1 ? 'estudio' : 'estudios'}</span>
            </div>

            {detail.notes && <p className="operation-notes">{detail.notes}</p>}
            {message && <p className="operation-message" role="alert">{message}</p>}

            <div className="linked-head">
                <h3>Estudios vinculados</h3>
                <p>Seleccioná los estudios que pertenecen a esta operación. Un estudio puede pertenecer a una sola
                    operación.</p>
            </div>

            {orderedStudies.length ? (
                <ul className="linked-list">
                    {orderedStudies.map((study) => {
                        const linked = study.operationId === detail.id;
                        const other = study.operationId && !linked;
                        return <li className="linked-item" key={study.id} data-linked={linked ? 'true' : 'false'}>
                            <label>
                                <input type="checkbox" data-study-id={study.id} checked={linked} disabled={busy}
                                       onChange={(event) => void setLink(study, event.currentTarget.checked ? detail.id : '')}/>
                                <span className="linked-title">{study.title}</span>
                                <time className="linked-date" dateTime={study.date}>{study.date}</time>
                                {other && <span className="tag">Otra operación</span>}
                            </label>
                        </li>;
                    })}
                </ul>
            ) : (
                <p className="linked-empty">Todavía no hay estudios para vincular.</p>
            )}
        </section>;
    }

    return <section className="operations" aria-labelledby="operations-title">
        <div className="operations-head">
            <div>
                <p className="eyebrow">Historial</p>
                <h2 id="operations-title">Operaciones</h2>
                <p className="operations-desc">Cirugías y procedimientos con sus estudios vinculados.</p>
            </div>
            <div className="operations-head-actions">
                <span className="count-badge">{visibleOperations.value.length}</span>
                <button className="button primary" type="button" onClick={openNew}>
                    <svg className="icon">
                        <use href="#i-plus"/>
                    </svg>
                    Agregar operación
                </button>
            </div>
        </div>

        <div className="operations-toolbar">
            <label className="operations-search">
                <svg className="icon">
                    <use href="#i-search"/>
                </svg>
                <span className="sr-only">Buscar operaciones</span>
                <input id="operation-search" type="search" placeholder="Buscar por nombre, cirujano o institución…"
                       value={query}
                       onInput={(event) => setQuery((event.target as HTMLInputElement).value)}/>
            </label>
        </div>

        {message && <p className="operation-message" role="alert">{message}</p>}

        {visible.length ? (
            <ul id="operations-list" className="operation-grid">
                {visible.map((operation) => {
                    const count = studies.value.filter((study) => study.operationId === operation.id).length;
                    const parts = (operation.date ?? '').split('-');
                    const month = parts[1] ? new Intl.DateTimeFormat('es-AR', {month: 'short'}).format(new Date(Number(parts[0]), Number(parts[1]) - 1, 1)).replace('.', '') : '';
                    const syncLabel = operation.syncStatus === 'conflict' ? 'Requiere revisión'
                        : operation.syncStatus === 'failed' ? 'No se puede sincronizar'
                            : operation.syncStatus === 'pending' ? 'Pendiente de sincronización' : '';
                    const syncTone = operation.syncStatus === 'conflict' || operation.syncStatus === 'failed' ? 'danger' : 'warning';
                    return <li className="operation-card" key={operation.id}>
                        <div className="operation-card-top">
                            <div className="operation-date" aria-label={operation.date || 'Sin fecha'}>
                                <span>{month || '—'}</span>
                                <strong>{parts[2] ?? '—'}</strong>
                            </div>
                            <div className="operation-title">
                                <h3>{operation.name}</h3>
                                <p>{operation.type || 'Cirugía'}</p>
                            </div>
                            {syncLabel && <span className="status-pill" data-tone={syncTone}>{syncLabel}</span>}
                        </div>

                        <p className="operation-meta">{[operation.surgeon, operation.institution].filter(Boolean).join(' · ') || 'Sin profesional'}</p>
                        {operation.notes && <p className="operation-notes">{operation.notes}</p>}

                        <div className="operation-card-foot">
                            <span className="count-badge">{count} {count === 1 ? 'estudio' : 'estudios'}</span>
                            <div className="operation-actions">
                                <button className="button secondary button-sm" type="button" data-detail
                                        disabled={Boolean(operation.syncStatus)}
                                        onClick={() => setDetailId(operation.id)}>Ver ficha
                                </button>
                                <button className="button ghost button-sm" type="button"
                                        disabled={Boolean(operation.syncStatus)}
                                        onClick={() => {
                                            filters.value = {...filters.value, operationId: operation.id};
                                            view.value = 'cronologia';
                                        }}>Ver estudios
                                </button>
                                <button className="button ghost button-sm" type="button"
                                        disabled={Boolean(operation.syncStatus)}
                                        onClick={() => openEdit(operation)}>Editar
                                </button>
                                <button className="button ghost button-sm operation-delete" type="button"
                                        disabled={busy || Boolean(operation.syncStatus)}
                                        onClick={() => void remove(operation)}>Eliminar
                                </button>
                            </div>
                        </div>
                    </li>;
                })}
            </ul>
        ) : (
            <div className="operation-empty">
                <span className="operation-empty-icon"><svg className="icon"><use href="#i-clipboard"/></svg></span>
                <p>{normalizedQuery ? 'No hay operaciones que coincidan con la búsqueda.' : 'Todavía no hay operaciones guardadas.'}</p>
                {normalizedQuery ? (
                    <button className="button secondary button-sm" type="button" onClick={() => setQuery('')}>Limpiar
                        búsqueda</button>
                ) : (
                    <button className="button secondary button-sm" type="button" onClick={openNew}>Agregar
                        operación</button>
                )}
            </div>
        )}

        <dialog ref={dialogRef} id="operation-dialog" className="dialog operation-dialog"
                aria-labelledby="operation-dialog-title" onClose={closeForm}>
            <form id="operation-form" key={editing?.id ?? 'new'} onSubmit={(event) => {
                event.preventDefault();
                void save(event.currentTarget);
            }}>
                <div className="dialog-heading">
                    <div>
                        <p className="eyebrow">Historial</p>
                        <h2 id="operation-dialog-title">{editing ? 'Editar operación' : 'Agregar operación'}</h2>
                    </div>
                    <button className="icon-button" type="button" aria-label="Cerrar" onClick={closeForm}
                            disabled={busy}>
                        <svg className="icon">
                            <use href="#i-close"/>
                        </svg>
                    </button>
                </div>

                <fieldset disabled={busy}>
                    <div className="operation-form-grid">
                        <label>Nombre <input id="operation-name" name="name" required maxLength={120}
                                             defaultValue={editing?.name ?? ''}/></label>
                        <label>Fecha <input id="operation-date" name="date" type="date" required
                                            defaultValue={editing?.date ?? ''}/></label>
                        <label>Cirujano <input name="surgeon" defaultValue={editing?.surgeon ?? ''}/></label>
                        <label>Institución <input name="institution" defaultValue={editing?.institution ?? ''}/></label>
                        <label className="wide">Procedimiento <input id="operation-type" name="type" required
                                                                     defaultValue={editing?.type ?? ''}/></label>
                        <label className="wide">Notas <textarea name="notes"
                                                                defaultValue={editing?.notes ?? ''}/></label>
                    </div>
                    <div className="dialog-actions">
                        <button className="button secondary" type="button" onClick={closeForm}
                                disabled={busy}>Cancelar
                        </button>
                        <button className="button primary" type="submit"
                                disabled={busy || !driveAuth.configured}>{busy ? 'Guardando…' : 'Guardar operación'}</button>
                    </div>
                </fieldset>
            </form>
        </dialog>
    </section>;
}
