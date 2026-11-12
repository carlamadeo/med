import { view, categoryTypes, filters } from '../state/store';

interface LibraryTabsProps {
  availableTypes: string[];
}

export function LibraryTabs({ availableTypes }: LibraryTabsProps) {
  return (
    <>
      <nav className="view-nav" aria-label="Vistas de la biblioteca">
        <button
          type="button"
          id="tab-cronologia"
          aria-pressed={view.value === 'cronologia'}
          onClick={() => { view.value = 'cronologia'; }}
        >
          Cronología
        </button>
        <button
          type="button"
          id="tab-categoria"
          aria-pressed={view.value === 'categoria'}
          onClick={() => { view.value = 'categoria'; }}
        >
          Categoría
        </button>
        <button
          type="button"
          id="tab-portales"
          aria-pressed={view.value === 'portales'}
          onClick={() => { view.value = 'portales'; }}
        >
          Portales
        </button>
        <button
          type="button"
          id="tab-operaciones"
          aria-pressed={view.value === 'operaciones'}
          onClick={() => { view.value = 'operaciones'; }}
        >
          Operaciones
        </button>
      </nav>
      {view.value === 'categoria' && (
        <div id="categories" aria-label="Categorías">
          {availableTypes.map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={categoryTypes.value.includes(type)}
              onClick={() => {
                filters.value = { ...filters.value, type: '' };
                categoryTypes.value = categoryTypes.value.includes(type)
                  ? categoryTypes.value.filter((item) => item !== type)
                  : [...categoryTypes.value, type];
              }}
            >
              {type}
            </button>
          ))}
        </div>
      )}
    </>
  );
}