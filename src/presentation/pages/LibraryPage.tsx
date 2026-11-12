/**
 * Página principal: lista de estudios, filtros, editor y borrado.
 * Orquesta el estado reactivo (store) con los repositorios de Drive.
 */
import { useEffect, useRef } from 'preact/hooks';
import {
  driveAuth,
  driveStudyRepo,
  DriveConflictError,
  DriveSessionError,
} from '@data';
import {
  isSignedIn,
  studies,
  loading,
  error,
  editingStudy,
  deletingStudyId,
  setStudies,
  setLoading,
  setError,
  setIsSignedIn,
  filters,
  setEditingStudy,
  setDeletingStudyId,
} from '../state/store';
import type { Study } from '@domain/models';
import { StudyList } from '../components/StudyList';
import { FilterBar } from '../components/FilterBar';
import { EditorDialog } from '../components/EditorDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState, OnboardingDialog, ThemeToggle } from '../components';

export function LibraryPage() {
  const loadSequence = useRef(0);

  // ------------------------------------------------------------------
  // Auth
  // ------------------------------------------------------------------

  useEffect(() => {
    const unsub = driveAuth.onAuthChange((signedIn) => {
      setIsSignedIn(signedIn);
      if (signedIn) {
        void loadStudies();
      } else if (!editingStudy.value && !deletingStudyId.value) {
        setStudies([]);
        setLoading(false);
      }
    });
    if (driveAuth.configured) {
      driveAuth.restoreSession();
    }
    return () => unsub();
  }, []);

  // ------------------------------------------------------------------
  // List
  // ------------------------------------------------------------------

  async function loadStudies(force = false): Promise<void> {
    if (!isSignedIn.value) return;
    const seq = ++loadSequence.current;
    setLoading(true);
    error.value = null;
    try {
      const list = await driveStudyRepo.list({ force });
      if (seq !== loadSequence.current) return;
      setStudies(list);
    } catch (err) {
      if (seq !== loadSequence.current) return;
      if (err instanceof DriveSessionError && !editingStudy.value && !deletingStudyId.value) {
        setIsSignedIn(false);
        return;
      }
      setError(err instanceof Error ? err.message : 'No se pudo abrir el archivo.');
    } finally {
      setLoading(false);
    }
  }


  async function deleteStudyById(studyId: string): Promise<void> {
    const study = studies.value.find((s) => s.id === studyId);
    if (!study) return;
    try {
      await driveStudyRepo.delete(study.id, study.revision);
      loadSequence.current += 1;
      setStudies(studies.value.filter((s) => s.id !== studyId));
      setDeletingStudyId(null);
      await loadStudies();
    } catch (err) {
      if (err instanceof DriveConflictError) {
        void loadStudies();
      }
      setError(err instanceof Error ? err.message : 'No se pudo eliminar.');
    }
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <>
      <header className="top">
        <div className="wrap top-inner">
          <a className="brand" href="#main" aria-label="Mis estudios, inicio">
            <span className="file-icon" aria-hidden="true"><svg className="icon"><use href="#i-file" /></svg></span>
            <span>Mis estudios</span>
          </a>
          <div className="top-actions">
            <span className="private"><svg className="icon" aria-hidden="true"><use href="#i-lock" /></svg> Privado</span>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="wrap" id="main" role="main">
      {!isSignedIn.value ? (
        <>
          <section className="intro" aria-labelledby="page-title">
            <div>
              <p className="eyebrow">MI ARCHIVO MÉDICO</p>
              <h1 id="page-title">Mis estudios</h1>
              <p className="lead">
                Tus informes y enlaces a visores, ordenados por fecha y tipo de estudio.
              </p>
            </div>
            <button
              className="button primary"
              data-add
              type="button"
              onClick={() => setEditingStudy(null)}
            >
              <svg className="icon"><use href="#i-plus" /></svg> Agregar estudio
            </button>
          </section>

          <section id="library" aria-labelledby="library-title" className="library">
            <div className="section-head">
              <div className="section-title">
                <h2 id="library-title">Estudios guardados</h2>
                <span className="count">{studies.value.length}</span>
              </div>
              <FilterBar
                onClear={() => {
                  filters.value = {
                    query: '',
                    type: '',
                    from: '',
                    to: '',
                    operationId: '',
                    portal: '',
                    onlyPdf: false,
                    onlyViewer: false,
                  };
                }}
                onSearch={(query) => {
                  filters.value = { ...filters.value, query };
                }}
              />
            </div>

            {loading.value ? (
              <p id="list-status" className="list-status" role="status">
                Cargando tus estudios…
              </p>
            ) : error.value ? (
              <div id="load-error" className="empty">
                <h3>No se pudo abrir el archivo</h3>
                <p id="load-error-message">{error.value}</p>
                <button
                  className="button secondary"
                  id="retry"
                  type="button"
                  onClick={() => void loadStudies()}
                >
                  Reintentar
                </button>
              </div>
            ) : studies.value.length === 0 ? (
              <EmptyState
                variant="no-studies"
                title="Tu archivo empieza acá"
                description="Agregá tu primer estudio con su informe en PDF, el enlace al visor o ambos."
                action={<button
                  className="button secondary"
                  id="empty-action"
                  type="button"
                  onClick={() => setEditingStudy(null)}
                >
                  <svg className="icon"><use href="#i-plus" /></svg> Agregar estudio
                </button>}
              />
            ) : (
              <StudyList
                onEdit={setEditingStudy}
                onDelete={(study: Study) => setDeletingStudyId(study.id)}
              />
            )}
          </section>
        </>
      ) : (
        <section id="access" className="library access" aria-labelledby="access-title">
          <span className="file-icon">
            <svg className="icon" aria-hidden="true"><use href="#i-lock" /></svg>
          </span>
          <h2 id="access-title">Abrí tu archivo</h2>
          <p id="access-copy">
            Conectá Google Drive para consultar y guardar tus estudios desde cualquier dispositivo.
          </p>
          <button
            className="button primary"
            id="connect"
            type="button"
            disabled={!driveAuth.configured}
            onClick={() => void driveAuth.signIn()}
          >
            Conectar Google Drive
          </button>
          {error.value && (
            <p id="access-error" className="form-error" role="alert">
              {error.value}
            </p>
          )}
          {!driveAuth.configured && (
            <p className="form-error" role="alert">
              Para abrir el archivo, primero hay que configurar el acceso a Google Drive.
            </p>
          )}
        </section>
      )}

      <EditorDialog
        onClose={() => setEditingStudy(null)}
        error={error.value}
        busy={loading.value}
      />

      <ConfirmDialog
        studies={studies.value}
        onConfirm={deleteStudyById}
        onCancel={() => setDeletingStudyId(null)}
        onReconnect={() => void driveAuth.signIn()}
        error={error.value}
        busy={loading.value}
      />
      </main>
      <OnboardingDialog />
    </>
  );
}