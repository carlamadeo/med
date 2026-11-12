/**
 * Barra de filtros: búsqueda, tipo, rango de fechas, operación, portal, solo PDF/visor y limpiar.
 */
import { filters, operations, portals, sortOrder, categoryTypes } from '../state/store';
import type { Operation, Portal, Filters } from '@domain/models';

interface FilterBarProps {
  onClear: () => void;
  onSearch: (query: string) => void;
  availableTypes: string[];
}

export function FilterBar({ onClear, onSearch, availableTypes }: FilterBarProps) {
  const hasActiveFilters =
    categoryTypes.value.length || filters.value.query ||
    filters.value.type ||
    filters.value.from ||
    filters.value.to ||
    filters.value.operationId ||
    filters.value.portal ||
    filters.value.onlyPdf ||
    filters.value.onlyViewer;

  const handleChange = (partial: Partial<Filters>) => {
    if (partial.type !== undefined) categoryTypes.value = [];
    filters.value = { ...filters.value, ...partial };
    if (partial.query !== undefined) {
      onSearch(partial.query);
    }
  };

  return (
    <form id="filters" className="filters" autocomplete="off" onSubmit={(e) => e.preventDefault()}>
      <span className="filter-caption">
        <svg className="icon"><use href="#i-filter" /></svg> Filtros
      </span>

      <label htmlFor="search">
        <span className="sr-only">Buscar</span>
        <input
          id="search"
          type="search"
          placeholder="Buscar por título o médico"
          value={filters.value.query}
          onInput={(e) => handleChange({ query: (e.target as HTMLInputElement).value })}
          aria-label="Buscar estudios"
        />
      </label>

      <label htmlFor="type">
        Tipo
        <select
          id="type"
          value={filters.value.type}
          onChange={(e) => handleChange({ type: (e.target as HTMLSelectElement).value })}
        >
          <option value="">Todos los tipos</option>
          {availableTypes.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
      </label>

      <label htmlFor="sort">Ordenar
        <select id="sort" value={sortOrder.value} onChange={(event) => { sortOrder.value = (event.currentTarget as HTMLSelectElement).value as typeof sortOrder.value; }}>
          <option value="date-desc">Más recientes</option>
          <option value="date-asc">Más antiguos</option>
          <option value="title">Nombre A–Z</option>
          <option value="type">Tipo</option>
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

      <label htmlFor="from">
        Desde
        <input
          id="from"
          type="date"
          value={filters.value.from}
          onInput={(e) => handleChange({ from: (e.target as HTMLInputElement).value })}
          aria-label="Fecha desde"
        />
      </label>

      <label htmlFor="to">
        Hasta
        <input
          id="to"
          type="date"
          value={filters.value.to}
          onInput={(e) => handleChange({ to: (e.target as HTMLInputElement).value })}
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
        id="clear"
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
