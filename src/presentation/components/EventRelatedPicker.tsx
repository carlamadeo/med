import {useState} from 'preact/hooks';
import {normalize} from '@domain/utils';

interface RelatedOption {
    id: string;
    label: string;
    keywords?: string;
}

interface EventRelatedPickerProps {
    name: 'studyId' | 'documentId';
    options: RelatedOption[];
    initialIds?: string[];
}

export function EventRelatedPicker({name, options, initialIds = []}: EventRelatedPickerProps) {
    const [selected, setSelected] = useState(() => new Set(initialIds));
    const [query, setQuery] = useState('');
    const isStudy = name === 'studyId';
    const title = isStudy ? 'Estudios relacionados' : 'Documentos relacionados';
    const searchLabel = isStudy ? 'Buscar estudios relacionados' : 'Buscar documentos relacionados';
    const missingLabel = isStudy ? 'Estudio no disponible' : 'Documento no disponible';
    const availableIds = new Set(options.map(option => option.id));
    const missing = [...selected].filter(id => !availableIds.has(id)).map(id => ({id, label: missingLabel}));
    const entries: RelatedOption[] = [...options, ...missing];
    const search = normalize(query);
    const matches = search ? entries.filter(({label, keywords}) => normalize(`${label} ${keywords ?? ''}`).includes(search)) : entries;

    const toggle = (id: string, checked: boolean) => setSelected(previous => {
        const next = new Set(previous);
        if (checked) next.add(id);
        else next.delete(id);
        return next;
    });

    return (
        <details className="event-related">
            <summary tabIndex={0}>
                <span>{title}</span>
                <span className="count-badge" aria-live="polite">
                    {selected.size}<span className="sr-only"> {selected.size === 1 ? 'seleccionado' : 'seleccionados'}</span>
                </span>
                <svg className="icon" aria-hidden="true"><use href="#i-chevron-down"/></svg>
            </summary>
            {[...selected].map(id => <input key={id} type="hidden" name={name} value={id}/>)}
            <div className="event-related-panel">
                {entries.length > 0 ? (
                    <>
                        <input type="search" aria-label={searchLabel} placeholder={searchLabel}
                               value={query} onInput={event => setQuery(event.currentTarget.value)}
                               onKeyDown={event => {
                                   if (event.key === 'Enter') event.preventDefault();
                               }}/>
                        {matches.length > 0 ? (
                            <div className="event-related-options">
                                {matches.map(({id, label}) => (
                                    <label key={id}>
                                        <input type="checkbox" checked={selected.has(id)}
                                               onChange={event => toggle(id, event.currentTarget.checked)}/>
                                        <span>{label}</span>
                                    </label>
                                ))}
                            </div>
                        ) : <p className="event-related-empty" role="status">Sin coincidencias</p>}
                    </>
                ) : <p className="event-related-empty">{isStudy ? 'No hay estudios para vincular.' : 'No hay documentos para vincular.'}</p>}
            </div>
        </details>
    );
}
