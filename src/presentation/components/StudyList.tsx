/** Lista de estudios en formato tabla. */
import {useRef, useState} from 'preact/hooks';
import {StudyPrintDialog} from './StudyPrintDialog';
import {formatStudyDate, hasStudyAttachment, reportUrl, studyAttachmentLabel, type StudySortOrder} from '@domain/library';
import {isSourceUnavailable, studies as allStudies} from '../state/store';
import type {Study} from '@domain/models';

type SortColumn = 'title' | 'date' | 'doctor' | 'portal';
const PAGE_SIZE = 50;

const COLUMN_ORDERS: Record<SortColumn, { asc: StudySortOrder; desc: StudySortOrder; defaultOrder: StudySortOrder }> = {
    title: {asc: 'title', desc: 'title-desc', defaultOrder: 'title'},
    date: {asc: 'date-asc', desc: 'date-desc', defaultOrder: 'date-desc'},
    doctor: {asc: 'doctor', desc: 'doctor-desc', defaultOrder: 'doctor'},
    portal: {asc: 'portal', desc: 'portal-desc', defaultOrder: 'portal'},
};

function isShareableStudy(study: Study): boolean {
    return !study.syncStatus && Boolean(
        hasStudyAttachment(study) || study.viewer || study.documentIds?.length,
    );
}

interface StudyListProps {
    onEdit: (study: Study) => void;
    onDelete: (study: Study) => void;
    onShare?: (study: Study) => void;
    onShareMultiple?: (studies: Study[]) => void;
    sortOrder?: StudySortOrder;
    onSortChange?: (order: StudySortOrder) => void;
    studies: Study[];
}

