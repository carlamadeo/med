import {categoryTypes} from '../state/store';

interface LibraryTabsProps {
    availableTypes: string[];
}

export function LibraryTabs({availableTypes}: LibraryTabsProps) {
    if (!availableTypes.length) return null;

    return (
        <div id="categories" className="library-types" role="group" aria-label="Filtrar por tipo de estudio">
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
    );
}
