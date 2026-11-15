/** Lista de estudios en formato tabla. */
import {useState} from 'preact/hooks';
import {StudyPrintDialog} from './StudyPrintDialog';
import {formatStudyDate, reportUrl, studyAttachmentLabel, type StudySortOrder} from '@domain/library';
import {isSourceUnavailable} from '../state/store';
import type {Study} from '@domain/models';

type SortColumn = 'title' | 'date' | 'doctor' | 'portal';

const COLUMN_ORDERS: Record<SortColumn, { asc: StudySortOrder; desc: StudySortOrder; defaultOrder: StudySortOrder }> = {
    title: {asc: 'title', desc: 'title-desc', defaultOrder: 'title'},
    date: {asc: 'date-asc', desc: 'date-desc', defaultOrder: 'date-desc'},
    doctor: {asc: 'doctor', desc: 'doctor-desc', defaultOrder: 'doctor'},
    portal: {asc: 'portal', desc: 'portal-desc', defaultOrder: 'portal'},
};

interface StudyListProps {
    onEdit: (study: Study) => void;
    onDelete: (study: Study) => void;
    onShare?: (study: Study) => void;
    sortOrder?: StudySortOrder;
    onSortChange?: (order: StudySortOrder) => void;
    studies: Study[];
}

export function StudyList({
                               onEdit,
                               onDelete,
                               onShare = () => {
    },
                               sortOrder = 'date-desc',
                               onSortChange,
                               studies: studiesList
                           }: StudyListProps) {
    const [printing, setPrinting] = useState<Study | null>(null);

    const renderSortHeader = (column: SortColumn, label: string) => {
        const orders = COLUMN_ORDERS[column];
        const isAsc = sortOrder === orders.asc;
        const isDesc = sortOrder === orders.desc;
        const active = isAsc || isDesc;
        const ariaSort = isAsc ? 'ascending' : isDesc ? 'descending' : 'none';
        const toggleSort = () => {
            if (!onSortChange) return;
            if (isAsc) onSortChange(orders.desc);
            else if (isDesc) onSortChange(orders.asc);
            else onSortChange(orders.defaultOrder);
        };

        return (
            <th scope="col" role="columnheader" aria-sort={onSortChange ? ariaSort : undefined}>
                {onSortChange ? (
                    <button
                        type="button"
                        className={`table-sort-button ${active ? 'is-active' : ''} ${isAsc ? 'is-asc' : ''}`}
                        onClick={toggleSort}
                    >
                        <span>{label}</span>
                        <svg className="icon table-sort-icon" aria-hidden="true">
                            <use href="#i-chevron-down"/>
                        </svg>
                    </button>
                ) : label}
            </th>
        );
    };

    return (
        <>
        <div className="summary-table-scroll library-table">
            <table role="table">
                <caption className="sr-only">Estudios guardados en el archivo</caption>
                <thead role="rowgroup">
                    <tr role="row">
                        {renderSortHeader('title', 'Estudio')}
                        {renderSortHeader('date', 'Fecha')}
                        {renderSortHeader('doctor', 'Profesional')}
                        {renderSortHeader('portal', 'Institución')}
                        <th scope="col" role="columnheader"><span className="sr-only">Acciones</span></th>
                    </tr>
                </thead>
                <tbody role="rowgroup">
                    {studiesList.length === 0 ? (
                        <tr role="row">
                            <td colSpan={5} role="cell">
                                <div className="table-empty">
                                    <p>No hay estudios para mostrar</p>
                                </div>
                            </td>
                        </tr>
                    ) : studiesList.map((study) => {
                        const hasAttachment = study.hasPdf || Boolean(study.attachmentMime);
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
                                            {study.syncStatus && <span className="record-status" data-tone={study.syncStatus === 'conflict' || study.syncStatus === 'failed' ? 'danger' : 'warning'}>{study.syncStatus === 'conflict' ? 'Requiere revisión' : study.syncStatus === 'failed' ? 'No se puede sincronizar' : 'Pendiente de sincronización'}</span>}
                                            <span className="study-types">
                                                {study.types.length ? (
                                                    <>
                                                        {study.types.slice(0, 2).map((type) => (
                                                            <span className="type-badge" key={type}>{type}</span>
                                                        ))}
                                                        {study.types.length > 2 && (
                                                            <span
                                                                className="type-badge"
                                                                title={study.types.slice(2).join(', ')}
                                                            >
                                                                +{study.types.length - 2}
                                                            </span>
                                                        )}
                                                    </>
                                                ) : (
                                                    <span className="type-badge">Sin tipo</span>
                                                )}
                                            </span>
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
                                        <button className="icon-button" type="button" title="Editar" disabled={pending}
                                                aria-label={`Editar ${study.title}`} onClick={() => onEdit(study)}>
                                            <svg className="icon" aria-hidden="true"><use href="#i-edit"/></svg>
                                        </button>
                                        <button className="icon-button" type="button" title="Eliminar" disabled={pending}
                                                aria-label={`Eliminar ${study.title}`} onClick={() => onDelete(study)}>
                                            <svg className="icon" aria-hidden="true"><use href="#i-trash"/></svg>
                                        </button>
                                        <button className="icon-button" type="button" title="Imprimir" aria-label={`Imprimir ${study.title}`}
                                                onClick={() => setPrinting(study)}>
                                            <svg className="icon" aria-hidden="true"><use href="#i-print"/></svg>
                                        </button>
                                        <button className="icon-button" type="button" title="Compartir" disabled={pending || !canShare}
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
        <StudyPrintDialog study={printing} onClose={() => setPrinting(null)}/>
        </>
    );
}