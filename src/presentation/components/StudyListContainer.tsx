import {useRef} from 'preact/hooks';
import {filteredStudies, loading, error, view, categoryTypes, libraryQuery, libraryPortal, libraryOperation, sortOrder, resetLibraryFilters} from '../state/store';
import {StudyList} from './StudyList';
import {EmptyState} from './EmptyState';
import {Operations} from './Operations';
import {MedicalEvents} from './MedicalEvents';
import {Portals} from './Portals';
import {IntakeCandidates} from './IntakeCandidates';
import {Episodes} from './Episodes';
import {Appointments} from './Appointments';
import {LibraryTabs} from './LibraryTabs';
import type {Study, StudyDraft} from '@domain/models';

interface StudyListContainerProps {
    onEdit: (study: Study) => void;
    onDelete: (study: Study) => void;
    onShare?: (study: Study) => void;
    onShareMultiple?: (studies: Study[]) => void;
    onRetryLoad: () => void;
    onAddStudy: () => void;
    onOpenCandidate: (draft: Partial<StudyDraft> & { _candidateId: string; _candidateName: string }) => void;
    typesReady: boolean;
    availableTypes: string[];
    offline: boolean;
    directoryWarning: boolean;
    pendingChangesCount: number;
}

export function StudyListContainer({
                                         onEdit,
                                         onDelete,
                                         onShare,
                                         onShareMultiple,
                                         onRetryLoad,
                                         onAddStudy,
                                         onOpenCandidate,
                                         typesReady,
                                         availableTypes,
                                         offline,
                                         directoryWarning,
                                         pendingChangesCount
                                     }: StudyListContainerProps) {
    const searchInput = useRef<HTMLInputElement>(null);
    const studiesList = filteredStudies.value;
    const hasFilters = Boolean(libraryQuery.value || libraryPortal.value || libraryOperation.value || categoryTypes.value.length || sortOrder.value !== 'date-desc');
    const isLoading = loading.value;
    const loadError = error.value;

    return (
        <>
            {offline &&
                <p className="offline-notice" role="status">Sin conexión: estás viendo la última copia disponible en este dispositivo.</p>}
            {(pendingChangesCount > 0) && (
                <div id="pending-changes-placeholder"/>)}
            {directoryWarning && (
                <p id="directory-warning" role="status">No se pudieron actualizar las operaciones y portales. Se volvera a intentar al recuperar la conexion.</p>
            )}
            {view.value === 'operaciones' && <Operations/>}
            {view.value === 'eventos' && <MedicalEvents/>}
            {view.value === 'episodios' && <Episodes/>}
            {view.value === 'turnos' && <Appointments/>}
            {view.value === 'portales' && <Portals onViewStudies={portal => {
                resetLibraryFilters();
                libraryPortal.value = portal;
                view.value = 'cronologia';
            }}/>}
            {view.value === 'intake' && (
                <IntakeCandidates onOpenEditor={onOpenCandidate}/>
            )}
            {view.value !== 'operaciones' && view.value !== 'portales' && view.value !== 'eventos' && view.value !== 'episodios' && view.value !== 'turnos' && view.value !== 'intake' && (
                <>
                    <div className="section-head library-search-head">
                        <div className="library-head-main">
                            <div className="section-title">
                                <h2 id="library-title">Estudios guardados</h2>
                                <span id="count" className="count" aria-live="polite" aria-atomic="true">
                                    {studiesList.length}<span className="sr-only"> estudios</span>
                                </span>
                            </div>
                            <LibraryTabs availableTypes={availableTypes}/>
                        </div>
                        <div className="search library-search">
                            <svg className="icon" aria-hidden="true"><use href="#i-search"/></svg>
                            <input
                                ref={searchInput}
                                type="search"
                                aria-label="Buscar estudios"
                                placeholder="Nombre, profesional o institución"
                                value={libraryQuery.value}
                                onInput={(event) => libraryQuery.value = event.currentTarget.value}
                            />
                        </div>
                    </div>
                    {libraryPortal.value && <p className="active-filter-pill">Institución: {libraryPortal.value} <button type="button" className="button quiet button-sm" onClick={() => libraryPortal.value = ''}>Quitar filtro</button></p>}
                    {libraryOperation.value && <p className="active-filter-pill">Operación: {libraryOperation.value.name} <button type="button" className="button quiet button-sm" onClick={() => libraryOperation.value = null}>Quitar filtro</button></p>}
                    {categoryTypes.value.length === 1 && !isLoading && !loadError && (
                        <p className="related-heading">Estudios de {categoryTypes.value[0]} · {studiesList.length} {studiesList.length === 1 ? 'estudio' : 'estudios'}, ordenados por fecha</p>
                    )}

                    {isLoading ? (
                        <>
                            <p id="list-status" className="list-status" role="status">Cargando tus estudios…</p>
                            <ul className="results skeleton-list" aria-hidden="true">
                                {[0, 1, 2].map((item) => (
                                    <li className="record skeleton-card" key={item}>
                                        <div className="record-main">
                                            <div className="skeleton skeleton-icon"/>
                                            <div className="record-text">
                                                <div className="skeleton skeleton-title"/>
                                                <div className="skeleton skeleton-subtitle"/>
                                            </div>
                                            <div className="skeleton skeleton-badge"/>
                                        </div>
                                        <div className="record-controls">
                                            <div className="skeleton skeleton-link"/>
                                            <div className="skeleton skeleton-action"/>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </>
                    ) : loadError ? (
                        <div id="load-error" className="empty">
                            <h3>No se pudo abrir el archivo</h3>
                            <p id="load-error-message">{loadError}</p>
                            <button
                                className="button secondary"
                                id="retry"
                                type="button"
                                onClick={onRetryLoad}
                            >
                                Reintentar
                            </button>
                        </div>
                    ) : studiesList.length === 0 && hasFilters ? (
                        <EmptyState
                            variant="no-results"
                            title="No hay resultados"
                            description="Probá con otro término o cambiá los tipos seleccionados."
                            action={
                                <button
                                    className="button secondary"
                                    type="button"
                                    onClick={() => {
                                        resetLibraryFilters();
                                        searchInput.current?.focus();
                                    }}
                                >
                                    Limpiar filtros
                                </button>
                            }
                        />
                    ) : studiesList.length === 0 ? (
                        <EmptyState
                            variant="no-studies"
                            title={pendingChangesCount > 0 ? 'Tu estudio está pendiente' : 'Tu archivo empieza acá'}
                            description={pendingChangesCount > 0
                                ? 'Aparecerá en la biblioteca cuando se sincronice con Drive.'
                                : 'Agregá tu primer estudio con un PDF, una imagen o el enlace al visor.'}
                            action={
                                <button
                                    className="button secondary"
                                    id="empty-action"
                                    disabled={!typesReady}
                                    type="button"
                                    onClick={onAddStudy}
                                >
                                    <svg className="icon">
                                        <use href="#i-plus"/>
                                    </svg>
                                    Agregar estudio
                                </button>
                            }
                        />
                    ) : (
                        <StudyList
                            onEdit={onEdit}
                            onDelete={onDelete}
                            onShare={onShare ?? (() => {})}
                            onShareMultiple={onShareMultiple}
                            sortOrder={sortOrder.value}
                            onSortChange={order => sortOrder.value = order}
                            studies={studiesList}
                        />
                    )}
                </>
            )}
        </>
    );
}
