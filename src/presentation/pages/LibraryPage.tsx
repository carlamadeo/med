/**
 * Página principal: lista de estudios, filtros, editor y borrado.
 * Orquesta el estado reactivo (store) con los repositorios de Drive.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { getStudyTypes, viewerURL } from '@domain/utils';
import { validatePdf } from '@data/pdf-analysis';
import { Outbox, type OutboxEntry } from '@data/outbox';
import {
  driveAuth,
  driveStudyRepo,
  driveOperationRepo,
  drivePortalRepo,
  DriveConflictError,
  DriveSessionError,
} from '@data';
import {
  isSignedIn,
  studies,
  loading,
  error,
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
  operations,
  portals,
  view,
  categoryTypes,
} from '../state/store';
import type { Study, StudyDraft } from '@domain/models';
import { StudyList } from '../components/StudyList';
import { FilterBar } from '../components/FilterBar';
import { EditorDialog } from '../components/EditorDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState, OnboardingDialog, ThemeToggle } from '../components';
import { Operations } from '../components/Operations';
import { Portals } from '../components/Portals';

const outbox = new Outbox();

export function LibraryPage() {
  const loadSequence = useRef(0);
  const directorySequence = useRef(0);
  const pendingId = useRef('');
  const editorOwner = useRef<Promise<string | null>>(Promise.resolve(null));
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [typesReady, setTypesReady] = useState(false);
  const [bootFailed, setBootFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [sessionLost, setSessionLost] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [directoryWarning, setDirectoryWarning] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<OutboxEntry[]>([]);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => { void getStudyTypes().then((types) => { setAvailableTypes(types); setTypesReady(true); }).catch(() => setBootFailed(true)); }, []);

  // ------------------------------------------------------------------
  // Auth
  // ------------------------------------------------------------------

  useEffect(() => {
    const unsub = driveAuth.onAuthChange((signedIn) => {
      directorySequence.current += 1;
      if (!signedIn && (isEditorOpen.value || deletingStudyId.value)) {
        loadSequence.current += 1;
        setStudies([]);
        operations.value = [];
        portals.value = [];
        setPendingChanges([]);
        setSessionLost(true);
        return;
      }
      setIsSignedIn(signedIn);
      if (signedIn) {
        setSessionLost(false);
        setEditorError(null);
        void loadStudies();
        void loadDirectories();
        void prepareOutbox();
      } else if (!isEditorOpen.value && !deletingStudyId.value) {
        loadSequence.current += 1;
        setStudies([]);
        operations.value = [];
        portals.value = [];
        setDirectoryWarning(false);
        setPendingChanges([]);
        setSyncMessage('');
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
    const online = () => { setOffline(false); if (driveAuth.isSignedIn()) { void prepareOutbox(); void loadStudies(true); void loadDirectories(); } };
    const disconnected = () => setOffline(true);
    const outboxChanged = () => { if (driveAuth.isSignedIn()) void prepareOutbox(); };
    window.addEventListener('online', online);
    window.addEventListener('offline', disconnected);
    window.addEventListener('mis-estudios-outbox-changed', outboxChanged);
    return () => { document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', online); window.removeEventListener('offline', disconnected); window.removeEventListener('mis-estudios-outbox-changed', outboxChanged); };
  }, []);

  async function loadDirectories(): Promise<void> {
    const sequence = ++directorySequence.current;
    const [operationResult, portalResult] = await Promise.allSettled([driveOperationRepo.list(), drivePortalRepo.list()]);
    if (sequence !== directorySequence.current || !driveAuth.isSignedIn()) return;
    if (operationResult.status === 'fulfilled') operations.value = operationResult.value;
    if (portalResult.status === 'fulfilled') portals.value = portalResult.value;
    setDirectoryWarning(operationResult.status === 'rejected' || portalResult.status === 'rejected');
  }

  async function prepareOutbox(): Promise<void> {
    try {
      const token = await driveAuth.getAccessToken();
      let owner = driveAuth.cachedAccountId();
      if (navigator.onLine) {
        try { owner = await driveAuth.getAccountId(); }
        catch (err) { if (!owner) throw err; }
      }
      if (!owner) return;
      const pending = await outbox.list(owner);
      if (await driveAuth.getAccessToken() !== token) return;
      setPendingChanges(pending);
      if (navigator.onLine && pending.length) await syncOutbox(owner);
    } catch { setSyncMessage('No se pudo verificar la cuenta para sincronizar los cambios pendientes.'); }
  }

  async function discardPending(entry: OutboxEntry): Promise<void> {
    const owner = driveAuth.cachedAccountId();
    if (!owner || entry.id === undefined || !navigator.locks) { setSyncMessage('Este navegador no puede modificar la cola de forma segura.'); return; }
    if (!window.confirm(entry.attachment ? '¿Descartar este cambio pendiente y el PDF guardado en este dispositivo?' : '¿Descartar este cambio pendiente?')) return;
    const token = await driveAuth.getAccessToken();
    await navigator.locks.request(`mis-estudios-outbox:${owner}`, async () => {
      if (await driveAuth.getAccessToken() !== token || driveAuth.cachedAccountId() !== owner) throw new DriveSessionError();
      await outbox.discard(owner, entry.id!);
    });
    if (await driveAuth.getAccessToken() === token) { setPendingChanges(await outbox.list(owner)); setSyncMessage(''); }
  }

  async function syncOutbox(owner: string): Promise<void> {
    if (!navigator.locks) { setSyncMessage('Este navegador no puede sincronizar cambios pendientes de forma segura.'); return; }
    const token = await driveAuth.getAccessToken();
    const assertToken = async () => { if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError(); };
    setSyncing(true); setSyncMessage('');
    try {
      await outbox.sync(owner, {
        accountId: async () => { await assertToken(); const id = await driveAuth.getAccountId(); await assertToken(); return id; },
        reserveId: async () => { await assertToken(); const id = await driveStudyRepo.reserveId(); await assertToken(); return id; },
        save: async (draft) => { await assertToken(); await driveStudyRepo.save(draft); await assertToken(); },
        delete: async (id, revision) => { await assertToken(); await driveStudyRepo.delete(id, revision); await assertToken(); },
        saveOperation: async (draft) => { await assertToken(); await driveOperationRepo.save(draft); await assertToken(); },
        deleteOperation: async (id, revision) => { await assertToken(); await driveOperationRepo.delete(id, revision); await assertToken(); },
        savePortal: async (draft) => { await assertToken(); await drivePortalRepo.save(draft); await assertToken(); },
        deletePortal: async (portal) => { await assertToken(); await drivePortalRepo.delete(portal); await assertToken(); },
        lock: async (name, callback) => { await navigator.locks.request(name, callback); },
      });
      await assertToken();
      const remaining = await outbox.list(owner);
      setPendingChanges(remaining);
      if (remaining.some((entry) => entry.status === 'conflict')) setSyncMessage('Un estudio cambió en Drive. Revisá el cambio pendiente antes de continuar.');
      else if (remaining.length) setSyncMessage('Hay cambios pendientes que no se pudieron sincronizar.');
      await loadStudies(true);
      await loadDirectories();
    } catch { setSyncMessage('No se pudieron sincronizar los cambios pendientes.'); }
    finally { setSyncing(false); }
  }

  function openEditor(study: Study | null) {
    pendingId.current = '';
    const owner = driveAuth.cachedAccountId();
    editorOwner.current = owner ? Promise.resolve(owner) : driveAuth.getAccountId().catch(() => null);
    setEditorError(null);
    setSessionLost(false);
    setEditingStudy(study);
  }

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!isSignedIn.value || !typesReady || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey ||
          document.querySelector('dialog[open]')) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (event.key === 'Escape') {
        clearFilters();
      } else if (event.key === '/') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('#search')?.focus();
      } else if (event.key.toLowerCase() === 'n' && !event.repeat) {
        event.preventDefault();
        openEditor(null);
      }
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, [typesReady]);

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


  async function verifyEditorOwner(): Promise<void> {
    const owner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
    const original = await editorOwner.current;
    if (!original || original !== owner) throw new Error('Este borrador pertenece a otra cuenta o no se pudo verificar su cuenta original. Reconectá la cuenta con la que lo abriste.');
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
      await verifyEditorOwner();
      const pendingOwner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
      const pending = pendingOwner ? await outbox.list(pendingOwner) : [];
      if (draft.driveFileId && pending.some((item) => item.studyId === draft.driveFileId)) throw new Error('Este estudio ya tiene un cambio pendiente.');
      if (draft.operationId && pending.some((item) => item.kind === 'operation-delete' && item.operationId === draft.operationId)) throw new Error('La operación tiene una eliminación pendiente.');
      if (!navigator.onLine) {
        if (!navigator.locks) throw new Error('Este navegador no admite la sincronización segura sin conexión.');
        const owner = driveAuth.cachedAccountId();
        if (!owner) throw new Error('Conectate primero para verificar tu cuenta antes de guardar sin conexión.');
        await outbox.enqueueSave(owner, draft);
        setPendingChanges(await outbox.list(owner));
        setEditorOpen(false);
        return;
      }
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
      const pendingOwner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
      if (pendingOwner && (await outbox.list(pendingOwner)).some((item) => item.studyId === study.id)) throw new Error('Este estudio ya tiene un cambio pendiente.');
      if (!navigator.onLine) {
        if (!navigator.locks) throw new Error('Este navegador no admite la sincronización segura sin conexión.');
        const owner = driveAuth.cachedAccountId();
        if (!owner) throw new Error('Conectate primero para verificar tu cuenta antes de guardar sin conexión.');
        await outbox.enqueueDelete(owner, study.id, study.revision);
        setPendingChanges(await outbox.list(owner));
        setDeletingStudyId(null);
        return;
      }
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

  const hasFilters = Boolean(categoryTypes.value.length || filters.value.query || filters.value.type || filters.value.from || filters.value.to || filters.value.operationId || filters.value.portal || filters.value.onlyPdf || filters.value.onlyViewer);
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

          <section id="library" aria-label="Biblioteca" className="library" hidden={!isSignedIn.value}>
            {offline && <p className="offline-notice" role="status">Sin conexión: estás viendo la última copia disponible en este dispositivo.</p>}
            {(pendingChanges.length > 0 || syncMessage) && <section id="pending-changes" className="pending-changes" aria-label="Cambios pendientes">
              <h2>Cambios pendientes ({pendingChanges.length})</h2>
              <p role="status">{syncMessage || 'Se enviarán a Drive al recuperar la conexión.'}</p>
              <ul>{pendingChanges.map((entry) => <li key={entry.id}>{entry.kind === 'delete' ? `Eliminar ${studies.value.find((s) => s.id === entry.studyId)?.title ?? 'estudio'}` : entry.kind === 'operation-delete' ? `Eliminar ${operations.value.find((op) => op.id === entry.operationId)?.name ?? 'operación'}` : entry.kind === 'portal-delete' ? `Eliminar ${entry.portal?.displayName ?? 'portal'}` : entry.draft?.title ?? entry.operationDraft?.name ?? entry.portalDraft?.displayName}{entry.status === 'conflict' ? ' · requiere revisión' : ''}
                {entry.draft && <span> · {entry.draft.date} · {entry.draft.types.join(', ')} · {entry.draft.doctor}</span>}
                {entry.lastError && <p>{entry.lastError}</p>}
                {entry.draft && <details><summary>Ver datos pendientes</summary>
                  <p>Portal: {entry.draft.portal || '—'}</p><p>Visor: {entry.draft.viewer || '—'}</p>
                  <p>Operación: {operations.value.find((item) => item.id === entry.draft?.operationId)?.name ?? (entry.draft.operationId || '—')}</p>
                  <p>PDF: {entry.attachmentName || (entry.draft.removeReport ? 'Se quitará el PDF' : 'Sin cambio')}</p>
                </details>}
                {entry.operationDraft && <details><summary>Ver datos pendientes</summary><p>Fecha: {entry.operationDraft.date || '—'}</p><p>Cirujano: {entry.operationDraft.surgeon || '—'}</p><p>Institución: {entry.operationDraft.institution || '—'}</p><p>Intervención: {entry.operationDraft.type || '—'}</p><p>Notas: {entry.operationDraft.notes || '—'}</p></details>}
                {entry.portalDraft && <details><summary>Ver datos pendientes</summary><p>Enlace: {entry.portalDraft.url || '—'}</p><p>Notas: {entry.portalDraft.notes || '—'}</p></details>}
                <button type="button" className="button quiet" disabled={syncing} onClick={() => { void discardPending(entry).catch(() => setSyncMessage('No se pudo descartar el cambio pendiente.')); }}>Descartar</button>
              </li>)}</ul>
              {navigator.onLine && <button type="button" className="button secondary" disabled={syncing} onClick={() => void prepareOutbox()}>Reintentar sincronización</button>}
            </section>}
            {directoryWarning && <p id="directory-warning" role="status">No se pudieron actualizar las operaciones y portales. Se volverá a intentar al recuperar la conexión.</p>}
            <nav className="view-nav" aria-label="Vistas de la biblioteca">
              <button type="button" id="tab-cronologia" aria-pressed={view.value === 'cronologia'} onClick={() => { view.value = 'cronologia'; }}>Cronología</button>
              <button type="button" id="tab-categoria" aria-pressed={view.value === 'categoria'} onClick={() => { view.value = 'categoria'; }}>Categoría</button>
              <button type="button" id="tab-portales" aria-pressed={view.value === 'portales'} onClick={() => { view.value = 'portales'; }}>Portales</button>
              <button type="button" id="tab-operaciones" aria-pressed={view.value === 'operaciones'} onClick={() => { view.value = 'operaciones'; }}>Operaciones</button>
            </nav>
            {view.value === 'operaciones' ? <Operations /> : view.value === 'portales' ? <Portals /> : <>
            {view.value === 'categoria' && <div id="categories" aria-label="Categorías">{availableTypes.map((type) => <button type="button" key={type} aria-pressed={categoryTypes.value.includes(type)} onClick={() => { filters.value = { ...filters.value, type: '' }; categoryTypes.value = categoryTypes.value.includes(type) ? categoryTypes.value.filter((item) => item !== type) : [...categoryTypes.value, type]; }}>{type}</button>)}</div>}
            <div className="section-head">
              <div className="section-title">
                <h2 id="library-title">Estudios guardados</h2>
                <span id="count" className="count">{studies.value.length}</span>
              </div>
              <FilterBar
                availableTypes={availableTypes}
                onClear={() => {
                  clearFilters();
                }}
                onSearch={(query) => {
                  filters.value = { ...filters.value, query };
                }}
              />
            </div>

            {loading.value ? (
              <>
                <p id="list-status" className="list-status" role="status">Cargando tus estudios…</p>
                <ul className="results skeleton-list" aria-hidden="true">{[0, 1, 2].map((item) => <li className="record skeleton-card" key={item}>
                  <div className="record-main"><div className="skeleton skeleton-icon" /><div className="record-text"><div className="skeleton skeleton-title" /><div className="skeleton skeleton-subtitle" /></div><div className="skeleton skeleton-badge" /></div>
                  <div className="record-controls"><div className="skeleton skeleton-link" /><div className="skeleton skeleton-action" /></div>
                </li>)}</ul>
              </>
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
                title={pendingChanges.some((entry) => entry.kind === 'save' && !entry.studyId) ? 'Tu estudio está pendiente' : 'Tu archivo empieza acá'}
                description={pendingChanges.some((entry) => entry.kind === 'save' && !entry.studyId) ? 'Aparecerá en la biblioteca cuando se sincronice con Drive.' : 'Agregá tu primer estudio con su informe en PDF, el enlace al visor o ambos.'}
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
            </>}
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
        verifyOwner={verifyEditorOwner}
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
