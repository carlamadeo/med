import { useEffect, useRef, useState } from 'preact/hooks';
import { recoveringStudyId, recoveryError, setRecoveringStudyId, setRecoveryError, setStudies, studies } from '../state/store';
import { useFocusTrap } from '../utils/focusTrap';

interface RecoveryDialogProps {
  onReconnect: () => void;
  error: string | null;
  sessionLost: boolean;
}

interface DeletedStudy {
  id: string;
  title: string;
  date: string;
  deletedAt: string;
  recoverable: boolean;
  revision?: string;
}

export function RecoveryDialog({ onReconnect, error, sessionLost }: RecoveryDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const recoveringId = recoveringStudyId.value;
  const recError = recoveryError.value;

  const [deletedStudies, setDeletedStudies] = useState<DeletedStudy[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusTrap(dialogRef, !!recoveringId);

  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    if (recoveringId && !element.open) {
      loadDeletedStudies();
      element.showModal();
      element.querySelector<HTMLButtonElement>('.quiet')?.focus();
    } else if (!recoveringId && element.open) element.close();
  }, [recoveringId]);

  async function loadDeletedStudies() {
    setLoading(true);
    try {
      const response = await fetch('/api/deleted-studies');
      if (response.ok) {
        const data = await response.json();
        setDeletedStudies(data);
      } else {
        setDeletedStudies([]);
      }
    } catch {
      setDeletedStudies([]);
    } finally {
      setLoading(false);
    }
  }

  const handleClose = () => {
    dialogRef.current?.close();
    setRecoveringStudyId(null);
    setRecoveryError(null);
  };

  const handleCancel = () => {
    handleClose();
  };

  async function handleRecover(study: DeletedStudy) {
    if (!study.recoverable) return;
    setRecoveryError(null);

    try {
      const response = await fetch(`/api/recover-study/${study.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: study.revision }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: 'No se pudo recuperar el estudio' }));
        if (err.message.includes('revisión') || err.message.includes('conflict')) {
          setRecoveryError('El registro cambió en Drive. No se puede recuperar sin sobrescribir datos nuevos.');
        } else {
          setRecoveryError(err.message || 'No se pudo recuperar el estudio');
        }
        return;
      }

      const recovered = await response.json();
      setStudies([...studies.value, recovered]);
      setDeletedStudies(deletedStudies.filter(s => s.id !== study.id));
    } catch (err) {
      setRecoveryError(err instanceof Error ? err.message : 'Error de red al recuperar');
    }
  }

  return (
    <dialog id="recovery" ref={dialogRef} className="dialog" aria-labelledby="recovery-title" data-busy={String(loading)}
      onCancel={(event) => { if (loading) event.preventDefault(); else handleCancel(); }}>
      <form id="recovery-form" onSubmit={(event) => { event.preventDefault(); }}>
        <div className="dialog-heading">
          <div><h2 id="recovery-title">Recuperar estudios eliminados</h2>
            <p id="recovery-copy">Los estudios eliminados se pueden recuperar dentro de 30 días</p>
          </div>
          <button type="button" className="icon-button" aria-label="Cerrar" disabled={loading} onClick={handleCancel}>
            <svg className="icon"><use href="#i-close" /></svg>
          </button>
        </div>
        <p className="form-error" id="recovery-error" role="alert" hidden={!error && !recError}>{error || recError}</p>
        <button type="button" className="button secondary reconnect" hidden={!sessionLost} onClick={onReconnect}>Reconectar Google Drive</button>
        <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
          {loading ? (
            <p className="list-status" role="status">Cargando estudios recuperables…</p>
          ) : deletedStudies.length === 0 ? (
            <div className="empty-state" style={{ padding: '32px 16px', textAlign: 'center' }}>
              <svg className="icon" style={{ width: '48px', height: '48px', margin: '0 auto 16px', color: 'var(--muted)' }}><use href="#i-trash-off" /></svg>
              <h3>No hay estudios recuperables</h3>
              <p style={{ color: 'var(--muted)', marginTop: '8px' }}>Los estudios eliminados hace más de 30 días no se pueden recuperar</p>
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {deletedStudies.map(study => (
                <li key={study.id} style={{ borderBottom: '1px solid var(--edge)', padding: '16px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <h4 style={{ margin: '0 0 4px', fontSize: '1rem' }}>{study.title}</h4>
                    <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.875rem' }}>
                      Fecha: {new Date(study.date).toLocaleDateString('es-AR')} · Eliminado: {new Date(study.deletedAt).toLocaleDateString('es-AR')}
                    </p>
                    {!study.recoverable && (
                      <p style={{ margin: '8px 0 0', color: 'var(--error)', fontSize: '0.875rem' }}>Ventana de recuperación expirada</p>
                    )}
                  </div>
                  {study.recoverable && (
                    <button
                      type="button"
                      className="button primary"
                      style={{ flexShrink: 0 }}
                      onClick={() => handleRecover(study)}
                      disabled={loading}
                    >
                      Recuperar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="button quiet" disabled={loading} onClick={handleCancel}>Cerrar</button>
        </div>
      </form>
    </dialog>
  );
}