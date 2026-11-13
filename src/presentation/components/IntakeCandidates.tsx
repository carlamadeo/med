import { useEffect, useRef } from 'preact/hooks';
import { driveAuth, driveIntakeRepo } from '@data';
import { intakeCandidates, intakeLoading, intakeError, approvedFolderId, setIntakeCandidates, setIntakeLoading, setIntakeError, updateCandidateStatus, isEditorOpen } from '../state/store';
import type { StudyDraft } from '@domain/models';
import type { IntakeCandidate } from '@domain/repository';

interface IntakeCandidatesProps {
  onOpenEditor: (draft: Partial<StudyDraft> & { _candidateId: string; _candidateName: string }) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export function IntakeCandidates({ onOpenEditor }: IntakeCandidatesProps) {
  const generation = useRef(0);
  const candidates = intakeCandidates.value;
  const loading = intakeLoading.value;
  const error = intakeError.value;
  const folderId = approvedFolderId.value;

  useEffect(() => {
    const unsubscribe = driveAuth.onAuthChange(() => { generation.current += 1; });
    return () => { generation.current += 1; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!folderId) return;
    let cancelled = false;
    async function load() {
      setIntakeLoading(true);
      setIntakeError(null);
      try {
        const list = await driveIntakeRepo.listCandidates(folderId as string);
        if (!cancelled) {
          setIntakeCandidates(list);
        }
      } catch (err) {
        if (!cancelled) {
          setIntakeError(err instanceof Error ? err.message : 'No se pudieron cargar los candidatos');
        }
      } finally {
        if (!cancelled) setIntakeLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [folderId]);

  const newCandidates = candidates.filter(c => c.status === 'new');
  const importedCandidates = candidates.filter(c => c.status === 'imported');
  const discardedCandidates = candidates.filter(c => c.status === 'discarded');
  const pendingCandidates = candidates.filter(c => c.status === 'pending');

  const handleImport = async (candidate: IntakeCandidate) => {
    const currentGeneration = generation.current;
    updateCandidateStatus(candidate.id, 'pending');
    try {
      const token = await driveAuth.getAccessToken();
      const owner = driveAuth.cachedAccountId();
      if (!owner) throw new Error('Conectate primero para verificar tu cuenta.');
      const file = await driveIntakeRepo.getPdfFile(candidate.id);
      if (currentGeneration !== generation.current || driveAuth.cachedAccountId() !== owner || await driveAuth.getAccessToken() !== token) return;

      onOpenEditor({
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
    updateCandidateStatus(candidate.id, 'discarded');
  };

  const handleReview = (candidate: IntakeCandidate) => {
    updateCandidateStatus(candidate.id, 'new');
  };

  if (!folderId) {
    return (
      <div className="empty-state">
        <svg className="icon" style={{ width: '48px', height: '48px', margin: '0 auto 16px', color: 'var(--muted)' }}><use href="#i-file" /></svg>
        <h3>Intake asistido no configurado</h3>
        <p style={{ color: 'var(--muted)', marginTop: '8px', maxWidth: '38ch' }}>
          Configurá una carpeta aprobada en Drive para revisar documentos candidatos antes de incorporarlos.
        </p>
      </div>
    );
  }

  return (
    <section aria-label="Intake asistido">
      <div className="section-head">
        <div className="section-title">
          <h2>Intake asistido</h2>
          <span className="count">{candidates.length} candidatos</span>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={loading}
          onClick={() => { setIntakeLoading(true); setIntakeError(null); setIntakeCandidates(intakeCandidates.value.map(c => c.status === 'imported' ? { ...c, status: 'new' } : c)); setIntakeLoading(false); }}
        >
          {loading ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {loading && <p className="list-status" role="status">Cargando candidatos…</p>}

      {newCandidates.length > 0 && (
        <fieldset>
          <legend>Nuevos ({newCandidates.length})</legend>
          <ul className="results">
            {newCandidates.map(candidate => (
              <li key={candidate.id} className="record candidate-new">
                <div className="record-main">
                  <span className="file-icon"><svg className="icon"><use href="#i-file" /></svg></span>
                  <div className="record-text">
                    <h3 className="record-title">{candidate.name}</h3>
                    <p className="record-meta">
                      <span>{formatDate(candidate.modifiedTime)}</span>
                      <span>·</span>
                      <span>{formatFileSize(candidate.size)}</span>
                    </p>
                  </div>
                </div>
                <div className="record-controls">
                  <div className="record-actions">
                    <button
                      type="button"
                      className="button primary"
                      onClick={() => handleImport(candidate)}
                      disabled={isEditorOpen.value}
                    >
                      Importar
                    </button>
                    <button
                      type="button"
                      className="button quiet"
                      onClick={() => handleDiscard(candidate)}
                    >
                      Descartar
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      {pendingCandidates.length > 0 && (
        <fieldset>
          <legend>Pendientes ({pendingCandidates.length})</legend>
          <ul className="results">
            {pendingCandidates.map(candidate => (
              <li key={candidate.id} className="record candidate-pending">
                <div className="record-main">
                  <span className="file-icon"><svg className="icon"><use href="#i-file" /></svg></span>
                  <div className="record-text">
                    <h3 className="record-title">{candidate.name}</h3>
                    <p className="record-meta" style={{ color: 'var(--warning)' }}>Importando…</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      {importedCandidates.length > 0 && (
        <details>
          <summary>Importados ({importedCandidates.length})</summary>
          <ul className="results">
            {importedCandidates.map(candidate => (
              <li key={candidate.id} className="record candidate-imported">
                <div className="record-main">
                  <span className="file-icon"><svg className="icon"><use href="#i-file" /></svg></span>
                  <div className="record-text">
                    <h3 className="record-title">{candidate.name}</h3>
                    <p className="record-meta" style={{ color: 'var(--muted)' }}>Ya importado</p>
                  </div>
                </div>
                <div className="record-controls">
                  <div className="record-actions">
                    <button
                      type="button"
                      className="button quiet"
                      onClick={() => handleReview(candidate)}
                    >
                      Revisar de nuevo
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {discardedCandidates.length > 0 && (
        <details>
          <summary>Descartados ({discardedCandidates.length})</summary>
          <ul className="results">
            {discardedCandidates.map(candidate => (
              <li key={candidate.id} className="record candidate-discarded" style={{ opacity: 0.6 }}>
                <div className="record-main">
                  <span className="file-icon"><svg className="icon"><use href="#i-file" /></svg></span>
                  <div className="record-text">
                    <h3 className="record-title">{candidate.name}</h3>
                    <p className="record-meta" style={{ color: 'var(--muted)' }}>Descartado</p>
                  </div>
                </div>
                <div className="record-controls">
                  <div className="record-actions">
                    <button
                      type="button"
                      className="button quiet"
                      onClick={() => handleReview(candidate)}
                    >
                      Revisar
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {newCandidates.length === 0 && pendingCandidates.length === 0 && importedCandidates.length === 0 && discardedCandidates.length === 0 && !loading && !error && (
        <div className="empty-state" style={{ marginTop: '24px' }}>
          <svg className="icon" style={{ width: '48px', height: '48px', margin: '0 auto 16px', color: 'var(--muted)' }}><use href="#i-file" /></svg>
          <h3>No hay candidatos nuevos</h3>
          <p style={{ color: 'var(--muted)', marginTop: '8px' }}>La carpeta aprobada no tiene PDFs nuevos o todos fueron revisados</p>
        </div>
      )}
    </section>
  );
}
