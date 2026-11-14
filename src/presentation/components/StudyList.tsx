/** Lista de estudios en formato tabla. */
import {formatStudyDate, reportUrl} from '@domain/library';
import {isSourceUnavailable} from '../state/store';
import {studySyncState} from '@domain/summary';
import type {Study} from '@domain/models';

const syncMeta = {
    synced: {label: 'Sincronizado', tone: 'success', icon: 'i-check'},
    pending: {label: 'Pendiente', tone: 'warning', icon: 'i-clock'},
    conflict: {label: 'Conflicto', tone: 'danger', icon: 'i-alert'},
    failed: {label: 'Sin sincronizar', tone: 'danger', icon: 'i-alert'},
} as const;

interface StudyListProps {
    onEdit: (study: Study) => void;
    onDelete: (study: Study) => void;
    onShare?: (study: Study) => void;
    studies: Study[];
}

export function StudyList({
                               onEdit,
                               onDelete,
                               onShare = () => {
    },
                               studies: studiesList
                           }: StudyListProps) {
    return (
        <div className="summary-table-scroll">
            <table>
                <caption className="sr-only">Estudios guardados en el archivo</caption>
                <thead>
                <tr>
                    <th scope="col">Estudio</th>
                    <th scope="col">Fecha</th>
                    <th scope="col">Profesional</th>
                    <th scope="col">Portal</th>
                    <th scope="col">Estado</th>
                    <th scope="col"><span className="sr-only">Acciones</span></th>
                </tr>
                </thead>
                <tbody>
                {studiesList.length === 0 ? (
                    <tr>
                        <td colSpan={6}>
                            <div className="table-empty">
                                <p>No hay estudios para mostrar</p>
                            </div>
                        </td>
                    </tr>
                ) : studiesList.map((study) => {
                    const state = syncMeta[studySyncState(study)];
                    const pdfAvailable = study.hasPdf && !isSourceUnavailable(study.driveFileId);
                    const viewerAvailable = Boolean(study.viewer) && !isSourceUnavailable(study.viewer);
                    return (
                        <tr key={study.id}>
                            <td>
                                <div className="study-cell">
                                    <span className="study-icon"><svg className="icon"><use
                                        href="#i-file"/></svg></span>
                                    <span className="study-text">
                                <span className="study-title">{study.title}</span>
                                <span className="study-types">
                                {study.types.length ? study.types.slice(0, 2).map((type) => <span className="type-badge"
                                                                                                       key={type}>{type}</span>) :
                                        <span className="type-badge">Sin tipo</span>}
                            </span>
                            </span>
                                </div>
                            </td>
                            <td>
                                <time className="date-cell"
                                      dateTime={study.date}>{formatStudyDate(study.date)}</time>
                            </td>
                            <td className="person-cell">{study.doctor || '—'}</td>
                            <td className="portal-cell">{study.portal || '—'}</td>
                            <td>
                                <span className="status-pill" data-tone={state.tone}>
                                    <svg className="icon"><use href={`#${state.icon}`}/></svg>
                                    {state.label}
                                </span>
                            </td>
                            <td>
                                <div className="row-actions">
                                    {pdfAvailable && (
                                        <a className="icon-button" href={reportUrl(study.driveFileId)} target="_blank"
                                           rel="noopener noreferrer"
                                           aria-label={`Abrir PDF de ${study.title}`}>
                                            <svg className="icon">
                                                <use href="#i-external"/>
                                            </svg>
                                        </a>
                                    )}
                                    {viewerAvailable && (
                                        <a className="icon-button" href={study.viewer} target="_blank"
                                           rel="noopener noreferrer"
                                           aria-label={`Abrir visor de ${study.title}`}>
                                            <svg className="icon">
                                                <use href="#i-eye"/>
                                            </svg>
                                        </a>
                                    )}
                                    <button className="icon-button" type="button"
                                            disabled={Boolean(study.syncStatus)}
                                            aria-label={`Editar ${study.title}`} onClick={() => onEdit(study)}>
                                        <svg className="icon">
                                            <use href="#i-edit"/>
                                        </svg>
                                    </button>
                                    <button className="icon-button" type="button"
                                            disabled={Boolean(study.syncStatus)}
                                            aria-label={`Eliminar ${study.title}`} onClick={() => onDelete(study)}>
                                        <svg className="icon">
                                            <use href="#i-trash"/>
                                        </svg>
                                    </button>
                                    <button className="icon-button" type="button"
                                            disabled={Boolean(study.syncStatus) || !(study.hasPdf || study.viewer || study.documentIds?.length)}
                                            aria-label={`Compartir ${study.title}`}
                                            onClick={() => onShare(study)}>
                                        <svg className="icon">
                                            <use href="#i-share"/>
                                        </svg>
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