/** Confirmación de eliminación y reconexión de Drive. */
import {useEffect, useRef} from 'preact/hooks';
import {deletingStudyId} from '../state/store';
import type {Study} from '@domain/models';
import {useFocusTrap} from '../utils/focusTrap';

interface ConfirmDialogProps {
    studies: Study[];
    onConfirm: (studyId: string) => void;
    onCancel: () => void;
    onReconnect: () => void;
    error: string | null;
    busy: boolean;
    sessionLost: boolean;
}

export function ConfirmDialog({
                                  studies,
                                  onConfirm,
                                  onCancel,
                                  onReconnect,
                                  error,
                                  busy,
                                  sessionLost
                              }: ConfirmDialogProps) {
    const dialog = useRef<HTMLDialogElement>(null);
    const id = deletingStudyId.value;
    const study = studies.find((s) => s.id === id);

    // Focus trap for accessibility
    useFocusTrap(dialog, Boolean(id));

    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        if (id && !element.open) {
            element.showModal();
            element.querySelector<HTMLButtonElement>('.quiet')?.focus();
        } else if (!id && element.open) element.close();
    }, [id]);
    return (
        <dialog id="confirm" ref={dialog} className="dialog" aria-labelledby="confirm-title" data-busy={String(busy)}
                onCancel={(event) => {
                    if (busy) event.preventDefault(); else onCancel();
                }}>
            <form id="delete-form" onSubmit={(event) => {
                event.preventDefault();
                if (id && !busy) onConfirm(id);
            }}>
                <div className="dialog-heading">
                    <div><h2 id="confirm-title">Eliminar estudio</h2>
                        <p id="delete-copy">{study ? `«${study.title}» se moverá a la papelera de Google Drive.` : ''}</p>
                    </div>
                    <button type="button" className="icon-button" aria-label="Cerrar" disabled={busy}
                            onClick={onCancel}>
                        <svg className="icon">
                            <use href="#i-close"/>
                        </svg>
                    </button>
                </div>
                <p className="form-error" id="delete-error" role="alert" hidden={!error}>{error}</p>
                <button type="button" className="button secondary reconnect" hidden={!sessionLost}
                        onClick={onReconnect}>Reconectar Google Drive
                </button>
                <div className="dialog-actions">
                    <button type="button" className="button quiet" disabled={busy} onClick={onCancel}>Cancelar</button>
                    <button type="submit" className="button danger" id="delete"
                            disabled={busy}>{busy ? 'Eliminando…' : 'Eliminar estudio'}</button>
                </div>
            </form>
        </dialog>
    );
}
