import {usedStudyTypeCounts} from '@domain/library';
import {categoryTypes, studies} from '../state/store';
import {MultiSelectCombobox} from './MultiSelectCombobox';

interface LibraryTabsProps {
    availableTypes?: string[];
}

export function LibraryTabs(_props: LibraryTabsProps) {
    const {options, counts} = usedStudyTypeCounts(studies.value, categoryTypes.value);
    if (options.length === 0) return null;

    return (
        <div id="categories" className="library-type-filter">
            <MultiSelectCombobox
                options={options}
                optionCounts={counts}
                value={categoryTypes.value}
                onChange={(next) => {
                    categoryTypes.value = next;
                }}
                placeholder="Todos los tipos"
                searchPlaceholder="Buscar tipo…"
                ariaLabel="Filtrar por tipo de estudio"
            />
        </div>
    );
}
