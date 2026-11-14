import {visibleStudies, loading, error, view} from '../state/store';
import {StudyList} from './StudyList';
import {EmptyState} from './EmptyState';
import {Operations} from './Operations';
import {MedicalEvents} from './MedicalEvents';
import {Portals} from './Portals';
import {IntakeCandidates} from './IntakeCandidates';
import {Episodes} from './Episodes';
import {Appointments} from './Appointments';
import {LibraryTabs} from './LibraryTabs';
import type {Study, StudyDraft} from '@domain/models';

interface StudyListContainerProps {
    onEdit: (study: Study) => void;
    onDelete: (study: Study) => void;
    onShare?: (study: Study) => void;
    onRetryLoad: () => void;
    onAddStudy: () => void;
    onOpenCandidate: (draft: Partial<StudyDraft> & { _candidateId: string; _candidateName: string }) => void;
    typesReady: boolean;
    availableTypes: string[];
    offline: boolean;
    directoryWarning: boolean;
    pendingChangesCount: number;
}

export function StudyListContainer({
                                        onEdit,
                                        onDelete,
                                        onShare,
                                        onRetryLoad,
                                        onAddStudy,
                                        onOpenCandidate,
                                        typesReady,
                                        availableTypes,
                                        offline,
                                        directoryWarning,
                                        pendingChangesCount
                                    }: StudyListContainerProps) {
    const studiesList = visibleStudies.value;
    const isLoading = loading.value;
    const loadError = error.value;

    return (
        <>
            {offline &&
                <p className="offline-notice" role="status">Sin conexión: estás viendo la última copia disponible en este dispositivo.</p>}
            {(pendingChangesCount > 0) && (
                <div id="pending-changes-placeholder"/>)}
            {directoryWarning && (
                <p id="directory-warning" role="status">No se pudieron actualizar las operaciones y portales. Se volvera a intentar al recuperar la conexion.</p>
            )}
            <LibraryTabs availableTypes={availableTypes}/>
            {view.value === 'operaciones' && <Operations/>}
            {view.value === 'eventos' && <MedicalEvents/>}
            {view.value === 'episodios' && <Episodes/>}
            {view.value === 'turnos' && <Appointments/>}
            {view.value === 'portales' && <Portals/>}
            {view.value === 'intake' && (
                <IntakeCandidates onOpenEditor={onOpenCandidate}/>
            )}
            {view.value !== 'operaciones' && view.value !== 'portales' && view.value !== 'eventos' && view.value !== 'episodios' && view.value !== 'turnos' && view.value !== 'intake' && (
                <>
                    <div className="section-head">
                        <div className="section-title">
                            <h2 id="library-title">Estudios guardados</h2>
                            <span id="count" className="count">{studiesList.length}</span>
                        </div>
                    </div>

                    {isLoading ? (
                        <>
                            <p id="list-status" className="list-status" role="status">Cargando tus estudios…</p>
                            <ul className="results skeleton-list" aria-hidden="true">
                                {[0, 1, 2].map((item) => (
                                    <li className="record skeleton-card" key={item}>
                                        <div className="record-main">
                                            <div className="skeleton skeleton-icon"/>
                                            <div className="record-text">
                                                <div className="skeleton skeleton-title"/>
                                                <div className="skeleton skeleton-subtitle"/>
                                            </div>
                                            <div className="skeleton skeleton-badge"/>
                                        </div>
                                        <div className="record-controls">
                                            <div className="skeleton skeleton-link"/>
                                            <div className="skeleton skeleton-action"/>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </>
                    ) : loadError ? (
                        <div id="load-error" className="empty">
                            <h3>No se pudo abrir el archivo</h3>
                            <p id="load-error-message">{loadError}</p>
                            <button
                                className="button secondary"
                                id="retry"
                                type="button"
                                onClick={onRetryLoad}
                            >
                                Reintentar
                            </button>
                        </div>
                    ) : studiesList.length === 0 ? (
                        <EmptyState
                            variant="no-studies"
                            title={pendingChangesCount > 0 ? 'Tu estudio está pendiente' : 'Tu archivo empieza acá'}
                            description={pendingChangesCount > 0
                                ? 'Aparecerá en la biblioteca cuando se sincronice con Drive.'
                                : 'Agregá tu primer estudio con su informe en PDF, el enlace al visor o ambos.'}
                            action={
                                <button
                                    className="button secondary"
                                    id="empty-action"
                                    disabled={!typesReady}
                                    type="button"
                                    onClick={onAddStudy}
                                >
                                    <svg className="icon">
                                        <use href="#i-plus"/>
                                    </svg>
                                    Agregar estudio
                                </button>
                            }
                        />
                    ) : (
                        <StudyList onEdit={onEdit} onDelete={onDelete} onShare={onShare ?? (() => {
                        })} studies={studiesList}/>
                    )}
                </>
            )}
        </>
    );
}
