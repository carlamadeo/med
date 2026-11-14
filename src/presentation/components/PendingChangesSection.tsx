import type {OutboxEntry} from '@data/outbox';
import {
    pendingChanges,
    syncMessage,
    syncing,
    operations,
    portals,
    studies,
    medicalEvents,
    appointments
} from '../state/store';
import type {AppointmentDraft} from '@domain/models';

function AppointmentDetails({value}: { value: AppointmentDraft }) {
    const statuses = {scheduled: 'Programado', completed: 'Realizado', cancelled: 'Cancelado', absent: 'No asistí'};
    const coverages = {all: 'Total', partial: 'Parcial', none: 'Sin cobertura'};
    return <>
        <p>Fecha y hora: {value.date} {value.time} · {value.timeZone}</p>
        <p>Profesional: {value.professional || '—'}</p>
        <p>Detalles: {value.notes || '—'}</p>
        <p>Estado: {statuses[value.status]}</p>
        <p>Importe: {value.cost === null ? 'Desconocido' : value.cost} ·
            Cobertura: {value.coverage ? coverages[value.coverage] : 'Desconocida'}</p>
        <p>Recordatorio: {value.reminderMinutes ? `${value.reminderMinutes} minutos antes` : 'Sin recordatorio'}</p>
    </>;
}

interface PendingChangesSectionProps {
    onDiscard: (entry: OutboxEntry) => void;
    onRetrySync: () => void;
    onResolveConflict: (entry: OutboxEntry, revision: string) => void;
}

