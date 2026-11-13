import { useEffect, useRef, useState } from 'preact/hooks';
import { recoveringStudyId, recoveryError, setRecoveringStudyId, setRecoveryError, setStudies, studies, pendingChanges } from '../state/store';
import { useFocusTrap } from '../utils/focusTrap';
import { driveAuth, driveStudyRepo } from '@data';
import { Outbox } from '@data/outbox';

const outbox = new Outbox();

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
  revision: string;
}

export function RecoveryDialog({ onReconnect, error, sessionLost }: RecoveryDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestGeneration = useRef(0);
  const recoveringId = recoveringStudyId.value;
  const recError = recoveryError.value;

  const [deletedStudies, setDeletedStudies] = useState<DeletedStudy[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusTrap(dialogRef, !!recoveringId);

  useEffect(() => driveAuth.onAuthChange((signedIn) => {
    if (!signedIn) {
      requestGeneration.current += 1;
      setDeletedStudies([]);
      setRecoveringStudyId(null);
      setRecoveryError(null);
    }
  }), []);

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
    const generation = ++requestGeneration.current;
    setLoading(true);
    setRecoveryError(null);
    try {
      const token = await driveAuth.getAccessToken();
      const data = await driveStudyRepo.listDeleted();
      if (generation !== requestGeneration.current || await driveAuth.getAccessToken() !== token) return;
      setDeletedStudies(data);
    } catch (err) {
      if (generation === requestGeneration.current) {
        setDeletedStudies([]);
        setRecoveryError(err instanceof Error ? err.message : 'No se pudieron consultar los estudios eliminados.');
      }
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }

  const handleClose = () => {
    requestGeneration.current += 1;
    dialogRef.current?.close();
    setDeletedStudies([]);
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
      setLoading(true);
      const token = await driveAuth.getAccessToken();
      if (!navigator.onLine) {
        const owner = driveAuth.cachedAccountId();
        if (!owner || !navigator.locks) throw new Error('Se necesita una cuenta verificada y un navegador compatible para recuperar sin conexión.');
        await navigator.locks.request(`mis-estudios-outbox:${owner}`, async () => {
          if (await driveAuth.getAccessToken() !== token || driveAuth.cachedAccountId() !== owner) throw new Error('La cuenta cambió. Volvé a intentar.');
          await outbox.enqueueRestore(owner, study.id, study.revision);
        });
        if (await driveAuth.getAccessToken() !== token) return;
        pendingChanges.value = await outbox.list(owner);
        window.dispatchEvent(new Event('mis-estudios-outbox-changed'));
        return;
      }
      const recovered = await driveStudyRepo.restore(study.id, study.revision);
      if (await driveAuth.getAccessToken() !== token) return;
      setStudies([...studies.value, recovered]);
      setDeletedStudies(deletedStudies.filter(s => s.id !== study.id));
    } catch (err) {
      setRecoveryError(err instanceof Error ? err.message : 'Error de red al recuperar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <dialog id="recovery" ref={dialogRef} className="dialog" aria-labelledby="recovery-title" data-busy={String(loading)}
      onCancel={(event) => { if (loading) event.preventDefault(); else handleCancel(); }}>
      <form id="recovery-form" onSubmit={(event) => { event.preventDefault(); }}>
        <div className="dialog-heading">
          <div><h2 id="recovery-title">Recuperar estudios eliminados</h2>
            <p id="recovery-copy">Recuperá estudios eliminados desde la aplicación durante los últimos 30 días. Sin conexión se usa la última lista consultada.</p>
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
          ) : recError ? null : deletedStudies.length === 0 ? (
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
                      Fecha: {study.date} · Eliminado: {study.deletedAt ? new Date(study.deletedAt).toLocaleDateString('es-AR') : 'fecha desconocida'}
                    </p>
                    {!study.recoverable && (
                      <p style={{ margin: '8px 0 0', color: 'var(--error)', fontSize: '0.875rem' }}>Consultá la papelera de Google Drive para este estudio.</p>
                    )}
                  </div>
                  {pendingChanges.value.some(entry => entry.kind === 'restore' && entry.studyId === study.id) ? (
                    <p role="status">Recuperación pendiente de sincronización</p>
                  ) : study.recoverable && (
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
        <p><a href="https://drive.google.com/drive/trash" target="_blank" rel="noopener noreferrer">Abrir papelera de Google Drive</a></p>
        <div className="dialog-actions">
          <button type="button" className="button quiet" disabled={loading} onClick={handleCancel}>Cerrar</button>
        </div>
      </form>
    </dialog>
  );
}
