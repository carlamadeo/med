import {specialtyNames, usedStudyTypeCounts} from '@domain/library';
import {categoryTypes, librarySpecialty, studies, visibleStudies} from '../state/store';
import {MultiSelectCombobox} from './MultiSelectCombobox';

interface LibraryTabsProps {
    availableTypes?: string[];
}

export function LibraryTabs(_props: LibraryTabsProps) {
    const {options, counts} = usedStudyTypeCounts(studies.value, categoryTypes.value);
    const selectedSpecialty = librarySpecialty.value;
    const records = visibleStudies.value;
    const specialties = specialtyNames(records, selectedSpecialty ? [selectedSpecialty] : []);
    if (!records.length && !specialties.length && !options.length) return null;

    return (
        <div className="library-classification-filters">
            {options.length > 0 && <div id="categories" className="library-type-filter">
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
            </div>}
            <div className="library-specialty-filter">
                <select aria-label="Filtrar por especialidad" value={selectedSpecialty}
                        disabled={!specialties.length}
                        onChange={event => librarySpecialty.value = event.currentTarget.value}>
                    <option value="">Todas las especialidades</option>
                    {specialties.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
                <svg className="icon" aria-hidden="true"><use href="#i-chevron-down"/></svg>
            </div>
        </div>
    );
}
