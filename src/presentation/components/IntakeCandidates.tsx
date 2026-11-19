import {useEffect, useRef, useState} from 'preact/hooks';
import {clearIntakeReservation, hasIntakeReservation, readIntakeDraft, readIntakeReservationId} from '../utils/intakeReservation';
import {normalize} from '@domain/utils';
import {driveAuth, driveIntakeRepo, driveStudyRepo} from '@data';
import {
    intakeCandidates,
    intakeLoading,
    intakeError,
    approvedFolderId,
    setIntakeCandidates,
    setIntakeLoading,
    setIntakeError,
    updateCandidateStatus,
    setFolderPickerOpen,
    isEditorOpen,
    studies,
    setStudies,
    pendingChanges
} from '../state/store';
import type {StudyDraft} from '@domain/models';
import type {IntakeCandidate} from '@domain/repository';

interface IntakeCandidatesProps {
    onOpenEditor: (draft: Partial<StudyDraft> & { _candidateId: string; _candidateName: string }) => void;
}

function readDiscarded(owner: string | null): string[] {
    if (!owner) return [];
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(`mis-estudios:intake-discarded:${owner}`) ?? '[]');
        return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch {
        return [];
    }
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
    try {
        return new Date(dateStr).toLocaleDateString('es-AR', {day: 'numeric', month: 'short', year: 'numeric'});
    } catch {
        return dateStr;
    }
}

