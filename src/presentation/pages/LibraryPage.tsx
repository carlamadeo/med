/**
 * Página principal: lista de estudios, filtros, editor y borrado.
 * Orquesta el estado reactivo (store) con los repositorios de Drive.
 */
import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { getStudyTypes, isValidStudyDate, viewerURL } from '@domain/utils';
import { validatePdf } from '@data/pdf-analysis';
import { Outbox, type OutboxEntry } from '@data/outbox';
import {
  driveAuth,
  driveStudyRepo,
  driveOperationRepo,
  drivePortalRepo,
  driveMedicalEventRepo,
  DriveSessionError,
} from '@data';
import {
  isSignedIn,
  studies,
  error,
  deletingStudyId,
  setStudies,
  setLoading,
  setError,
  setIsSignedIn,
  filters,
  clearFilters,
  isEditorOpen,
  setEditingStudy,
  setEditorOpen,
  setDeletingStudyId,
  setSharingStudyId,
  operations,
  portals,
  medicalEvents,
  pendingChanges,
  syncMessage,
  syncing,
  offline,
  setOffline,
  directoryWarning,
} from '../state/store';
import type { Study, StudyDraft } from '@domain/models';
import {
  EditorDialog,
  ConfirmDialog,
  OnboardingDialog,
  PendingChangesSection,
  LibraryHeader,
  StudyListContainer,
  AccessSection,
  LibraryIntro,
  ShareDialog,
} from '../components';
import { handleDriveError } from '../utils/driveErrorHandler';

const outbox = new Outbox();