export function PendingChangesSection({onDiscard, onRetrySync, onResolveConflict}: PendingChangesSectionProps) {
    const changes = pendingChanges.value;
    const message = syncMessage.value;
    const isSyncing = syncing.value;
    const defaultMessage = changes.some((entry) => entry.status === 'failed')
        ? 'Hay un cambio que no se puede sincronizar. Revisalo o descartalo para continuar.'
        : changes.some((entry) => entry.status === 'conflict')
            ? 'Hay un cambio que requiere revisión antes de sincronizar.'
            : 'Se enviarán a Drive al recuperar la conexión.';

    if (changes.length === 0 && !message) return null;

    const tone = isSyncing ? 'info' : changes.some((entry) => entry.status === 'failed') ? 'danger' : changes.some((entry) => entry.status === 'conflict') ? 'warning' : 'neutral';

    return (
        <section id="pending-changes" className="pending-changes" aria-labelledby="pending-changes-title">
            <div className="pending-head">
                <h2 id="pending-changes-title">Cambios pendientes</h2>
                <span className="count-badge">{changes.length}</span>
            </div>
            <p className="pending-status" data-tone={tone} role="status">{isSyncing ? 'Sincronizando cambios con Google Drive…' : message || defaultMessage}</p>
            <ul className="pending-list">{changes.map((entry) => {
                const remote = entry.studyId ? studies.value.find((study) => study.id === entry.studyId)
                    : entry.operationId ? operations.value.find((operation) => operation.id === entry.operationId)
                        : entry.portalId ? portals.value.find((portal) => portal.id === entry.portalId)
                            : entry.eventId ? medicalEvents.value.find((event) => event.id === entry.eventId) : undefined;
                return (
                    <li key={entry.id} className="pending-item" data-status={entry.status}>
                        {entry.kind === 'appointment-save'
                            ? `Turno ${entry.appointmentDraft?.date ?? ''} ${entry.appointmentDraft?.time ?? ''}`
                            : entry.kind === 'restore'
                                ? 'Recuperar estudio'
                                : entry.kind === 'delete'
                                    ? `Eliminar ${studies.value.find((s) => s.id === entry.studyId)?.title ?? 'estudio'}`
                                    : entry.kind === 'operation-delete'
                                        ? `Eliminar ${operations.value.find((op) => op.id === entry.operationId)?.name ?? 'operación'}`
                                        : entry.kind === 'portal-delete'
                                            ? `Eliminar ${entry.portal?.displayName ?? 'portal'}`
                                            : entry.kind === 'episode-save'
                                                ? entry.episodeDraft?.illness || 'Episodio de salud'
                                                : entry.kind === 'episode-delete'
                                                    ? 'Eliminar episodio'
                                                    : entry.kind === 'appointment-delete'
                                                        ? 'Eliminar turno'
                                                        : entry.kind === 'event-delete'
                                                            ? 'Eliminar evento'
                                                            : entry.kind.endsWith('-restore')
                                                                ? 'Recuperar registro'
                                                                : entry.draft?.title ?? entry.operationDraft?.name ?? entry.portalDraft?.displayName ?? (entry.eventDraft ? (entry.eventDraft.kind === 'consultation' ? 'Consulta' : 'Receta') : 'Cambio sin datos válidos')}
                        {entry.status === 'conflict' ? ' · requiere revisión' : entry.status === 'failed' ? ' · no se puede sincronizar' : ''}
                        {entry.draft && (
                            <span> · {entry.draft.date} · {entry.draft.types.join(', ')} · {entry.draft.doctor}</span>
                        )}
                        {entry.lastError && <p>{entry.lastError}</p>}
                        {entry.draft && (
                            <details>
                                <summary>Ver datos pendientes</summary>
                                <p>Portal: {entry.draft.portal || '—'}</p>
                                <p>Visor: {entry.draft.viewer || '—'}</p>
                                <p>Operación: {operations.value.find((item) => item.id === entry.draft?.operationId)?.name ?? (entry.draft.operationId || '—')}</p>
                                <p>PDF: {entry.attachmentName || (entry.draft.removeReport ? 'Se quitará el PDF' : 'Sin cambio')}</p>
                            </details>
                        )}
                        {entry.operationDraft && (
                            <details>
                                <summary>Ver datos pendientes</summary>
                                <p>Fecha: {entry.operationDraft.date || '—'}</p>
                                <p>Cirujano: {entry.operationDraft.surgeon || '—'}</p>
                                <p>Institución: {entry.operationDraft.institution || '—'}</p>
                                <p>Intervención: {entry.operationDraft.type || '—'}</p>
                                <p>Notas: {entry.operationDraft.notes || '—'}</p>
                            </details>
                        )}
                        {entry.portalDraft && (
                            <details>
                                <summary>Ver datos pendientes</summary>
                                <p>Enlace: {entry.portalDraft.url || '—'}</p>
                                <p>Notas: {entry.portalDraft.notes || '—'}</p>
                            </details>
                        )}
                        {entry.eventDraft && <details>
                            <summary>Ver datos pendientes</summary>
                            <p>Fecha: {entry.eventDraft.date}</p><p>Médico: {entry.eventDraft.doctor || '—'}</p>
                            <p>Notas: {entry.eventDraft.notes || '—'}</p>
                        </details>}
                        {entry.status === 'conflict' && entry.kind === 'appointment-save' && entry.appointmentDraft &&
                            <details>
                                <summary>Comparar con Drive</summary>
                                <p>Mi cambio</p><AppointmentDetails value={entry.appointmentDraft}/>
                                {(() => {
                                    const remoteAppointment = appointments.value.find(item => item.id === entry.appointmentId);
                                    return remoteAppointment ? <>
                                        <p>Versión de Drive</p><AppointmentDetails value={remoteAppointment}/>
                                        <p>Revisión de Drive: {remoteAppointment.revision}</p>
                                        <button type="button" className="button secondary"
                                                disabled={isSyncing || !navigator.onLine || !remoteAppointment.revision}
                                                onClick={() => onResolveConflict(entry, remoteAppointment.revision)}>Conservar
                                            mi cambio
                                        </button>
                                    </> : <p>No se pudo mostrar la versión de Drive. Conectate y reintentá.</p>;
                                })()}
                            </details>}
                        {entry.status === 'conflict' && entry.kind !== 'appointment-save' && <details>
                            <summary>Comparar con Drive</summary>
                            <p>Mi
                                cambio: {entry.draft?.title ?? entry.operationDraft?.name ?? entry.portalDraft?.displayName ?? (entry.eventDraft ? (entry.eventDraft.kind === 'consultation' ? 'Consulta' : 'Receta') : 'Eliminar registro')}</p>
                            {remote ? <>
                                <p>Versión de
                                    Drive: {'title' in remote ? remote.title : 'displayName' in remote ? remote.displayName : 'name' in remote ? remote.name : remote.kind === 'consultation' ? 'Consulta' : 'Receta'}</p>
                                {'date' in remote && <p>Fecha en Drive: {remote.date || '—'}</p>}
                                {'doctor' in remote && <p>Médico en Drive: {remote.doctor || '—'}</p>}
                                {'types' in remote && <p>Tipos en Drive: {remote.types.join(', ') || '—'}</p>}
                                {'portal' in remote && <p>Portal en Drive: {remote.portal || '—'}</p>}
                                {'viewer' in remote && <p>Visor en Drive: {remote.viewer || '—'}</p>}
                                {'hasPdf' in remote && <p>PDF en
                                    Drive: {remote.hasPdf ? remote.reportName || 'Disponible' : 'Sin PDF'}</p>}
                                {'surgeon' in remote && <p>Cirujano en Drive: {remote.surgeon || '—'}</p>}
                                {'institution' in remote && <p>Institución en Drive: {remote.institution || '—'}</p>}
                                {'type' in remote && <p>Intervención en Drive: {remote.type || '—'}</p>}
                                {'url' in remote && <p>Enlace en Drive: {remote.url || '—'}</p>}
                                {'notes' in remote && <p>Notas en Drive: {remote.notes || '—'}</p>}
                                <p>Revisión de Drive: {remote.revision || 'No disponible'}</p>
                                <button type="button" className="button secondary"
                                        disabled={isSyncing || !navigator.onLine || !remote.revision}
                                        onClick={() => remote.revision && onResolveConflict(entry, remote.revision)}>Conservar
                                    mi cambio
                                </button>
                            </> : <p>No se pudo mostrar la versión de Drive. Conectate y reintentá.</p>}
                        </details>}
                        <button
                            type="button"
                            className="button quiet"
                            disabled={isSyncing}
                            onClick={() => onDiscard(entry)}
                        >
                            Descartar
                        </button>
                    </li>
                );
            })}</ul>
            {navigator.onLine && (
                <button
                    type="button"
                    className="button secondary"
                    disabled={isSyncing}
                    onClick={onRetrySync}
                >
                    Reintentar sincronización
                </button>
            )}
        </section>
    );
}
