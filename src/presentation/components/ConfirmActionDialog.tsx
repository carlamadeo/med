import {useEffect, useRef, useState} from 'preact/hooks';
import {useFocusTrap} from '../utils/focusTrap';

let nextDialogId = 0;

interface ConfirmActionDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/** Diálogo modal reutilizable para confirmar acciones destructivas en vistas secundarias. */
export function ConfirmActionDialog({
  open,
  title,
  message,
  confirmLabel = 'Eliminar',
  cancelLabel = 'Cancelar',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmActionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [titleId] = useState(() => `confirm-action-title-${++nextDialogId}`);
  const [descId] = useState(() => `confirm-action-desc-${nextDialogId}`);

  useFocusTrap(dialogRef, open);

  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      element.querySelector<HTMLButtonElement>('.confirm-action-cancel')?.focus();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="dialog confirm-action-dialog"
      aria-labelledby={titleId}
      aria-describedby={descId}
      data-busy={String(busy)}
      onCancel={event => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <form
        onSubmit={event => {
          event.preventDefault();
          if (!busy) void onConfirm();
        }}
      >
        <div className="dialog-heading">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p id={descId}>{message}</p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Cerrar"
            disabled={busy}
            onClick={onCancel}
          >
            <svg className="icon" aria-hidden="true">
              <use href="#i-close" />
            </svg>
          </button>
        </div>
        <div className="dialog-actions">
          <button
            type="button"
            className="button secondary confirm-action-cancel"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button type="submit" className="button danger" disabled={busy}>
            {busy ? 'Eliminando…' : confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
