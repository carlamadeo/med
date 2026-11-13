import { filteredStudies, visibleStudies, loading, error, hasFilters, invalidRange, view } from '../state/store';
import { FilterBar } from './FilterBar';
import { StudyList } from './StudyList';
import { EmptyState } from './EmptyState';
import { Operations } from './Operations';
import { MedicalEvents } from './MedicalEvents';
import { Portals } from './Portals';
import { LibraryTabs } from './LibraryTabs';
import type { Study } from '@domain/models';

interface StudyListContainerProps {
  onEdit: (study: Study) => void;
  onDelete: (study: Study) => void;
  onShare?: (study: Study) => void;
  onClearFilters: () => void;
  onSearch: (query: string) => void;
  onRetryLoad: () => void;
  onAddStudy: () => void;
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
  onClearFilters,
  onSearch,
  onRetryLoad,
  onAddStudy,
  typesReady,
  availableTypes,
  offline,
  directoryWarning,
  pendingChangesCount
}: StudyListContainerProps) {
  const studiesList = visibleStudies.value;
  const filtered = filteredStudies.value;
  const isLoading = loading.value;
  const loadError = error.value;
  const filtersActive = hasFilters.value;
  const rangeInvalid = invalidRange.value;

  return (
    <>
      {offline && <p className="offline-notice" role="status">Sin conexión: estás viendo la última copia disponible en este dispositivo.</p>}
      {(pendingChangesCount > 0) && (
        <div id="pending-changes-placeholder" />)}
      {directoryWarning && (
        <p id="directory-warning" role="status">No se pudieron actualizar las operaciones y portales. Se volverá a intentar al recuperar la conexión.</p>
      )}
      <LibraryTabs availableTypes={availableTypes} />
      {view.value === 'operaciones' && <Operations />}
      {view.value === 'eventos' && <MedicalEvents />}
      {view.value === 'portales' && <Portals />}
      {view.value !== 'operaciones' && view.value !== 'portales' && view.value !== 'eventos' && (
        <>
          <div className="section-head">
            <div className="section-title">
              <h2 id="library-title">Estudios guardados</h2>
              <span id="count" className="count">{studiesList.length}</span>
            </div>
            <FilterBar
              availableTypes={availableTypes}
              onClear={onClearFilters}
              onSearch={onSearch}
            />
          </div>

          {isLoading ? (
            <>
              <p id="list-status" className="list-status" role="status">Cargando tus estudios…</p>
              <ul className="results skeleton-list" aria-hidden="true">
                {[0, 1, 2].map((item) => (
                  <li className="record skeleton-card" key={item}>
                    <div className="record-main">
                      <div className="skeleton skeleton-icon" />
                      <div className="record-text">
                        <div className="skeleton skeleton-title" />
                        <div className="skeleton skeleton-subtitle" />
                      </div>
                      <div className="skeleton skeleton-badge" />
                    </div>
                    <div className="record-controls">
                      <div className="skeleton skeleton-link" />
                      <div className="skeleton skeleton-action" />
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
          ) : studiesList.length > 0 && filtersActive && filtered.length === 0 ? (
            <EmptyState
              variant="no-results"
              title={rangeInvalid ? 'La fecha «Hasta» debe ser igual o posterior a «Desde».' : 'No hay estudios con esos filtros'}
              description="Probá con otras fechas, otro tipo de estudio o una búsqueda distinta."
              action={<button id="empty-action" className="button secondary" type="button" onClick={onClearFilters}>Limpiar filtros</button>}
            />
          ) : studiesList.length === 0 ? (
            <EmptyState
              variant="no-studies"
              title={pendingChangesCount > 0 ? 'Tu estudio está pendiente' : 'Tu archivo empieza acá'}
              description={pendingChangesCount > 0
                ? 'Aparecerá en la biblioteca cuando se sincronice con Drive.'
                : 'Agregá tu primer estudio con su informe en PDF, el enlace al visor o ambos.'}
              action={
                <button
                  className="button secondary"
                  id="empty-action"
                  disabled={!typesReady}
                  type="button"
                  onClick={onAddStudy}
                >
                  <svg className="icon"><use href="#i-plus" /></svg> Agregar estudio
                </button>
              }
            />
          ) : (
            <>
              {filtersActive && (
                <p id="list-status" role="status">
                  {filtered.length} {filtered.length === 1 ? 'estudio encontrado' : 'estudios encontrados'}
                </p>
              )}
              <StudyList onEdit={onEdit} onDelete={onDelete} onShare={onShare ?? (() => {})} />
            </>
          )}
        </>
      )}
    </>
  );
}