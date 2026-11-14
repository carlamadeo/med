/**
 * Barra de filtros: búsqueda, tipo, rango de fechas, operación, portal, solo PDF/visor y limpiar.
 */
import {useState} from 'preact/hooks';
import {driveAuth} from '@data';
import {filters, operations, portals, sortOrder, categoryTypes, hasFilters} from '../state/store';
import type {Operation, Portal, Filters} from '@domain/models';

interface FilterBarProps {
    onClear: () => void;
    onSearch: (query: string) => void;
    availableTypes: string[];
}

export function FilterBar({onClear, onSearch, availableTypes}: FilterBarProps) {
    const [historyOwner, setHistoryOwner] = useState<string | null>(null);
    const [recent, setRecent] = useState<string[]>([]);
    const [saved, setSaved] = useState<string[]>([]);
    const [historyError, setHistoryError] = useState('');
    const read = (store: Storage, key: string): string[] => {
        try {
            const value: unknown = JSON.parse(store.getItem(key) ?? '[]');
            return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 10) : [];
        } catch {
            return [];
        }
    };
    const keys = (owner: string) => ({recent: `mis-estudios:recent:${owner}`, saved: `mis-estudios:saved:${owner}`});
    const refreshHistory = () => {
        const owner = driveAuth.cachedAccountId();
        if (!owner) {
            setHistoryOwner(null);
            return;
        }
        const key = keys(owner);
        setHistoryOwner(owner);
        setRecent(read(sessionStorage, key.recent));
        setSaved(read(localStorage, key.saved));
    };
    const remember = (kind: 'recent' | 'saved') => {
        const owner = driveAuth.cachedAccountId();
        const query = filters.value.query.trim();
        if (!owner || !query) return;
        const key = keys(owner);
        const store = kind === 'recent' ? sessionStorage : localStorage;
        const list = [query, ...read(store, key[kind]).filter((item) => item !== query)].slice(0, 10);
        try {
            store.setItem(key[kind], JSON.stringify(list));
            setHistoryError('');
            refreshHistory();
        } catch {
            setHistoryError('No se pudo guardar la búsqueda en este dispositivo.');
        }
    };
    const removeSaved = (query: string) => {
        const owner = driveAuth.cachedAccountId();
        if (!owner) return;
        const key = keys(owner).saved;
        try {
            localStorage.setItem(key, JSON.stringify(read(localStorage, key).filter((item) => item !== query)));
            refreshHistory();
        } catch {
            setHistoryError('No se pudo quitar la búsqueda guardada.');
        }
    };
    const handleChange = (partial: Partial<Filters>) => {
        if (partial.type !== undefined) categoryTypes.value = [];
        filters.value = {...filters.value, ...partial};
        if (partial.query !== undefined) {
            onSearch(partial.query);
        }
    };

    return (
        <form id="filters" className="filters" autocomplete="off" onSubmit={(e) => {
            e.preventDefault();
            remember('recent');
        }}>
      <span className="filter-caption">
        <svg className="icon"><use href="#i-filter"/></svg> Filtros
      </span>

            <label htmlFor="search">
                <span className="sr-only">Buscar</span>
                <input
                    id="search"
                    type="search"
                    placeholder="Buscar por título o médico"
                    value={filters.value.query}
                    onInput={(e) => handleChange({query: (e.target as HTMLInputElement).value})}
                    onFocus={refreshHistory}
                    aria-label="Buscar estudios"
                />
            </label>

            <details className="search-history" onToggle={refreshHistory}>
                <summary>Búsquedas</summary>
                <p>Las búsquedas guardadas quedan en este navegador hasta que las quites.</p>
                <button type="button" id="save-search"
                        disabled={!filters.value.query.trim() || !driveAuth.cachedAccountId()}
                        onClick={() => remember('saved')}>Guardar búsqueda actual
                </button>
                {historyOwner && historyOwner === driveAuth.cachedAccountId() && <>
                    <div id="recent-searches"><strong>Recientes</strong>{recent.map((query) => <button key={query}
                                                                                                       type="button"
                                                                                                       onClick={() => handleChange({query})}>{query}</button>)}
                    </div>
                    <div id="saved-searches"><strong>Guardadas</strong>{saved.map((query) => <span key={query}><button
                        type="button" data-search onClick={() => handleChange({query})}>{query}</button><button
                        type="button" data-remove aria-label={`Quitar búsqueda ${query}`}
                        onClick={() => removeSaved(query)}>×</button></span>)}</div>
                </>}
                {historyError && <p role="alert">{historyError}</p>}
            </details>

            <label htmlFor="type">
                Tipo
                <select
                    id="type"
                    value={filters.value.type}
                    onChange={(e) => handleChange({type: (e.target as HTMLSelectElement).value})}
                >
                    <option value="">Todos los tipos</option>
                    {availableTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
            </label>

            <label htmlFor="sort">Ordenar
                <select id="sort" value={sortOrder.value} onChange={(event) => {
                    sortOrder.value = (event.currentTarget as HTMLSelectElement).value as typeof sortOrder.value;
                }}>
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
                    onChange={(e) => handleChange({operationId: (e.target as HTMLSelectElement).value})}
                >
                    <option value="">Todas</option>
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
                    onChange={(e) => handleChange({portal: (e.target as HTMLSelectElement).value})}
                >
                    <option value="">Todos</option>
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
                    onInput={(e) => handleChange({from: (e.target as HTMLInputElement).value})}
                    aria-label="Fecha desde"
                />
            </label>

            <label htmlFor="to">
                Hasta
                <input
                    id="to"
                    type="date"
                    value={filters.value.to}
                    onInput={(e) => handleChange({to: (e.target as HTMLInputElement).value})}
                    aria-label="Fecha hasta"
                />
            </label>

            <label className="checkbox-filter">
                <input
                    type="checkbox"
                    checked={filters.value.onlyPdf}
                    onChange={(e) => handleChange({onlyPdf: (e.target as HTMLInputElement).checked})}
                    id="filter-only-pdf"
                />
                <span>Solo con PDF</span>
            </label>

            <label className="checkbox-filter">
                <input
                    type="checkbox"
                    checked={filters.value.onlyViewer}
                    onChange={(e) => handleChange({onlyViewer: (e.target as HTMLInputElement).checked})}
                    id="filter-only-viewer"
                />
                <span>Solo con visor</span>
            </label>

            <button
                type="button"
                id="clear"
                className="text-button"
                disabled={!hasFilters.value}
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