export function LibraryPage() {
  const pendingId = useRef('');
  const activeSyncs = useRef(0);
  const editorOwner = useRef<Promise<string | null>>(Promise.resolve(null));
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [typesReady, setTypesReady] = useState(false);
  const [bootFailed, setBootFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [sessionLost, setSessionLost] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Load study types on mount
  useEffect(() => {
    void getStudyTypes().then((types) => {
      setAvailableTypes(types);
      setTypesReady(true);
    }).catch(() => setBootFailed(true));
  }, []);

  // Auth listener
  useEffect(() => {
    let authSequence = 0;
    const unsub = driveAuth.onAuthChange((signedIn) => {
      const sequence = ++authSequence;
      if (!signedIn) {
        setIsSignedIn(false);
        loadSequence.current += 1;
        directorySequence.current += 1;
        pendingChanges.value = [];
        syncMessage.value = '';
      }
      if (!signedIn && (isEditorOpen.value || deletingStudyId.value)) {
        setStudies([]);
        operations.value = [];
        portals.value = [];
        medicalEvents.value = [];
        setSessionLost(true);
        return;
      }
      if (signedIn) {
        void (async () => {
          try {
            const token = await driveAuth.getAccessToken();
            let owner = driveAuth.cachedAccountId();
            if (navigator.onLine) {
              try { owner = await driveAuth.getAccountId(); }
              catch (err) { if (!owner) throw err; }
            }
            if (!owner) throw new Error('No se pudo verificar la cuenta de Google Drive. Conectate y volvé a intentar.');
            const originalEditorOwner = isEditorOpen.value ? await editorOwner.current : null;
            if (sequence !== authSequence || await driveAuth.getAccessToken() !== token) return;
            if (isEditorOpen.value && originalEditorOwner !== owner) setEditorOpen(false);
            setIsSignedIn(true);
            setSessionLost(false);
            setEditorError(null);
            void loadStudies();
            void loadDirectories();
            void prepareOutbox();
          } catch (err) {
            if (sequence !== authSequence) return;
            await driveAuth.signOut();
            setError(err instanceof Error ? err.message : 'No se pudo verificar la cuenta de Google Drive.');
          }
        })();
      } else if (!isEditorOpen.value && !deletingStudyId.value) {
        setStudies([]);
        operations.value = [];
        portals.value = [];
        medicalEvents.value = [];
        setError(null);
        setLoading(false);
      }
    });
    if (driveAuth.configured) {
      driveAuth.restoreSession();
    }
    return () => { authSequence += 1; unsub(); };
  }, []);

  // Global event listeners
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden && isSignedIn.value && driveAuth.isSignedIn() && !isEditorOpen.value && !deletingStudyId.value) void loadStudies(true);
    };
    const online = () => { setOffline(false); if (isSignedIn.value && driveAuth.isSignedIn()) { void prepareOutbox(); void loadStudies(true); void loadDirectories(); } };
    const disconnected = () => setOffline(true);
    const outboxChanged = () => { if (isSignedIn.value && driveAuth.isSignedIn()) void prepareOutbox(); };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', online);
    window.addEventListener('offline', disconnected);
    window.addEventListener('mis-estudios-outbox-changed', outboxChanged);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', disconnected);
      window.removeEventListener('mis-estudios-outbox-changed', outboxChanged);
    };
  }, []);

  // Keyboard shortcuts
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

  // --- Studies ---
  const loadSequence = useRef(0);
  const loadStudies = useCallback(async (force = false) => {
    if (!isSignedIn.value) return;
    const seq = ++loadSequence.current;
    setLoading(true);
    setError(null);
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
  }, []);

  // --- Directories ---
  const directorySequence = useRef(0);
  const loadDirectories = useCallback(async () => {
    if (!isSignedIn.value) return;
    const seq = ++directorySequence.current;
    const [operationResult, portalResult, eventResult] = await Promise.allSettled([
      driveOperationRepo.list(),
      drivePortalRepo.list(),
      driveMedicalEventRepo.list(),
    ]);
    if (seq !== directorySequence.current || !isSignedIn.value) return;
    if (operationResult.status === 'fulfilled') operations.value = operationResult.value;
    if (portalResult.status === 'fulfilled') portals.value = portalResult.value;
    if (eventResult.status === 'fulfilled') medicalEvents.value = eventResult.value;
    directoryWarning.value = operationResult.status === 'rejected' || portalResult.status === 'rejected' || eventResult.status === 'rejected';
  }, []);

  // --- Outbox ---
  const prepareOutbox = useCallback(async () => {
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
      pendingChanges.value = pending;
      if (navigator.onLine && pending.length) await syncOutbox(owner);
    } catch { syncMessage.value = 'No se pudo verificar la cuenta para sincronizar los cambios pendientes.'; }
  }, []);

  const syncOutbox = useCallback(async (owner: string) => {
    if (!navigator.locks) { syncMessage.value = 'Este navegador no puede sincronizar cambios pendientes de forma segura.'; return; }
    const token = await driveAuth.getAccessToken();
    const assertToken = async () => { if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError(); };
    activeSyncs.current += 1;
    syncing.value = true; syncMessage.value = '';
    try {
      await outbox.sync(owner, {
        accountId: async () => { await assertToken(); const id = await driveAuth.getAccountId(); await assertToken(); return id; },
        reserveId: async () => { await assertToken(); const id = await driveStudyRepo.reserveId(); await assertToken(); return id; },
        save: async (draft) => { await assertToken(); await driveStudyRepo.save(draft); await assertToken(); },
        delete: async (id, revision) => { await assertToken(); await driveStudyRepo.delete(id, revision); await assertToken(); },
        saveOperation: async (draft) => { await assertToken(); await driveOperationRepo.save(draft); await assertToken(); },
        deleteOperation: async (id, revision) => { await assertToken(); await driveOperationRepo.delete(id, revision); await assertToken(); },
        savePortal: async (draft) => { await assertToken(); await drivePortalRepo.save(draft); await assertToken(); },
        saveEvent: async (draft) => { await assertToken(); await driveMedicalEventRepo.save(draft); await assertToken(); },
        deletePortal: async (portal) => { await assertToken(); await drivePortalRepo.delete(portal); await assertToken(); },
        lock: async (name, callback) => { await navigator.locks.request(name, callback); },
      });
      await assertToken();
      const remaining = await outbox.list(owner);
      pendingChanges.value = remaining;
      if (remaining.some((entry) => entry.status === 'conflict')) syncMessage.value = 'Un estudio cambió en Drive. Revisá el cambio pendiente antes de continuar.';
      else if (remaining.some((entry) => entry.status === 'failed')) syncMessage.value = 'Hay un cambio que no se puede sincronizar. Revisalo o descartalo para continuar.';
      else if (remaining.length) syncMessage.value = 'Hay cambios pendientes que no se pudieron sincronizar.';
      await loadStudies(true);
      await loadDirectories();
    } catch { syncMessage.value = 'No se pudieron sincronizar los cambios pendientes.'; }
    finally { activeSyncs.current -= 1; syncing.value = activeSyncs.current > 0; }
  }, []);

  const discardPending = useCallback(async (entry: OutboxEntry) => {
    const owner = driveAuth.cachedAccountId();
    if (!owner || entry.id === undefined || !navigator.locks) { syncMessage.value = 'Este navegador no puede modificar la cola de forma segura.'; return; }
    if (!window.confirm(entry.attachment ? '¿Descartar este cambio pendiente y el PDF guardado en este dispositivo?' : '¿Descartar este cambio pendiente?')) return;
    const token = await driveAuth.getAccessToken();
    await navigator.locks.request(`mis-estudios-outbox:${owner}`, async () => {
      if (await driveAuth.getAccessToken() !== token || driveAuth.cachedAccountId() !== owner) throw new DriveSessionError();
      await outbox.discard(owner, entry.id!);
    });
    if (await driveAuth.getAccessToken() === token) {
      pendingChanges.value = await outbox.list(owner);
      syncMessage.value = '';
      if (entry.status === 'conflict' && navigator.onLine) {
        await loadStudies(true);
        await loadDirectories();
      }
    }
  }, []);

  const resolveConflict = useCallback(async (entry: OutboxEntry, reviewedRevision: string) => {
    const owner = driveAuth.cachedAccountId();
    if (!owner || entry.id === undefined || !navigator.locks || !navigator.onLine) {
      syncMessage.value = 'Conectate para revisar la versión actual de Drive.';
      return;
    }
    if (!window.confirm('¿Conservar tu cambio y aplicarlo sobre la versión de Drive que revisaste?')) return;
    try {
      const token = await driveAuth.getAccessToken();
      await navigator.locks.request(`mis-estudios-outbox:${owner}`, async () => {
        if (await driveAuth.getAccessToken() !== token || await driveAuth.getAccountId() !== owner) throw new DriveSessionError();
        let currentRevision: string | undefined;
        if (entry.studyId) {
          const current = await driveStudyRepo.list({ force: true });
          if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
          setStudies(current);
          currentRevision = current.find((item) => item.id === entry.studyId)?.revision;
        } else if (entry.operationId) {
          const current = await driveOperationRepo.list();
          if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
          operations.value = current;
          currentRevision = current.find((item) => item.id === entry.operationId)?.revision;
        } else if (entry.portalId) {
          const current = await drivePortalRepo.list();
          if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
          portals.value = current;
          currentRevision = current.find((item) => item.id === entry.portalId)?.revision;
        } else if (entry.eventId) {
          const current = await driveMedicalEventRepo.list();
          if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
          medicalEvents.value = current;
          currentRevision = current.find((item) => item.id === entry.eventId)?.revision;
        }
        if (!currentRevision || currentRevision !== reviewedRevision) throw new Error('La versión de Drive cambió o ya no está disponible. Revisala nuevamente.');
        await outbox.retryConflict(owner, entry.id!, currentRevision);
      });
      if (await driveAuth.getAccessToken() !== token) return;
      pendingChanges.value = await outbox.list(owner);
      syncMessage.value = '';
      await syncOutbox(owner);
    } catch (err) {
      syncMessage.value = err instanceof Error ? err.message : 'No se pudo resolver el conflicto.';
    }
  }, []);

  async function connectDrive(): Promise<void> {
    setError(null);
    try {
      await driveAuth.signIn();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo conectar Google Drive.';
      setError(message);
      if (isEditorOpen.value) setEditorError(message);
    }
  }

  // --- Editor ---
  function openEditor(study: Study | null) {
    pendingId.current = '';
    const owner = driveAuth.cachedAccountId();
    editorOwner.current = owner ? Promise.resolve(owner) : driveAuth.getAccountId().catch(() => null);
    setEditorError(null);
    setSessionLost(false);
    setEditingStudy(study);
  }

  async function verifyEditorOwner(): Promise<boolean> {
    const owner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
    const original = await editorOwner.current;
    if (!original || original !== owner) { setEditorError('Este borrador pertenece a otra cuenta o no se pudo verificar su cuenta original. Reconectá la cuenta con la que lo abriste.'); return false; }
    return true;
  }

  async function saveStudy(draft: StudyDraft): Promise<void> {
    if (saving) return;
    setSaving(true);
    setEditorError(null);
    try {
      if (!draft.title) { setEditorError('Ingresá un nombre para el estudio.'); setSaving(false); return; }
      if (!isValidStudyDate(draft.date)) { setEditorError('Ingresá una fecha válida que no sea futura.'); setSaving(false); return; }
      if (!draft.types.length) { setEditorError('Elegí al menos un tipo de estudio.'); setSaving(false); return; }
      try { draft.viewer = viewerURL(draft.viewer); }
      catch { setEditorError('Pegá un enlace al visor que empiece con https:// o http://.'); setSaving(false); return; }
      if (draft.file) await validatePdf(draft.file);
      const ownerOk = await verifyEditorOwner();
      if (!ownerOk) { setSaving(false); return; }
      const pendingOwner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
      const pending = pendingOwner ? await outbox.list(pendingOwner) : [];
      if (draft.driveFileId && pending.some((item) => item.studyId === draft.driveFileId)) { setEditorError('Este estudio ya tiene un cambio pendiente.'); setSaving(false); return; }
      if (draft.operationId && pending.some((item) => item.kind === 'operation-delete' && item.operationId === draft.operationId)) { setEditorError('La operación tiene una eliminación pendiente.'); setSaving(false); return; }
      if (!navigator.onLine) {
        if (!navigator.locks) { setEditorError('Este navegador no admite la sincronización segura sin conexión.'); setSaving(false); return; }
        const owner = driveAuth.cachedAccountId();
        if (!owner) { setEditorError('Conectate primero para verificar tu cuenta antes de guardar sin conexión.'); setSaving(false); return; }
        await outbox.enqueueSave(owner, draft);
        pendingChanges.value = await outbox.list(owner);
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
      handleDriveError(err, {
        onSessionLost: () => setSessionLost(true),
        onConflict: () => void loadStudies(true),
        onError: (message) => setEditorError(message),
      });
    } finally { setSaving(false); }
  }

  // --- Delete ---
async function deleteStudyById(studyOrId: Study | string): Promise<void> {
    const studyId = typeof studyOrId === 'string' ? studyOrId : studyOrId.id;
    const study = typeof studyOrId === 'string' ? studies.value.find((s) => s.id === studyId) : studyOrId;

    if (!study) return;
    setDeleting(true);
    setError(null);
    try {
      const pendingOwner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
      if (pendingOwner && (await outbox.list(pendingOwner)).some((item) => item.studyId === studyId)) { setError('Este estudio ya tiene un cambio pendiente.'); setDeleting(false); return; }
      if (!navigator.onLine) {
        if (!navigator.locks) { setError('Este navegador no admite la sincronización segura sin conexión.'); setDeleting(false); return; }
        const owner = driveAuth.cachedAccountId();
        if (!owner) { setError('Conectate primero para verificar tu cuenta antes de guardar sin conexión.'); setDeleting(false); return; }
        await outbox.enqueueDelete(owner, studyId, study.revision);
        pendingChanges.value = await outbox.list(owner);
        setDeletingStudyId(null);
        return;
      }
      await driveStudyRepo.delete(studyId, study.revision);
      loadSequence.current += 1;
      setStudies(studies.value.filter((s) => s.id !== studyId));
      setDeletingStudyId(null);
      await loadStudies(true);
    } catch (err) {
      handleDriveError(err, {
        onSessionLost: () => setSessionLost(true),
        onConflict: () => void loadStudies(true),
        onError: (message) => setError(message),
      });
    } finally { setDeleting(false); }
  }

  function openShare(study: Study): void {
    const hasShareable = study.hasPdf || study.viewer || study.documentIds?.length;
    if (!hasShareable) return;
    setSharingStudyId(study.id);
  }

  return (
    <>
      <LibraryHeader onSignOut={() => void driveAuth.signOut()} />
      <main className="wrap" id="main" role="main">
        <LibraryIntro onAddStudy={() => openEditor(null)} isSignedIn={isSignedIn.value} typesReady={typesReady} />
        <section id="library" aria-label="Biblioteca" className="library" hidden={!isSignedIn.value}>
          <StudyListContainer
            onEdit={openEditor}
            onDelete={(study: Study) => setDeletingStudyId(study.id)}
            onShare={openShare}
            onClearFilters={clearFilters}
            onSearch={(query) => { filters.value = { ...filters.value, query }; }}
            onRetryLoad={loadStudies}
            onAddStudy={() => openEditor(null)}
            typesReady={typesReady}
            availableTypes={availableTypes}
            offline={offline.value}
            directoryWarning={directoryWarning.value}
            pendingChangesCount={pendingChanges.value.length}
          />
        </section>
        <section id="access" className="library access" aria-labelledby="access-title" hidden={isSignedIn.value}>
          <AccessSection
            onConnect={() => void connectDrive()}
            error={error.value}
            bootFailed={bootFailed}
            configured={driveAuth.configured}
          />
        </section>
        {isSignedIn.value && <PendingChangesSection
          onDiscard={discardPending}
          onRetrySync={prepareOutbox}
          onResolveConflict={(entry, revision) => void resolveConflict(entry, revision)}
        />}
      </main>
      <EditorDialog
        onClose={() => setEditorOpen(false)}
        error={editorError}
        busy={saving}
        availableTypes={availableTypes}
        onSave={saveStudy}
        verifyOwner={verifyEditorOwner}
        sessionLost={sessionLost}
        onReconnect={() => void connectDrive()}
      />
      <ConfirmDialog
        studies={studies.value}
        onConfirm={deleteStudyById}
        onCancel={() => setDeletingStudyId(null)}
        onReconnect={() => void connectDrive()}
        error={error.value}
        busy={deleting}
        sessionLost={sessionLost}
      />
      <ShareDialog
        onReconnect={() => void connectDrive()}
        error={error.value}
        busy={false}
        sessionLost={sessionLost}
      />
      <OnboardingDialog />
    </>
  );
}
