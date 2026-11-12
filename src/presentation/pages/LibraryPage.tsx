/**
 * Página principal: lista de estudios, filtros, editor y borrado.
 * Orquesta el estado reactivo (store) con los repositorios de Drive.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { getStudyTypes, viewerURL } from '@domain/utils';
import { validatePdf } from '@data/pdf-analysis';
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
  clearFilters,
  filteredStudies,
  isEditorOpen,
  setEditingStudy,
  setEditorOpen,
  setDeletingStudyId,
} from '../state/store';
import type { Study, StudyDraft } from '@domain/models';
import { StudyList } from '../components/StudyList';
import { FilterBar } from '../components/FilterBar';
import { EditorDialog } from '../components/EditorDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState, OnboardingDialog, ThemeToggle } from '../components';

export function LibraryPage() {
  const loadSequence = useRef(0);
  const pendingId = useRef('');
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [typesReady, setTypesReady] = useState(false);
  const [bootFailed, setBootFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [sessionLost, setSessionLost] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => { void getStudyTypes().then((types) => { setAvailableTypes(types); setTypesReady(true); }).catch(() => setBootFailed(true)); }, []);

  // ------------------------------------------------------------------
  // Auth
  // ------------------------------------------------------------------

  useEffect(() => {
    const unsub = driveAuth.onAuthChange((signedIn) => {
      if (!signedIn && (isEditorOpen.value || deletingStudyId.value)) { setSessionLost(true); return; }
      setIsSignedIn(signedIn);
      if (signedIn) {
        setSessionLost(false);
        setEditorError(null);
        void loadStudies();
      } else if (!isEditorOpen.value && !deletingStudyId.value) {
        loadSequence.current += 1;
        setStudies([]);
        setLoading(false);
      }
    });
    if (driveAuth.configured) {
      driveAuth.restoreSession();
    }
    return () => unsub();
  }, []);

  useEffect(() => {
    const refresh = () => {
      if (!document.hidden && driveAuth.isSignedIn() && !isEditorOpen.value && !deletingStudyId.value) void loadStudies(true);
    };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, []);

  function openEditor(study: Study | null) {
    pendingId.current = '';
    setEditorError(null);
    setSessionLost(false);
    setEditingStudy(study);
  }

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
      if (err instanceof DriveSessionError && !isEditorOpen.value && !deletingStudyId.value) {
        setIsSignedIn(false);
        return;
      }
      setError(err instanceof Error ? err.message : 'No se pudo abrir el archivo.');
    } finally {
      if (seq === loadSequence.current) setLoading(false);
    }
  }


  async function saveStudy(draft: StudyDraft): Promise<void> {
    if (saving) return;
    setSaving(true);
    setEditorError(null);
    try {
      if (!draft.title) throw new Error('Ingresá un nombre para el estudio.');
      if (!draft.types.length) throw new Error('Elegí al menos un tipo de estudio.');
      try { draft.viewer = viewerURL(draft.viewer); }
      catch { throw new Error('Pegá un enlace al visor que empiece con https:// o http://.'); }
      if (draft.file) await validatePdf(draft.file);
      if (!draft.driveFileId) {
        pendingId.current ||= await driveStudyRepo.reserveId();
        draft.id = pendingId.current;
      }
      const saved = await driveStudyRepo.save(draft);
      loadSequence.current += 1;
      setStudies([...studies.value.filter((item) => item.id !== saved.id), saved]);
      if (!draft.driveFileId) clearFilters();
      pendingId.current = '';
      setEditorOpen(false);
      await loadStudies(true);
    } catch (err) {
      if (err instanceof DriveSessionError) setSessionLost(true);
      setEditorError(err instanceof Error ? err.message : 'No se pudo guardar el estudio.');
      if (err instanceof DriveConflictError) void loadStudies(true);
    } finally { setSaving(false); }
  }

  async function deleteStudyById(studyId: string): Promise<void> {
    const study = studies.value.find((s) => s.id === studyId);
    if (!study) return;
    setDeleting(true);
    setError(null);
    try {
      await driveStudyRepo.delete(study.id, study.revision);
      loadSequence.current += 1;
      setStudies(studies.value.filter((s) => s.id !== studyId));
      setDeletingStudyId(null);
      await loadStudies(true);
    } catch (err) {
      if (err instanceof DriveConflictError) void loadStudies(true);
      if (err instanceof DriveSessionError) setSessionLost(true);
      setError(err instanceof Error ? err.message : 'No se pudo eliminar.');
    } finally { setDeleting(false); }
  }

  const hasFilters = Boolean(filters.value.query || filters.value.type || filters.value.from || filters.value.to || filters.value.operationId || filters.value.portal || filters.value.onlyPdf || filters.value.onlyViewer);
  const invalidRange = Boolean(filters.value.from && filters.value.to && filters.value.from > filters.value.to);

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
            <button id="signout" type="button" className="text-button" hidden={!isSignedIn.value} onClick={() => void driveAuth.signOut()}>Salir</button>
            <span className="private"><svg className="icon" aria-hidden="true"><use href="#i-lock" /></svg> Privado</span>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="wrap" id="main" role="main">
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
              hidden={!isSignedIn.value}
              disabled={!typesReady}
              type="button"
              onClick={() => openEditor(null)}
            >
              <svg className="icon"><use href="#i-plus" /></svg> Agregar estudio
            </button>
          </section>

          <section id="library" aria-labelledby="library-title" className="library" hidden={!isSignedIn.value}>
            <div className="section-head">
              <div className="section-title">
                <h2 id="library-title">Estudios guardados</h2>
                <span id="count" className="count">{studies.value.length}</span>
              </div>
              <FilterBar
                availableTypes={availableTypes}
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
            ) : studies.value.length > 0 && hasFilters && filteredStudies.value.length === 0 ? (
              <EmptyState variant="no-results" title={invalidRange ? 'La fecha «Hasta» debe ser igual o posterior a «Desde».' : 'No hay estudios con esos filtros'}
                description="Probá con otras fechas, otro tipo de estudio o una búsqueda distinta."
                action={<button id="empty-action" className="button secondary" type="button" onClick={clearFilters}>Limpiar filtros</button>} />
            ) : studies.value.length === 0 ? (
              <EmptyState
                variant="no-studies"
                title="Tu archivo empieza acá"
                description="Agregá tu primer estudio con su informe en PDF, el enlace al visor o ambos."
                action={<button
                  className="button secondary"
                  id="empty-action"
                  disabled={!typesReady}
                  type="button"
                  onClick={() => openEditor(null)}
                >
                  <svg className="icon"><use href="#i-plus" /></svg> Agregar estudio
                </button>}
              />
            ) : (
              <>
                {hasFilters && <p id="list-status" role="status">{filteredStudies.value.length} {filteredStudies.value.length === 1 ? 'estudio encontrado' : 'estudios encontrados'}</p>}
                <StudyList onEdit={openEditor} onDelete={(study: Study) => setDeletingStudyId(study.id)} />
              </>
            )}
          </section>
        <section id="access" className="library access" aria-labelledby="access-title" hidden={isSignedIn.value}>
          <span className="file-icon">
            <svg className="icon" aria-hidden="true"><use href="#i-lock" /></svg>
          </span>
          <h2 id="access-title">Abrí tu archivo</h2>
          <p id="access-copy">
            {bootFailed ? 'No se pudo cargar la página. Actualizala para volver a intentar.' : 'Conectá Google Drive para consultar y guardar tus estudios desde cualquier dispositivo.'}
          </p>
          <button
            className="button primary"
            id="connect"
            type="button"
            disabled={!driveAuth.configured || bootFailed}
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

      <EditorDialog
        onClose={() => setEditorOpen(false)}
        error={editorError}
        busy={saving}
        availableTypes={availableTypes}
        onSave={saveStudy}
        sessionLost={sessionLost}
        onReconnect={() => void driveAuth.signIn()}
      />

      <ConfirmDialog
        studies={studies.value}
        onConfirm={deleteStudyById}
        onCancel={() => setDeletingStudyId(null)}
        onReconnect={() => void driveAuth.signIn()}
        error={error.value}
        busy={deleting}
        sessionLost={sessionLost}
      />
      </main>
      <OnboardingDialog />
    </>
  );
}