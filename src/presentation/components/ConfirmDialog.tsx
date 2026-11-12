/**
 * Diálogo de confirmación para eliminar un estudio.
 */
import { deletingStudyId } from '../state/store';
import type { Study } from '@domain/models';

interface ConfirmDialogProps {
  studies: Study[];
  onConfirm: (studyId: string) => void;
  onCancel: () => void;
  onReconnect: () => void;
  error: string | null;
  busy: boolean;
}

export function ConfirmDialog({
  studies,
  onConfirm,
  onCancel,
  onReconnect,
  error,
  busy,
}: ConfirmDialogProps) {
  const study = studies.find((s) => s.id === deletingStudyId.value);

  return (
    <dialog
      className="dialog"
      aria-labelledby="confirm-title"
      data-busy={busy ? 'true' : undefined}
      open={!!deletingStudyId.value}
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onCancel();
      }}
    >
      <form className="dialog-heading" onSubmit={(e) => e.preventDefault()}>
        <div>
          <h2 id="confirm-title">Eliminar estudio</h2>
          <p id="delete-copy">
            {study ? `«${study.title}» se moverá a la papelera de Google Drive.` : ''}
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          data-close
          aria-label="Cerrar"
          onClick={() => onCancel()}
        >
          <svg className="icon"><use href="#i-close" /></svg>
        </button>
      </form>
      {error && (
        <p className="form-error" id="delete-error" role="alert">
          {error}
        </p>
      )}
      {typeof error === 'object' && error !== null && (error as { name?: string }).name === 'DriveSessionError' ? (
        <button type="button" className="button secondary reconnect" onClick={() => onReconnect()}>
          Reconectar Google Drive
        </button>
      ) : null}
      <div className="dialog-actions">
        <button type="button" className="button quiet" data-close onClick={() => onCancel()}>
          Cancelar
        </button>
        <button
          type="submit"
          className="button danger"
          id="delete"
          disabled={busy}
          onClick={() => {
            if (deletingStudyId.value) onConfirm(deletingStudyId.value);
          }}
        >
          {busy ? 'Eliminando…' : 'Eliminar estudio'}
        </button>
      </div>
    </dialog>
  );
}
