import {view, categoryTypes} from '../state/store';

interface LibraryTabsProps {
    availableTypes: string[];
}

export function LibraryTabs({availableTypes}: LibraryTabsProps) {
    if (!availableTypes.length) return null;

    return (
        <>
            <nav id="views" className="library-views" role="tablist" aria-label="Vistas de la biblioteca">
                <button
                    type="button"
                    id="tab-cronologia"
                    role="tab"
                    aria-selected={view.value === 'cronologia'}
                    onClick={() => {
                        view.value = 'cronologia';
                    }}
                >
                    Cronología
                </button>
                <button
                    type="button"
                    id="tab-categoria"
                    role="tab"
                    aria-selected={view.value === 'categoria'}
                    onClick={() => {
                        view.value = 'categoria';
                    }}
                >
                    Categoría
                </button>
                <button
                    type="button"
                    id="tab-portales"
                    role="tab"
                    aria-selected={view.value === 'portales'}
                    onClick={() => {
                        view.value = 'portales';
                    }}
                >
                    Portales
                </button>
                <button
                    type="button"
                    id="tab-operaciones"
                    role="tab"
                    aria-selected={view.value === 'operaciones'}
                    onClick={() => {
                        view.value = 'operaciones';
                    }}
                >
                    Operaciones
                </button>
                <button type="button" id="tab-eventos" role="tab" aria-selected={view.value === 'eventos'} onClick={() => {
                    view.value = 'eventos';
                }}>Consultas y recetas
                </button>
                <button type="button" id="tab-episodios" role="tab" aria-selected={view.value === 'episodios'} onClick={() => {
                    view.value = 'episodios';
                }}>Episodios
                </button>
                <button type="button" id="tab-turnos" role="tab" aria-selected={view.value === 'turnos'} onClick={() => {
                    view.value = 'turnos';
                }}>Turnos
                </button>
                <button type="button" id="tab-intake" role="tab" aria-selected={view.value === 'intake'} onClick={() => {
                    view.value = 'intake';
                }}>Intake asistido
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