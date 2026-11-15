import {useEffect, useRef} from 'preact/hooks';
import type {Study} from '@domain/models';
import {formatStudyDate} from '@domain/library';
import {useFocusTrap} from '../utils/focusTrap';

interface StudyPrintDialogProps {
    study: Study | null;
    onClose: () => void;
}

export function StudyPrintDialog({study, onClose}: StudyPrintDialogProps) {
    const dialog = useRef<HTMLDialogElement>(null);
    useFocusTrap(dialog, Boolean(study));
    useEffect(() => {
        const element = dialog.current;
        if (!element) return;
        if (study && !element.open) element.showModal();
        else if (!study && element.open) element.close();
    }, [study]);

    return <dialog ref={dialog} className="dialog study-print-dialog" aria-labelledby="study-print-title"
                   onCancel={onClose}>
        {study && <>
            <div className="dialog-heading print-controls">
                <div>
                    <h2 id="study-print-title">Preparar impresión</h2>
                    <p>Revisá el contenido antes de imprimir.</p>
                </div>
                <button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}>×</button>
            </div>
            <p className="study-print-note print-controls">Los archivos adjuntos se imprimen por separado. Las copias impresas quedan fuera de los controles de acceso de Drive.</p>
            <article className="study-print-record">
                <p className="study-print-kicker">Mis estudios · 1 estudio</p>
                <h2>{study.title}</h2>
                <dl>
                    <div><dt>Fecha del estudio</dt><dd>{formatStudyDate(study.date)}</dd></div>
                    <div><dt>Tipo</dt><dd>{study.types.join(', ') || 'Sin tipo'}</dd></div>
                    {study.doctor && <div><dt>Profesional</dt><dd>{study.doctor}</dd></div>}
                    {study.portal && <div><dt>Institución</dt><dd>{study.portal}</dd></div>}
                    <div><dt>Fuentes</dt><dd>{study.hasPdf || study.attachmentMime || study.pendingAttachment ? 'Informe adjunto' : 'Sin informe adjunto'}{study.documentIds?.length ? ` · ${study.documentIds.length} documento(s) asociado(s)` : ''}{study.viewer ? ' · enlace al visor' : ''}</dd></div>
                </dl>
                {study.syncStatus && <p>Estado: {study.syncStatus === 'conflict' ? 'Requiere revisión' : study.syncStatus === 'failed' ? 'No se puede sincronizar' : 'Pendiente de sincronización'}</p>}
                <p className="study-print-generated">Preparado el {new Intl.DateTimeFormat('es-AR').format(new Date())}.</p>
            </article>
            <div className="dialog-actions print-controls">
                <button type="button" className="button quiet" onClick={onClose}>Cancelar</button>
                <button type="button" className="button primary" onClick={() => window.print()}>Imprimir</button>
            </div>
        </>}
    </dialog>;
}
