import {useEffect, useRef, useState} from 'preact/hooks';
import {enqueueOffline} from '../utils/enqueueOffline';
import {
    recoveringStudyId,
    recoveryError,
    setRecoveringStudyId,
    setRecoveryError,
    setStudies,
    studies,
    pendingChanges,
    episodes,
    operations,
    portals,
    medicalEvents,
    appointments
} from '../state/store';
import {useFocusTrap} from '../utils/focusTrap';
import {
    driveAuth,
    driveStudyRepo,
    driveEpisodeRepo,
    driveOperationRepo,
    drivePortalRepo,
    driveMedicalEventRepo,
    driveAppointmentRepo
} from '@data';
import {Outbox} from '@data/outbox';
import type {Study, Episode, Operation, Portal, MedicalEvent, Appointment} from '@domain/models';

const outbox = new Outbox();

interface RecoveryDialogProps {
    onReconnect: () => void;
    error: string | null;
    sessionLost: boolean;
}

interface DeletedItem {
    id: string;
    title: string;
    date: string;
    deletedAt: string;
    recoverable: boolean;
    revision: string;
    type: 'study' | 'episode' | 'operation' | 'portal' | 'event' | 'appointment';
}

type EntityType = 'study' | 'episode' | 'operation' | 'portal' | 'event' | 'appointment';

const ENTITY_TYPES: { value: EntityType; label: string; icon: string }[] = [
    {value: 'study', label: 'Estudios', icon: 'i-file'},
    {value: 'episode', label: 'Episodios', icon: 'i-activity'},
    {value: 'operation', label: 'Operaciones', icon: 'i-scissors'},
    {value: 'portal', label: 'Portales', icon: 'i-globe'},
    {value: 'event', label: 'Consultas/Recetas', icon: 'i-stethoscope'},
    {value: 'appointment', label: 'Turnos', icon: 'i-calendar'},
];