export function StudyList({
                               onEdit,
                               onDelete,
                               onShare = () => {
    },
                               onShareMultiple,
                               sortOrder = 'date-desc',
                               onSortChange,
                               studies: studiesList
                           }: StudyListProps) {
    const [printing, setPrinting] = useState<Study | null>(null);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [pagination, setPagination] = useState({studies: studiesList, page: 0});
    const table = useRef<HTMLTableElement>(null);
    const page = pagination.studies === studiesList ? pagination.page : 0;
    const start = page * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, studiesList.length);
    const pageStudies = studiesList.slice(start, end);

    const shareableStudiesInList = studiesList.filter(isShareableStudy);
    const availableById = new Map<string, Study>();
    for (const study of allStudies.value) {
        if (isShareableStudy(study)) availableById.set(study.id, study);
    }
    for (const study of shareableStudiesInList) {
        availableById.set(study.id, study);
    }
    const activeSelectedStudies = selectedIds
        .map((id) => availableById.get(id))
        .filter((study): study is Study => study !== undefined);
    const activeSelectedIds = new Set(activeSelectedStudies.map((study) => study.id));
    const hasUnselectedShareable = shareableStudiesInList.some((study) => !activeSelectedIds.has(study.id));

    const toggleSelect = (studyId: string, checked: boolean) => {
        setSelectedIds((prev) =>
            checked
                ? (prev.includes(studyId) ? prev : [...prev, studyId])
                : prev.filter((id) => id !== studyId),
        );
    };

    const selectAllShareable = () => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            for (const study of shareableStudiesInList) {
                next.add(study.id);
            }
            return [...next];
        });
    };

    const changePage = (next: number) => {
        if (next < 0 || next * PAGE_SIZE >= studiesList.length) return;
        setPagination({studies: studiesList, page: next});
        table.current?.focus();
    };

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
        {activeSelectedStudies.length > 0 && (
            <div className="library-selection-bar">
                <span role="status" className="library-selection-count">
                    {activeSelectedStudies.length}{' '}
                    {activeSelectedStudies.length === 1 ? 'estudio seleccionado' : 'estudios seleccionados'}
                </span>
                <div className="library-selection-actions">
                    {hasUnselectedShareable && (
                        <button type="button" className="button secondary button-sm" onClick={selectAllShareable}>
                            Seleccionar todos
                        </button>
                    )}
                    <button type="button" className="button quiet button-sm" onClick={() => setSelectedIds([])}>
                        Limpiar selección
                    </button>
                    <button
                        type="button"
                        id="share-selected-studies"
                        className="button primary button-sm"
                        onClick={() => {
                            if (onShareMultiple) {
                                onShareMultiple(activeSelectedStudies);
                            } else if (activeSelectedStudies.length === 1) {
                                onShare(activeSelectedStudies[0]!);
                            }
                        }}
                    >
                        Compartir seleccionados
                    </button>
                </div>
            </div>
        )}
        <div className="summary-table-scroll library-table">
            <table ref={table} role="table" tabIndex={-1}>
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
                    ) : pageStudies.flatMap((study, index) => {
                        const hasAttachment = hasStudyAttachment(study);
                        const attachmentAvailable = hasAttachment && !isSourceUnavailable(study.driveFileId);
                        const viewerAvailable = Boolean(study.viewer) && !isSourceUnavailable(study.viewer);
                        const attachmentLabel = studyAttachmentLabel(study);
                        const pending = Boolean(study.syncStatus);
                        const canShare = hasAttachment || study.viewer || study.documentIds?.length;
                        const isDateSorted = sortOrder === 'date-desc' || sortOrder === 'date-asc';
                        const year = /^\d{4}/.test(study.date) ? study.date.slice(0, 4) : '';
                        const prevStudy = index > 0 ? studiesList[index - 1] : undefined;
                        const prevYear = prevStudy && /^\d{4}/.test(prevStudy.date) ? prevStudy.date.slice(0, 4) : '';
                        const showYearDivider = isDateSorted && year !== '' && year !== prevYear;

                        const rows = [];
                        if (showYearDivider) {
                            rows.push(
                                <tr key={`year-${year}`} className="year-divider-row" role="row">
                                    <td colSpan={5} role="cell">
                                        <span className="year-divider-label">{year}</span>
                                    </td>
                                </tr>
                            );
                        }

                        rows.push(
                            <tr key={study.id} role="row">
                                <td role="cell">
                                    <div className="study-cell">
                                        <input
                                            type="checkbox"
                                            className="study-select-checkbox"
                                            checked={activeSelectedIds.has(study.id)}
                                            disabled={pending || !canShare}
                                            aria-label={`Seleccionar ${study.title} para compartir`}
                                            onChange={(event) => toggleSelect(study.id, event.currentTarget.checked)}
                                        />
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
                                            {study.specialty && <span className="study-specialty">{study.specialty}</span>}
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
                                            <a className="icon-button library-source" href={reportUrl(study.driveFileId)}
                                               target="_blank" rel="noopener noreferrer"
                                               title={attachmentLabel} aria-label={`${attachmentLabel} de ${study.title}`}>
                                                <svg className="icon" aria-hidden="true">
                                                    <use href={study.attachmentMime ? '#i-scan' : '#i-file'}/>
                                                </svg>
                                                <span className="library-source-label">{attachmentLabel}</span>
                                            </a>
                                        )}
                                        {viewerAvailable && (
                                            <a className="icon-button library-source" href={study.viewer} target="_blank" rel="noopener noreferrer"
                                               title="Abrir visor" aria-label={`Abrir visor de ${study.title}`}>
                                                <svg className="icon" aria-hidden="true"><use href="#i-eye"/></svg>
                                                <span className="library-source-label">Abrir visor</span>
                                            </a>
                                        )}
                                        <button className="icon-button desktop-study-action" type="button" title="Editar" disabled={pending}
                                                aria-label={`Editar ${study.title}`} onClick={() => onEdit(study)}>
                                            <svg className="icon" aria-hidden="true"><use href="#i-edit"/></svg>
                                        </button>
                                        <button className="icon-button desktop-study-action" type="button" title="Imprimir" aria-label={`Imprimir ${study.title}`}
                                                onClick={() => setPrinting(study)}>
                                            <svg className="icon" aria-hidden="true"><use href="#i-print"/></svg>
                                        </button>
                                        <button className="icon-button desktop-study-action" type="button" title="Compartir" disabled={pending || !canShare}
                                                aria-label={`Compartir ${study.title}`} onClick={() => onShare?.(study)}>
                                            <svg className="icon" aria-hidden="true"><use href="#i-share"/></svg>
                                        </button>
                                        <button className="icon-button row-action-danger desktop-study-action" type="button" title="Eliminar" disabled={pending}
                                                aria-label={`Eliminar ${study.title}`} onClick={() => onDelete(study)}>
                                            <svg className="icon" aria-hidden="true"><use href="#i-trash"/></svg>
                                        </button>
                                        <details className="mobile-study-actions" onKeyDown={event => {
                                            if (event.key === 'Escape' && event.currentTarget.open) {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                event.currentTarget.open = false;
                                                event.currentTarget.querySelector('summary')?.focus();
                                            }
                                        }}>
                                            <summary aria-label={`Más acciones para ${study.title}`}>Más acciones</summary>
                                            <div className="mobile-study-menu">
                                                <button type="button" aria-label={`Editar ${study.title}`} disabled={pending} onClick={() => onEdit(study)}>Editar</button>
                                                <button type="button" aria-label={`Imprimir ${study.title}`} onClick={() => setPrinting(study)}>Imprimir</button>
                                                <button type="button" aria-label={`Compartir ${study.title}`} disabled={pending || !canShare} onClick={() => onShare(study)}>Compartir</button>
                                                <button type="button" aria-label={`Eliminar ${study.title}`} disabled={pending} onClick={() => onDelete(study)}>Eliminar</button>
                                            </div>
                                        </details>
                                    </div>
                                </td>
                            </tr>
                        );
                        return rows;
                    })}
                </tbody>
            </table>
        </div>
        {studiesList.length > PAGE_SIZE && (
            <nav className="library-pagination" aria-label="Páginas de estudios">
                <button type="button" className="button secondary" aria-disabled={page === 0}
                        onClick={() => changePage(page - 1)}>Anterior</button>
                <span role="status">{start + 1}–{end} de {studiesList.length} estudios</span>
                <button type="button" className="button secondary" aria-disabled={end === studiesList.length}
                        onClick={() => changePage(page + 1)}>Siguiente</button>
            </nav>
        )}
        {printing && <StudyPrintDialog key={printing.id} study={printing} onClose={() => setPrinting(null)}/>}
        </>
    );
}
