import {useState} from 'preact/hooks';
import {normalizeDoctorName} from '@domain/library';
import {error, loading, studyDoctors} from '../state/store';
import {EmptyState} from './EmptyState';

interface DoctorsProps {
    onViewStudies: (name: string) => void;
    onRetryLoad: () => void;
}

export function Doctors({onViewStudies, onRetryLoad}: DoctorsProps) {
    const [query, setQuery] = useState('');
    const doctors = studyDoctors.value;
    const normalizedQuery = normalizeDoctorName(query);
    const matchingDoctors = doctors.filter(doctor => doctor.key.includes(normalizedQuery));
    const loadError = error.value;

    return (
        <section className="portals" aria-labelledby="doctors-title">
            <div className="portals-head">
                <div>
                    <p className="eyebrow">Directorio</p>
                    <h2 id="doctors-title">Estudios por profesional</h2>
                    <p className="portals-desc">Profesionales registrados en tus estudios.</p>
                </div>
                <div className="portals-head-actions">
                    <span className="count-badge" aria-label={`${doctors.length} ${doctors.length === 1 ? 'profesional' : 'profesionales'}`}>{doctors.length}</span>
                </div>
            </div>
            {loading.value ? (
                <p className="list-status" role="status">Cargando tus estudios…</p>
            ) : loadError ? (
                <EmptyState variant="error" title="No se pudo abrir el archivo" description={loadError}
                            action={<button className="button secondary" type="button" onClick={onRetryLoad}>Reintentar</button>}/>
            ) : doctors.length === 0 ? (
                <div className="portal-empty" role="status">
                    <span className="portal-empty-icon"><svg className="icon" aria-hidden="true"><use href="#i-stethoscope"/></svg></span>
                    <p>Agregá el nombre del profesional en la ficha de un estudio para verlo acá.</p>
                </div>
            ) : (
                <>
                    <div className="portals-toolbar">
                        <label className="portals-search">
                            <svg className="icon" aria-hidden="true"><use href="#i-search"/></svg>
                            <span className="sr-only">Buscar profesionales</span>
                            <input id="doctor-search" type="search" placeholder="Buscar por nombre…"
                                   value={query} onInput={event => setQuery(event.currentTarget.value)}/>
                        </label>
                    </div>
                    {matchingDoctors.length ? (
                        <ul id="doctors-list" className="portal-grid">
                            {matchingDoctors.map(({key, name, studyCount}) => (
                                <li className="portal-card" key={key}>
                                    <div className="portal-card-head">
                                        <span className="portal-logo" aria-hidden="true">
                                            <svg className="icon"><use href="#i-stethoscope"/></svg>
                                        </span>
                                        <div className="portal-card-title">
                                            <h3>{name}</h3>
                                            <p>{studyCount} {studyCount === 1 ? 'estudio' : 'estudios'}</p>
                                        </div>
                                    </div>
                                    <div className="portal-card-actions">
                                        <button className="button secondary button-sm" type="button"
                                                aria-label={`Ver estudios de ${name}`} onClick={() => onViewStudies(name)}>
                                            Ver estudios
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="portal-empty">
                            <p role="status">No hay profesionales que coincidan con la búsqueda.</p>
                            <button className="button secondary button-sm" type="button" onClick={() => setQuery('')}>
                                Limpiar búsqueda
                            </button>
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