export function IntakeCandidates({onOpenEditor}: IntakeCandidatesProps) {
    const generation = useRef(0);
    const owner = driveAuth.cachedAccountId();
    const [deletedSources, setDeletedSources] = useState<string[]>([]);
    const uncertainCandidates = intakeCandidates.value.filter(candidate => owner && hasIntakeReservation(owner, candidate.id));
    const deletedCandidates = intakeCandidates.value.filter(candidate => deletedSources.includes(candidate.id));
    const candidates = intakeCandidates.value.filter(candidate => !uncertainCandidates.includes(candidate) && !deletedCandidates.includes(candidate)).map(candidate => {
        if (studies.value.some(study => study.intakeSourceId === candidate.id || study.driveFileId === candidate.id)) {
            return {...candidate, status: 'imported' as const};
        }
        if (pendingChanges.value.some(entry => entry.kind === 'save' && entry.draft?.intakeSourceId === candidate.id)) {
            return {...candidate, status: 'pending' as const};
        }
        return candidate;
    });
    const loading = intakeLoading.value;
    const error = intakeError.value;
    const folderId = approvedFolderId.value;
    const [query, setQuery] = useState('');
    const [refreshVersion, setRefreshVersion] = useState(0);

    useEffect(() => {
        const unsubscribe = driveAuth.onAuthChange(() => {
            generation.current += 1;
        });
        return () => {
            generation.current += 1;
            unsubscribe();
        };
    }, []);

    useEffect(() => {
        if (!folderId) return;
        let cancelled = false;
        const currentGeneration = generation.current;

        async function load() {
            setIntakeLoading(true);
            setIntakeError(null);
            try {
                if (driveAuth.isSignedIn()) {
                    const deleted = await driveStudyRepo.listDeleted();
                    if (!cancelled && generation.current === currentGeneration) {
                        setDeletedSources(deleted.filter(study => study.recoverable && study.intakeSourceId).map(study => study.intakeSourceId!));
                    }
                }
                const list = await driveIntakeRepo.listCandidates(folderId as string);
                if (!cancelled && generation.current === currentGeneration) {
                    const owner = driveAuth.cachedAccountId();
                    const discarded = readDiscarded(owner);
                    setIntakeCandidates(list.map(candidate => discarded.includes(candidate.id) ? {...candidate, status: 'discarded'} : candidate));
                }
            } catch (err) {
                if (!cancelled && generation.current === currentGeneration) {
                    setIntakeError(err instanceof Error ? err.message : 'No se pudieron cargar los candidatos');
                }
            } finally {
                if (!cancelled && generation.current === currentGeneration) setIntakeLoading(false);
            }
        }

        void load();
        return () => {
            cancelled = true;
        };
    }, [folderId, refreshVersion]);

    const normalizedQuery = normalize(query);
    const matches = (candidate: IntakeCandidate) => !normalizedQuery || normalize(candidate.name).includes(normalizedQuery);
    const newCandidates = candidates.filter(c => c.status === 'new' && matches(c));
    const importedCandidates = candidates.filter(c => c.status === 'imported' && matches(c));
    const discardedCandidates = candidates.filter(c => c.status === 'discarded' && matches(c));
    const pendingCandidates = candidates.filter(c => c.status === 'pending' && matches(c));
    const hasVisibleCandidates = newCandidates.length > 0 || pendingCandidates.length > 0 || importedCandidates.length > 0 || discardedCandidates.length > 0 || uncertainCandidates.length > 0 || deletedCandidates.length > 0;

    const handleImport = async (candidate: IntakeCandidate) => {
        const currentGeneration = generation.current;
        updateCandidateStatus(candidate.id, 'pending');
        try {
            const token = await driveAuth.getAccessToken();
            const owner = driveAuth.cachedAccountId();
            if (!owner) throw new Error('Conectate primero para verificar tu cuenta.');
            const reservedId = readIntakeReservationId(owner, candidate.id);
            if (reservedId) {
                const currentStudies = await driveStudyRepo.list({force: true});
                if (currentGeneration !== generation.current || driveAuth.cachedAccountId() !== owner || await driveAuth.getAccessToken() !== token) return;
                const saved = currentStudies.find(study => study.id === reservedId && study.intakeSourceId === candidate.id);
                if (saved) {
                    clearIntakeReservation(owner, candidate.id);
                    setStudies(currentStudies);
                    updateCandidateStatus(candidate.id, 'imported');
                    return;
                }
            }
            const file = await driveIntakeRepo.getPdfFile(candidate.id, candidate.name);
            if (currentGeneration !== generation.current || driveAuth.cachedAccountId() !== owner || await driveAuth.getAccessToken() !== token) return;

            onOpenEditor({
                ...readIntakeDraft(owner, candidate.id),
                _candidateId: candidate.id,
                _candidateName: candidate.name,
                file,
            });
            updateCandidateStatus(candidate.id, 'new');
        } catch {
            if (currentGeneration !== generation.current) return;
            updateCandidateStatus(candidate.id, 'new');
            setIntakeError('No se pudo abrir el documento. Revisá la conexión y volvé a intentar.');
        }
    };

    const handleDiscard = (candidate: IntakeCandidate) => {
        const owner = driveAuth.cachedAccountId();
        if (owner) {
            const discarded = readDiscarded(owner);
            localStorage.setItem(`mis-estudios:intake-discarded:${owner}`, JSON.stringify([...new Set([...discarded, candidate.id])]));
        }
        updateCandidateStatus(candidate.id, 'discarded');
    };

    const handleReview = (candidate: IntakeCandidate) => {
        const owner = driveAuth.cachedAccountId();
        if (owner) {
            const discarded = readDiscarded(owner).filter(id => id !== candidate.id);
            localStorage.setItem(`mis-estudios:intake-discarded:${owner}`, JSON.stringify(discarded));
        }
        updateCandidateStatus(candidate.id, 'new');
    };

    if (!folderId) {
        return (
            <section className="intake" aria-labelledby="intake-title">
                <div className="intake-head">
                    <div>
                        <p className="eyebrow">Archivo</p>
                        <h2 id="intake-title">Bandeja de entrada</h2>
                        <p className="intake-desc">Revisá documentos candidatos antes de incorporarlos al archivo.</p>
                    </div>
                </div>
                <div className="intake-empty">
                    <span className="intake-empty-icon"><svg className="icon" aria-hidden="true"><use href="#i-scan"/></svg></span>
                    <h3>Bandeja de entrada no configurada</h3>
                    <p>Configurá una carpeta aprobada en Drive para revisar documentos candidatos antes de
                        incorporarlos.</p>
                    <button
                        type="button"
                        className="button secondary button-sm"
                        onClick={() => setFolderPickerOpen(true)}
                    >
                        Configurar carpeta
                    </button>
                </div>
            </section>
        );
    }

    return (
        <section className="intake" aria-labelledby="intake-title">
            <div className="intake-head">
                <div>
                    <p className="eyebrow">Archivo</p>
                    <h2 id="intake-title">Bandeja de entrada</h2>
                    <p className="intake-desc">Documentos candidatos de la carpeta aprobada, listos para revisar.</p>
                </div>
                <div className="intake-head-actions">
                    <span className="count-badge">{candidates.length}</span>
                    <button type="button" className="button secondary" disabled={loading} onClick={() => setRefreshVersion(version => version + 1)}>
                        <svg className="icon">
                            <use href="#i-refresh"/>
                        </svg>
                        {loading ? 'Actualizando…' : 'Actualizar'}
                    </button>
                </div>
            </div>

            {error && <p className="intake-error" role="alert">{error}</p>}

            {loading && <p className="intake-loading" role="status" aria-live="polite">Cargando candidatos…</p>}

            {folderId && (
                <label className="intake-search">
                    <svg className="icon">
                        <use href="#i-search"/>
                    </svg>
                    <span className="sr-only">Buscar candidatos</span>
                    <input id="intake-search" type="search" placeholder="Buscar por nombre de archivo…" value={query}
                           onInput={(event) => setQuery((event.target as HTMLInputElement).value)}/>
                </label>
            )}

            {newCandidates.length > 0 && (
                <section className="intake-group" aria-labelledby="intake-new-title">
                    <div className="intake-group-head">
                        <h3 id="intake-new-title">Nuevos</h3>
                        <span className="count-badge">{newCandidates.length}</span>
                    </div>
                    <ul className="intake-list" aria-busy={loading}>
                        {newCandidates.map(candidate => (
                            <li key={candidate.id} className="intake-card" data-status="new">
                                <span className="intake-icon"><svg className="icon"><use href="#i-file"/></svg></span>
                                <div className="intake-text">
                                    <p className="intake-name">{candidate.name}</p>
                                    <p className="intake-meta">{formatDate(candidate.modifiedTime)}{candidate.size > 0 ? ` · ${formatFileSize(candidate.size)}` : ''}</p>
                                </div>
                                <div className="intake-card-actions">
                                    <button type="button" className="button primary button-sm"
                                            onClick={() => handleImport(candidate)}
                                            disabled={isEditorOpen.value}>Importar
                                    </button>
                                    <button type="button" className="button quiet button-sm"
                                            onClick={() => handleDiscard(candidate)}>Descartar
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {uncertainCandidates.length > 0 && (
                <section className="intake-group" aria-label="Guardados sin confirmar">
                    <h3>Guardados sin confirmar</h3>
                    <ul className="intake-list">
                        {uncertainCandidates.filter(matches).map(candidate => (
                            <li key={candidate.id} className="intake-card">
                                <div className="intake-text">
                                    <p className="intake-name">{candidate.name}</p>
                                    <p>Revisá los mismos datos y volvé a intentar.</p>
                                </div>
                                <button type="button" className="button secondary button-sm" onClick={() => void handleImport(candidate)}>Verificar y reintentar</button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {deletedCandidates.length > 0 && (
                <section className="intake-group" aria-label="Informes en la papelera">
                    <h3>Informes en la papelera</h3>
                    <ul className="intake-list">
                        {deletedCandidates.filter(matches).map(candidate => (
                            <li key={candidate.id} className="intake-card">
                                <div className="intake-text">
                                    <p className="intake-name">{candidate.name}</p>
                                    <p>Ya importado. Usá «Recuperar informe» para restaurarlo.</p>
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {pendingCandidates.length > 0 && (
                <section className="intake-group" aria-labelledby="intake-pending-title">
                    <div className="intake-group-head">
                        <h3 id="intake-pending-title">Pendientes</h3>
                        <span className="count-badge">{pendingCandidates.length}</span>
                    </div>
                    <ul className="intake-list">
                        {pendingCandidates.map(candidate => (
                            <li key={candidate.id} className="intake-card" data-status="pending">
                                <span className="intake-icon"><svg className="icon"><use href="#i-clock"/></svg></span>
                                <div className="intake-text">
                                    <p className="intake-name">{candidate.name}</p>
                                    <p className="intake-meta" data-tone="warning">Importando…</p>
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {importedCandidates.length > 0 && (
                <details className="intake-group">
                    <summary className="intake-group-summary">Importados <span
                        className="count-badge">{importedCandidates.length}</span></summary>
                    <ul className="intake-list">
                        {importedCandidates.map(candidate => (
                            <li key={candidate.id} className="intake-card" data-status="imported">
                                <span className="intake-icon"><svg className="icon"><use href="#i-check"/></svg></span>
                                <div className="intake-text">
                                    <p className="intake-name">{candidate.name}</p>
                                    <p className="intake-meta">Ya importado</p>
                                </div>
                            </li>
                        ))}
                    </ul>
                </details>
            )}

            {discardedCandidates.length > 0 && (
                <details className="intake-group">
                    <summary className="intake-group-summary">Descartados <span
                        className="count-badge">{discardedCandidates.length}</span></summary>
                    <ul className="intake-list">
                        {discardedCandidates.map(candidate => (
                            <li key={candidate.id} className="intake-card" data-status="discarded">
                                <span className="intake-icon"><svg className="icon"><use href="#i-trash"/></svg></span>
                                <div className="intake-text">
                                    <p className="intake-name">{candidate.name}</p>
                                    <p className="intake-meta">Descartado</p>
                                </div>
                                <div className="intake-card-actions">
                                    <button type="button" className="button quiet button-sm"
                                            onClick={() => handleReview(candidate)}>Revisar
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </details>
            )}

            {!loading && !error && !hasVisibleCandidates && (
                <div className="intake-empty">
                    <span className="intake-empty-icon"><svg className="icon"><use href="#i-file"/></svg></span>
                    <h3>{normalizedQuery ? 'Sin candidatos que coincidan' : 'No hay candidatos nuevos'}</h3>
                    <p>{normalizedQuery ? 'Probá con otro nombre de archivo.' : 'La carpeta aprobada no tiene PDFs nuevos o todos fueron revisados.'}</p>
                    {normalizedQuery && <button type="button" className="button secondary button-sm"
                                                onClick={() => setQuery('')}>Limpiar búsqueda</button>}
                </div>
            )}
        </section>
    );
}
