/** Lista de estudios en formato tabla. */
import {formatStudyDate, hasStudyAttachment, reportUrl, studyAttachmentLabel} from '@domain/library';
import {isSourceUnavailable} from '../state/store';
import type {Study} from '@domain/models';

interface StudyListProps {
    onEdit: (study: Study) => void;
    onDelete: (study: Study) => void;
    onShare?: (study: Study) => void;
    studies: Study[];
}

export function StudyList({onEdit, onDelete, onShare, studies}: StudyListProps) {
    return (
        <div className="summary-table-scroll library-table">
            <table role="table">
                <caption className="sr-only">Estudios guardados en el archivo</caption>
                <thead role="rowgroup">
                    <tr role="row">
                        <th scope="col" role="columnheader">Estudio</th>
                        <th scope="col" role="columnheader">Fecha</th>
                        <th scope="col" role="columnheader">Profesional</th>
                        <th scope="col" role="columnheader">Institución</th>
                        <th scope="col" role="columnheader"><span className="sr-only">Acciones</span></th>
                    </tr>
                </thead>
                <tbody role="rowgroup">
                    {studies.length === 0 ? (
                        <tr role="row">
                            <td colSpan={5} role="cell">
                                <div className="table-empty">
                                    <p>No hay estudios para mostrar</p>
                                </div>
                            </td>
                        </tr>
                    ) : studies.map((study) => {
                        const hasAttachment = hasStudyAttachment(study);
                        const attachmentAvailable = hasAttachment && !isSourceUnavailable(study.driveFileId);
                        const viewerAvailable = Boolean(study.viewer) && !isSourceUnavailable(study.viewer);
                        const attachmentLabel = studyAttachmentLabel(study);
                        const pending = Boolean(study.syncStatus);
                        const canShare = hasAttachment || study.viewer || study.documentIds?.length;

                        return (
                            <tr key={study.id} role="row">
                                <td role="cell">
                                    <div className="study-cell">
                                        <span className="study-text">
                                            <span className="study-title">{study.title}</span>
                                        </span>
                                    </div>
                                </td>
                                <td role="cell">
                                    <time className="date-cell" dateTime={study.date}>{formatStudyDate(study.date)}</time>
                                </td>
                                <td role="cell" className="person-cell library-study-metadata" data-empty={!study.doctor}>
                                    <span className="library-mobile-label" aria-hidden="true">Profesional </span>
                                    {study.doctor || '—'}
                                </td>
                                <td role="cell" className="portal-cell library-study-metadata" data-empty={!study.portal}>
                                    <span className="library-mobile-label" aria-hidden="true">Institución </span>
                                    {study.portal || '—'}
                                </td>
                                <td role="cell">
                                    <div className="row-actions">
                                        {attachmentAvailable && (
                                            <a className="icon-button" href={reportUrl(study.driveFileId)}
                                               target="_blank" rel="noopener noreferrer"
                                               title={attachmentLabel} aria-label={`${attachmentLabel} de ${study.title}`}>
                                                <svg className="icon" aria-hidden="true">
                                                    <use href={study.attachmentMime ? '#i-scan' : '#i-file'}/>
                                                </svg>
                                            </a>
                                        )}
                                        {viewerAvailable && (
                                            <a className="icon-button" href={study.viewer} target="_blank" rel="noopener noreferrer"
                                               title="Abrir visor" aria-label={`Abrir visor de ${study.title}`}>
                                                <svg className="icon" aria-hidden="true"><use href="#i-eye"/></svg>
                                            </a>
                                        )}
                                        <button className="icon-button" type="button" disabled={pending}
                                                aria-label={`Editar ${study.title}`} onClick={() => onEdit(study)}>
                                            <svg className="icon" aria-hidden="true"><use href="#i-edit"/></svg>
                                        </button>
                                        <button className="icon-button" type="button" disabled={pending}
                                                aria-label={`Eliminar ${study.title}`} onClick={() => onDelete(study)}>
                                            <svg className="icon" aria-hidden="true"><use href="#i-trash"/></svg>
                                        </button>
                                        <button className="icon-button" type="button" disabled={pending || !canShare}
                                                aria-label={`Compartir ${study.title}`} onClick={() => onShare?.(study)}>
                                            <svg className="icon" aria-hidden="true"><use href="#i-share"/></svg>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