export function RecoveryDialog({onReconnect, error, sessionLost}: RecoveryDialogProps) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const requestGeneration = useRef(0);
    const recoveringId = recoveringStudyId.value;
    const recError = recoveryError.value;

    const [deletedItems, setDeletedItems] = useState<Record<EntityType, DeletedItem[]>>({
        study: [], episode: [], operation: [], portal: [], event: [], appointment: [],
    });
    const [activeTab, setActiveTab] = useState<EntityType>('study');
    const [loading, setLoading] = useState(true);
    const [loadErrors, setLoadErrors] = useState<Record<EntityType, string>>({
        study: '', episode: '', operation: '', portal: '', event: '', appointment: '',
    });

    useFocusTrap(dialogRef, !!recoveringId);

    useEffect(() => driveAuth.onAuthChange((signedIn: boolean) => {
        if (!signedIn) {
            requestGeneration.current += 1;
            setDeletedItems({study: [], episode: [], operation: [], portal: [], event: [], appointment: []});
            setRecoveringStudyId(null);
            setRecoveryError(null);
            setLoadErrors({study: '', episode: '', operation: '', portal: '', event: '', appointment: ''});
        }
    }), []);

    useEffect(() => {
        const element = dialogRef.current;
        if (!element) return;
        if (recoveringId && !element.open) {
            void loadDeletedItems();
            element.showModal();
            element.querySelector<HTMLElement>('#recovery-title')?.focus();
        } else if (!recoveringId && element.open) element.close();
    }, [recoveringId]);

    async function loadDeletedItems() {
        const generation = ++requestGeneration.current;
        setLoading(true);
        setRecoveryError(null);
        setLoadErrors({study: '', episode: '', operation: '', portal: '', event: '', appointment: ''});

        const repos = {
            study: driveStudyRepo,
            episode: driveEpisodeRepo,
            operation: driveOperationRepo,
            portal: drivePortalRepo,
            event: driveMedicalEventRepo,
            appointment: driveAppointmentRepo,
        };

        try {
            const token = await driveAuth.getAccessToken();
            const results = await Promise.allSettled(
                (Object.keys(repos) as EntityType[]).map(async (type) => {
                    const data = await repos[type].listDeleted();
                    return {type, data};
                })
            );

            if (generation !== requestGeneration.current || await driveAuth.getAccessToken() !== token) return;

            const newItems: Record<EntityType, DeletedItem[]> = {
                study: [], episode: [], operation: [], portal: [], event: [], appointment: [],
            };
            const newErrors: Record<EntityType, string> = {
                study: '', episode: '', operation: '', portal: '', event: '', appointment: '',
            };

            for (const result of results) {
                if (result.status === 'fulfilled') {
                    newItems[result.value.type] = result.value.data.map(item => ({...item, type: result.value.type}));
                } else {
                    const reason = result.reason as { type?: EntityType; message?: string } | undefined;
                    newErrors[reason?.type || 'study'] = reason?.message || 'Error al cargar';
                }
            }

            const hasAnyError = Object.values(newErrors).some(e => e.length > 0);
            if (hasAnyError) {
                const firstError = Object.values(newErrors).find(e => e.length > 0);
                setRecoveryError(firstError || 'Error al cargar algunos elementos');
            }

            setDeletedItems(newItems);
            setLoadErrors(newErrors);
        } catch (err) {
            if (generation === requestGeneration.current) {
                setDeletedItems({study: [], episode: [], operation: [], portal: [], event: [], appointment: []});
                setRecoveryError(err instanceof Error ? err.message : 'No se pudieron consultar los elementos eliminados.');
            }
        } finally {
            if (generation === requestGeneration.current) setLoading(false);
        }
    }

    const handleClose = () => {
        requestGeneration.current += 1;
        dialogRef.current?.close();
        setDeletedItems({study: [], episode: [], operation: [], portal: [], event: [], appointment: []});
        setRecoveringStudyId(null);
        setRecoveryError(null);
        setLoadErrors({study: '', episode: '', operation: '', portal: '', event: '', appointment: ''});
    };

    const handleCancel = () => {
        handleClose();
    };

    async function handleRecover(item: DeletedItem) {
        if (!item.recoverable) return;
        setRecoveryError(null);

        try {
            setLoading(true);
            const token = await driveAuth.getAccessToken();

            const restoreMap = {
                study: () => driveStudyRepo.restore(item.id, item.revision) as Promise<Study>,
                episode: () => driveEpisodeRepo.restore(item.id, item.revision) as Promise<Episode>,
                operation: () => driveOperationRepo.restore(item.id, item.revision) as Promise<Operation>,
                portal: () => drivePortalRepo.restore(item.id, item.revision) as Promise<Portal>,
                event: () => driveMedicalEventRepo.restore(item.id, item.revision) as Promise<MedicalEvent>,
                appointment: () => driveAppointmentRepo.restore(item.id, item.revision) as Promise<Appointment>,
            };

            const enqueueMap = {
                study: (owner: string) => outbox.enqueueRestore(owner, item.id, item.revision),
                episode: (owner: string) => outbox.enqueueEpisodeRestore(owner, item.id, item.revision),
                operation: (owner: string) => outbox.enqueueOperationRestore(owner, item.id, item.revision),
                portal: (owner: string) => outbox.enqueuePortalRestore(owner, item.id, item.revision),
                event: (owner: string) => outbox.enqueueEventRestore(owner, item.id, item.revision),
                appointment: (owner: string) => outbox.enqueueAppointmentRestore(owner, item.id, item.revision),
            };

            const updateStateMap = {
                study: (recovered: Study) => setStudies([...studies.value, recovered]),
                episode: (recovered: Episode) => episodes.value = [...episodes.value, recovered],
                operation: (recovered: Operation) => operations.value = [...operations.value, recovered],
                portal: (recovered: Portal) => portals.value = [...portals.value, recovered],
                event: (recovered: MedicalEvent) => medicalEvents.value = [...medicalEvents.value, recovered],
                appointment: (recovered: Appointment) => appointments.value = [...appointments.value, recovered],
            };

            if (!navigator.onLine) {
                const owner = driveAuth.cachedAccountId();
                if (!owner || !navigator.locks) throw new Error('Se necesita una cuenta verificada y un navegador compatible para recuperar sin conexión.');
                await enqueueOffline(owner, () => enqueueMap[item.type](owner), token);
                if (await driveAuth.getAccessToken() !== token) return;
                pendingChanges.value = await outbox.list(owner);
                window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
                return;
            }

            type UpdateStateFn = (recovered: Study | Episode | Operation | Portal | MedicalEvent | Appointment) => void;

            const recovered = await restoreMap[item.type]();
            if (await driveAuth.getAccessToken() !== token) return;
            (updateStateMap as Record<EntityType, UpdateStateFn>)[item.type](recovered);
            setDeletedItems(prev => ({
                ...prev,
                [item.type]: prev[item.type].filter(i => i.id !== item.id),
            }));
        } catch (err) {
            setRecoveryError(err instanceof Error ? err.message : 'Error de red al recuperar');
        } finally {
            setLoading(false);
        }
    }

    const currentItems = deletedItems[activeTab];
    const currentError = loadErrors[activeTab];
    const hasPending = (item: DeletedItem) => pendingChanges.value.some(entry => {
        const kindMap = {
            study: 'restore',
            episode: 'episode-restore',
            operation: 'operation-restore',
            portal: 'portal-restore',
            event: 'event-restore',
            appointment: 'appointment-restore',
        };
        return entry.kind === kindMap[item.type] &&
            (entry.studyId === item.id || entry.episodeId === item.id || entry.operationId === item.id || entry.portalId === item.id || entry.eventId === item.id || entry.appointmentId === item.id);
    });

    return (
        <dialog id="recovery" ref={dialogRef} className="dialog" aria-labelledby="recovery-title"
                data-busy={String(loading)}
                onCancel={(event) => {
                    if (loading) event.preventDefault(); else handleCancel();
                }}>
            <form id="recovery-form" onSubmit={(event) => {
                event.preventDefault();
            }}>
                <div className="dialog-heading">
                    <div><h2 id="recovery-title" tabIndex={-1}>Recuperar elementos eliminados</h2>
                        <p id="recovery-copy">Recuperá estudios, episodios, operaciones, portales, consultas, recetas y
                            turnos eliminados durante los últimos 30 días. Sin conexión se usa la última lista
                            consultada.</p>
                    </div>
                    <button type="button" className="icon-button" aria-label="Cerrar" disabled={loading}
                            onClick={handleCancel}>
                        <svg className="icon">
                            <use href="#i-close"/>
                        </svg>
                    </button>
                </div>
                <p className="form-error" id="recovery-error" role="alert"
                   hidden={!error && !recError}>{error || recError}</p>
                <button type="button" className="button secondary reconnect" hidden={!sessionLost}
                        onClick={onReconnect}>Reconectar Google Drive
                </button>

                <div role="tablist" aria-label="Tipos de elementos" className="recovery-tablist">
                    {ENTITY_TYPES.map(({value, label, icon}, index) => (
                        <button
                            key={value}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === value}
                            aria-controls={`panel-${value}`}
                            id={`tab-${value}`}
                            tabIndex={activeTab === value ? 0 : -1}
                            onClick={() => setActiveTab(value)}
                            onKeyDown={(event) => {
                                if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
                                event.preventDefault();
                                const delta = event.key === 'ArrowRight' ? 1 : -1;
                                const nextIndex = (index + delta + ENTITY_TYPES.length) % ENTITY_TYPES.length;
                                const nextTab = ENTITY_TYPES[nextIndex];
                                if (nextTab) {
                                    setActiveTab(nextTab.value);
                                    dialogRef.current?.querySelector<HTMLButtonElement>(`#tab-${nextTab.value}`)?.focus();
                                }
                            }}
                            className={`tab-button ${activeTab === value ? 'active' : ''}`}
                            disabled={loading}
                        >
                            <svg className="icon" aria-hidden="true">
                                <use href={`#${icon}`}/>
                            </svg>
                            <span>{label}</span>
                            <span className="recovery-tab-count">
                                {deletedItems[value].length}
                            </span>
                        </button>
                    ))}
                </div>

                <div className="recovery-panel-scroll">
                    {loading ? (
                        <p className="list-status" role="status">Cargando elementos recuperables…</p>
                    ) : currentError ? (
                        <div className="empty-state recovery-empty-state">
                            <p className="recovery-error-text">{currentError}</p>
                        </div>
                    ) : currentItems.length === 0 ? (
                        <div className="empty-state recovery-empty-state">
                            <svg className="icon recovery-empty-icon" aria-hidden="true">
                                <use href="#i-trash-off"/>
                            </svg>
                            <h3>No
                                hay {ENTITY_TYPES.find(t => t.value === activeTab)?.label.toLowerCase()} recuperables</h3>
                            <p className="recovery-empty-copy">Los elementos eliminados hace más de 30
                                días no se pueden recuperar</p>
                        </div>
                    ) : (
                        <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
                            <ul className="recovery-list">
                                {currentItems.map(item => (
                                    <li key={item.id} className="recovery-item">
                                        <div className="recovery-item-info">
                                            <h4>{item.title}</h4>
                                            <p className="recovery-item-meta">
                                                {item.date ? `Fecha: ${item.date} · ` : ''}Eliminado: {item.deletedAt ? new Date(item.deletedAt).toLocaleDateString('es-AR') : 'fecha desconocida'}
                                            </p>
                                            {!item.recoverable && (
                                                <p className="recovery-item-warning">
                                                    Consultá la papelera de Google Drive para este elemento.
                                                </p>
                                            )}
                                        </div>
                                        {hasPending(item) ? (
                                            <p role="status">Recuperación pendiente de sincronización</p>
                                        ) : item.recoverable && (
                                            <button
                                                type="button"
                                                className="button primary recovery-action-btn"
                                                onClick={() => handleRecover(item)}
                                                disabled={loading}
                                            >
                                                Recuperar
                                            </button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
                <p className="recovery-drive-link"><a href="https://drive.google.com/drive/trash" target="_blank"
                                                      rel="noopener noreferrer">Abrir
                    papelera de Google Drive</a></p>
                <div className="dialog-actions">
                    <button type="button" className="button quiet" disabled={loading} onClick={handleCancel}>Cerrar
                    </button>
                </div>
            </form>
        </dialog>
    );
}
