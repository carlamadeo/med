import type { OutboxEntry } from '@data/outbox';
import { pendingChanges, syncMessage, syncing, operations, studies } from '../state/store';

interface PendingChangesSectionProps {
  onDiscard: (entry: OutboxEntry) => void;
  onRetrySync: () => void;
}

export function PendingChangesSection({ onDiscard, onRetrySync }: PendingChangesSectionProps) {
  const changes = pendingChanges.value;
  const message = syncMessage.value;
  const isSyncing = syncing.value;

  if (changes.length === 0 && !message) return null;

  return (
    <section id="pending-changes" className="pending-changes" aria-label="Cambios pendientes">
      <h2>Cambios pendientes ({changes.length})</h2>
      <p role="status">{message || 'Se enviarán a Drive al recuperar la conexión.'}</p>
      <ul>{changes.map((entry) => (
        <li key={entry.id}>
          {entry.kind === 'delete'
            ? `Eliminar ${studies.value.find((s) => s.id === entry.studyId)?.title ?? 'estudio'}`
            : entry.kind === 'operation-delete'
            ? `Eliminar ${operations.value.find((op) => op.id === entry.operationId)?.name ?? 'operación'}`
            : entry.kind === 'portal-delete'
            ? `Eliminar ${entry.portal?.displayName ?? 'portal'}`
            : entry.draft?.title ?? entry.operationDraft?.name ?? entry.portalDraft?.displayName}
          {entry.status === 'conflict' ? ' · requiere revisión' : ''}
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
          <button
            type="button"
            className="button quiet"
            disabled={isSyncing}
            onClick={() => onDiscard(entry)}
          >
            Descartar
          </button>
        </li>
      ))}</ul>
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