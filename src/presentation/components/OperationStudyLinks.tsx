import {useState} from 'preact/hooks';
import {filterStudiesByQuery, formatStudyDate, sortStudies, usedStudyTypeCounts} from '@domain/library';
import type {Study} from '@domain/models';
import {normalize} from '@domain/utils';
import {studies} from '../state/store';

const PAGE_SIZE = 8;

interface OperationStudyLinksProps {
    operationId: string;
    linked: Study[];
    busy: boolean;
    onLinkChange: (study: Study, checked: boolean) => void;
}

function StudyDetails({study}: {study: Study}) {
    return <>
        <span className="linked-title">{study.title}</span>
        <time className="linked-date" dateTime={study.date}>{formatStudyDate(study.date)}</time>
    </>;
}

export function OperationStudyLinks({linked, ...pickerProps}: OperationStudyLinksProps) {
    const [managing, setManaging] = useState(false);

    return <section className="operation-studies" aria-labelledby="operation-studies-title">
        <div className="linked-head">
            <h3 id="operation-studies-title">Estudios vinculados</h3>
            {studies.value.length > 0 && (
                <button className="button secondary" type="button" aria-expanded={managing}
                        aria-controls="operation-study-picker" onClick={() => setManaging(!managing)}>
                    {managing ? 'Ver vinculados' : 'Gestionar estudios'}
                </button>
            )}
        </div>
        <div className="linked-current" data-managing={managing} role="region"
             aria-label="Lista de estudios vinculados" tabIndex={linked.length ? 0 : undefined}>
            {linked.length ? (
                <ul className="linked-list">
                    {linked.map(study => <li className="linked-item linked-row" key={study.id}>
                        <StudyDetails study={study}/>
                    </li>)}
                </ul>
            ) : <p className="linked-empty">Todavía no hay estudios vinculados.</p>}
        </div>
        <div id="operation-study-picker" className="linked-picker" hidden={!managing}>
            {managing && <OperationStudyPicker {...pickerProps}/>}
        </div>
    </section>;
}

function OperationStudyPicker({operationId, busy, onLinkChange}: Omit<OperationStudyLinksProps, 'linked'>) {
    const [query, setQuery] = useState('');
    const [type, setType] = useState('');
    const [page, setPage] = useState(0);
    const archive = studies.value;
    const {options} = usedStudyTypeCounts(archive, type ? [type] : []);
    const normalizedType = normalize(type);
    const candidates = normalizedType
        ? archive.filter(study => study.types.some(value => normalize(value) === normalizedType))
        : archive;
    const matches = sortStudies(filterStudiesByQuery(candidates, query));
    const lastPage = Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1);
    const current = Math.min(page, lastPage);
    const first = current * PAGE_SIZE;
    const end = Math.min(first + PAGE_SIZE, matches.length);

    function changePage(next: number) {
        if (next >= 0 && next <= lastPage) setPage(next);
    }

    return <>
        <div className="linked-filters">
            <label>
                Buscar estudios
                <span className="linked-search-control">
                    <svg className="icon" aria-hidden="true"><use href="#i-search"/></svg>
                    <input id="operation-study-search" type="search" value={query}
                           placeholder="Nombre, profesional o institución…" onInput={event => {
                        setQuery(event.currentTarget.value);
                        setPage(0);
                    }}/>
                </span>
            </label>
            <label>
                Tipo de estudio
                <span className="linked-type-control">
                    <select id="operation-study-type" value={type} onChange={event => {
                        setType(event.currentTarget.value);
                        setPage(0);
                    }}>
                        <option value="">Todos los tipos</option>
                        {options.map(option => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <svg className="icon" aria-hidden="true"><use href="#i-chevron-down"/></svg>
                </span>
            </label>
        </div>
        <p className="linked-help">
            Si un estudio pertenece a otra operación, al marcarlo se mueve a esta.
        </p>
        {matches.length ? (
            <ul className="linked-list">
                {matches.slice(first, end).map(study => {
                    const linked = study.operationId === operationId;
                    return <li className="linked-item" key={study.id}>
                        <label className="linked-row">
                            <input type="checkbox" data-study-id={study.id} checked={linked} disabled={busy}
                                   onChange={event => onLinkChange(study, event.currentTarget.checked)}/>
                            <StudyDetails study={study}/>
                            {study.operationId && !linked && <span className="tag">Otra operación</span>}
                        </label>
                    </li>;
                })}
            </ul>
        ) : <p className="linked-empty" role="status">No hay estudios que coincidan con los filtros.</p>}
        {lastPage > 0 && (
            <nav className="library-pagination" aria-label="Páginas de estudios para vincular">
                <button className="button secondary" type="button" aria-disabled={current === 0}
                        onClick={() => changePage(current - 1)}>Anterior</button>
                <span role="status">{first + 1}–{end} de {matches.length} estudios</span>
                <button className="button secondary" type="button" aria-disabled={current === lastPage}
                        onClick={() => changePage(current + 1)}>Siguiente</button>
            </nav>
        )}
    </>;
}
