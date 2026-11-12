/**
 * Barra de filtros: búsqueda, tipo, rango de fechas, operación, portal, solo PDF/visor y limpiar.
 */
import { filters, operations, portals } from '../state/store';
import type { Operation, Portal, Filters } from '@domain/models';

interface FilterBarProps {
  onClear: () => void;
  onSearch: (query: string) => void;
}

export function FilterBar({ onClear, onSearch }: FilterBarProps) {
  const hasActiveFilters =
    filters.value.query ||
    filters.value.type ||
    filters.value.from ||
    filters.value.to ||
    filters.value.operationId ||
    filters.value.portal ||
    filters.value.onlyPdf ||
    filters.value.onlyViewer;

  const handleChange = (partial: Partial<Filters>) => {
    filters.value = { ...filters.value, ...partial };
    if (partial.query !== undefined) {
      onSearch(partial.query);
    }
  };

  return (
    <form className="filters" autocomplete="off" onSubmit={(e) => e.preventDefault()}>
      <span className="filter-caption">
        <svg className="icon"><use href="#i-filter" /></svg> Filtros
      </span>

      <label htmlFor="filter-search">
        <span className="sr-only">Buscar</span>
        <input
          id="filter-search"
          type="search"
          placeholder="Buscar por título o médico"
          value={filters.value.query}
          onInput={(e) => handleChange({ query: (e.target as HTMLInputElement).value })}
          aria-label="Buscar estudios"
        />
      </label>

      <label htmlFor="filter-type">
        Tipo
        <select
          id="filter-type"
          value={filters.value.type}
          onChange={(e) => handleChange({ type: (e.target as HTMLSelectElement).value })}
        >
          <option value="">Todos los tipos</option>
        </select>
      </label>

      <label htmlFor="filter-operation">
        Operación
        <select
          id="filter-operation"
          value={filters.value.operationId}
          onChange={(e) => handleChange({ operationId: (e.target as HTMLSelectElement).value })}
        >
          <option value="">Todas las operaciones</option>
          {operations.value.map((op: Operation) => (
            <option key={op.id} value={op.id}>
              {op.name}
            </option>
          ))}
        </select>
      </label>

      <label htmlFor="filter-portal">
        Portal
        <select
          id="filter-portal"
          value={filters.value.portal}
          onChange={(e) => handleChange({ portal: (e.target as HTMLSelectElement).value })}
        >
          <option value="">Todos los portales</option>
          {portals.value.map((p: Portal) => (
            <option key={p.name} value={p.name}>
              {p.displayName}
            </option>
          ))}
        </select>
      </label>

      <label htmlFor="filter-from">
        Desde
        <input
          id="filter-from"
          type="date"
          value={filters.value.from}
          onChange={(e) => handleChange({ from: (e.target as HTMLInputElement).value })}
          aria-label="Fecha desde"
        />
      </label>

      <label htmlFor="filter-to">
        Hasta
        <input
          id="filter-to"
          type="date"
          value={filters.value.to}
          onChange={(e) => handleChange({ to: (e.target as HTMLInputElement).value })}
          aria-label="Fecha hasta"
        />
      </label>

      <label className="checkbox-filter">
        <input
          type="checkbox"
          checked={filters.value.onlyPdf}
          onChange={(e) => handleChange({ onlyPdf: (e.target as HTMLInputElement).checked })}
          id="filter-only-pdf"
        />
        <span>Solo con PDF</span>
      </label>

      <label className="checkbox-filter">
        <input
          type="checkbox"
          checked={filters.value.onlyViewer}
          onChange={(e) => handleChange({ onlyViewer: (e.target as HTMLInputElement).checked })}
          id="filter-only-viewer"
        />
        <span>Solo con visor</span>
      </label>

      <button
        type="button"
        className="text-button"
        disabled={!hasActiveFilters}
        onClick={() => {
          filters.value = {
            query: '',
            type: '',
            from: '',
            to: '',
            operationId: '',
            portal: '',
            onlyPdf: false,
            onlyViewer: false,
          };
          onClear();
        }}
      >
        Limpiar filtros
      </button>
    </form>
  );
}
