import {useEffect, useRef} from 'preact/hooks';
import {formatStudyDate, hasStudyAttachment, reportUrl, studyAttachmentName} from '@domain/library';
import type {Study} from '@domain/models';
import {isSourceUnavailable, operations, studies} from '../state/store';
import {useFocusTrap} from '../utils/focusTrap';

interface StudyDetailDialogProps {
    study: Study;
    returnFocus: HTMLButtonElement | null;
    onClose: () => void;
    onEdit: (study: Study) => void;
    onDelete: (study: Study) => void;
}

export function StudyDetailDialog({study, returnFocus, onClose, onEdit, onDelete}: StudyDetailDialogProps) {
    const dialog = useRef<HTMLDialogElement>(null);
    const attachmentAvailable = hasStudyAttachment(study) && study.driveFileId && !isSourceUnavailable(study.driveFileId);
    const viewerAvailable = study.viewer && !isSourceUnavailable(study.viewer);
    const operation = operations.value.find(item => item.id === study.operationId);
    const archive = studies.value;
    const documentIds = study.documentIds ?? [];
    const syncMessage = study.syncStatus === 'conflict' ? 'Requiere revisión'
        : study.syncStatus === 'failed' ? 'No se puede sincronizar' : 'Pendiente de sincronización';

    function close() {
        dialog.current?.close();
        returnFocus?.focus();
        onClose();
    }

    useEffect(() => {
        const element = dialog.current;
        element?.showModal();
        return () => {
            if (element?.open) {
                element.close();
                returnFocus?.focus();
            }
        };
    }, [returnFocus]);
    useFocusTrap(dialog);

    return (
        <dialog ref={dialog} className="dialog study-detail-dialog" aria-labelledby="study-detail-title"
                onCancel={event => { event.preventDefault(); close(); }}>
            <div className="dialog-heading">
                <div>
                    <p className="eyebrow">Biblioteca</p>
                    <h2 id="study-detail-title">{study.title}</h2>
                    {study.syncStatus && <p>{syncMessage}</p>}
                </div>
                <button className="icon-button" type="button" aria-label="Cerrar" onClick={close}>
                    <svg className="icon" aria-hidden="true"><use href="#i-close"/></svg>
                </button>
            </div>
            <dl className="study-detail-fields">
                <div><dt>Fecha del estudio</dt><dd><time dateTime={study.date}>{formatStudyDate(study.date)}</time></dd></div>
                <div><dt>Tipos de estudio</dt><dd>{study.types.join(', ') || 'Sin tipo'}</dd></div>
                {study.specialty && <div><dt>Especialidad</dt><dd>{study.specialty}</dd></div>}
                {study.doctor && <div><dt>Profesional</dt><dd>{study.doctor}</dd></div>}
                {study.portal && <div><dt>Institución</dt><dd>{study.portal}</dd></div>}
                {operation && <div><dt>Operación</dt><dd>{operation.name}</dd></div>}
            </dl>
            <section className="study-detail-section" aria-labelledby="study-detail-sources">
                <h3 id="study-detail-sources">Archivos y enlaces</h3>
                <ul>
                    <li>{attachmentAvailable ? (
                        <a href={reportUrl(study.driveFileId)} target="_blank" rel="noopener noreferrer">
                            {studyAttachmentName(study)}
                        </a>
                    ) : study.pendingAttachment ? 'Adjunto pendiente de sincronización'
                        : hasStudyAttachment(study) ? 'Archivo adjunto no disponible' : 'Sin archivo adjunto'}</li>
                    <li>{viewerAvailable ? <a href={study.viewer} target="_blank" rel="noopener noreferrer">Abrir visor</a>
                        : study.viewer ? 'Visor no disponible' : 'Sin enlace al visor'}</li>
                </ul>
            </section>
            {documentIds.length > 0 && (
                <section className="study-detail-section" aria-labelledby="study-detail-related">
                    <h3 id="study-detail-related">Estudios relacionados</h3>
                    <ul>
                        {documentIds.map(id => {
                            const document = archive.find(item => item.id === id);
                            return <li key={id}>{document && hasStudyAttachment(document) && document.driveFileId &&
                                !isSourceUnavailable(document.driveFileId) ? (
                                <a href={reportUrl(document.driveFileId)} target="_blank" rel="noopener noreferrer">{document.title}</a>
                            ) : document?.title ?? 'Documento asociado no disponible'}</li>;
                        })}
                    </ul>
                </section>
            )}
            <section className="study-detail-section" aria-labelledby="study-detail-copies">
                <h3 id="study-detail-copies">Copias impresas</h3>
                <ul className="study-detail-copy-list">
                    {[
                        {label: 'Informe', printed: study.printed?.report, status: 'Impreso'},
                        {label: 'Imagen', printed: study.printed?.image, status: 'Impresa'},
                    ].map(({label, printed, status}) => (
                        <li key={label}>
                            <span>{label}</span>
                            <span className="status-pill" data-tone={printed ? 'success' : 'neutral'}>
                                {printed && <svg className="icon" aria-hidden="true"><use href="#i-check"/></svg>}
                                {printed ? status : 'Sin registro'}
                            </span>
                        </li>
                    ))}
                </ul>
            </section>
            <div className="dialog-actions">
                <button className="button danger" type="button" disabled={Boolean(study.syncStatus)}
                        onClick={() => { close(); onDelete(study); }}>Eliminar</button>
                <button className="button primary" type="button" disabled={Boolean(study.syncStatus)}
                        onClick={() => { close(); onEdit(study); }}>Editar</button>
            </div>
        </dialog>
    );
}
