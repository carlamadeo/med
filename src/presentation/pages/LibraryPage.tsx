import {enqueueOffline} from '../utils/enqueueOffline';
/**
 * Página principal: lista de estudios, filtros, editor y borrado.
 * Orquesta el estado reactivo (store) con los repositorios de Drive.
 */
import {useEffect, useRef, useState, useCallback} from 'preact/hooks';
import {todayLocal} from '@domain/utils';
import {getStudyTypes} from '@data/study-types';
import {validatePdf} from '@data/pdf-analysis';
import {validateStudyDraft} from '@domain/validation/study';
import {Outbox} from '@data/outbox';
import {
    driveAuth,
    driveStudyRepo,
    DriveSessionError,
} from '@data';
import {
    isSignedIn,
    view,
    studies,
    error,
    exportError,
    recoveryError,
    setStudies,
    setError,
    filters,
    clearFilters,
    setEditingStudy,
    setEditorOpen,
    setDeletingStudyId,
    setSharingStudyId,
    pendingChanges,
    offline,
    directoryWarning,
} from '../state/store';
import {useAuth} from '../hooks/useAuth';
import {useLibraryData} from '../hooks/useLibraryData';
import {useOutbox} from '../hooks/useOutbox';
import type {Study, StudyDraft} from '@domain/models';
import {
    EditorDialog,
    ConfirmDialog,
    OnboardingDialog,
    PendingChangesSection,
    AppShell,
    Resumen,
    StudyListContainer,
    AccessSection,
    AppointmentDialog,
    LibraryIntro,
    ShareDialog,
    ExportDialog,
    RecoveryDialog,
} from '../components';
import {handleDriveError} from '../utils/driveErrorHandler';
import {checkAppointmentReminders} from '../utils/appointmentReminders';

const outbox = new Outbox();

export function LibraryPage() {
    const pendingId = useRef('');
    const editorOwner = useRef<Promise<string | null>>(Promise.resolve(null));
    const [availableTypes, setAvailableTypes] = useState<string[]>([]);
    const [typesReady, setTypesReady] = useState(false);
    const [bootFailed, setBootFailed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editorError, setEditorError] = useState<string | null>(null);
    const [sessionLost, setSessionLost] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const clearEditorError = useCallback(() => setEditorError(null), []);

    useEffect(() => {
        const check = () => {
            void checkAppointmentReminders().catch(() => {
            });
        };
        const timer = window.setInterval(check, 60000);
        window.addEventListener('focus', check);
        document.addEventListener('visibilitychange', check);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('focus', check);
            document.removeEventListener('visibilitychange', check);
        };
    }, []);

    // Load study types on mount
    useEffect(() => {
        void getStudyTypes().then((types) => {
            setAvailableTypes(types);
            setTypesReady(true);
        }).catch(() => setBootFailed(true));
    }, []);

    const {loadStudies, loadDirectories, invalidateStudies} = useLibraryData();

    const {prepareOutbox, discardPending, resolveConflict} = useOutbox(outbox, loadStudies, loadDirectories);

    const {connectDrive} = useAuth({
        loadStudies,
        loadDirectories,
        prepareOutbox,
        editorOwner,
        setSessionLost,
        onEditorReconnect: clearEditorError,
    });

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

    // --- Editor ---
    function openEditor(studyOrDraft: Study | null | (Partial<StudyDraft> & {
        _candidateId: string;
        _candidateName: string
    })) {
        pendingId.current = '';
        const owner = driveAuth.cachedAccountId();
        editorOwner.current = owner ? Promise.resolve(owner) : driveAuth.getAccountId().catch(() => null);
        setEditorError(null);
        setSessionLost(false);
        if (studyOrDraft && '_candidateId' in studyOrDraft) {
            // Intake candidate: pre-fill title from candidate name, keep file
            setEditingStudy({
                ...studyOrDraft,
                id: `pending-${Date.now()}`,
                title: studyOrDraft._candidateName || '',
                date: todayLocal(),
                types: [],
                doctor: '',
                portal: '',
                viewer: '',
                reportName: '',
                hasPdf: true,
                driveFileId: '',
                driveModifiedTime: '',
                revision: '',
                operationId: '',
                documentIds: [],
                syncStatus: undefined,
                pendingAttachment: true,
            } as Study);
        } else {
            setEditingStudy(studyOrDraft as Study | null);
        }
    }

    async function verifyEditorOwner(): Promise<boolean> {
        const owner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
        const original = await editorOwner.current;
        if (!original || original !== owner) {
            setEditorError('Este borrador pertenece a otra cuenta o no se pudo verificar su cuenta original. Reconectá la cuenta con la que lo abriste.');
            return false;
        }
        return true;
    }

    async function saveStudy(draft: StudyDraft): Promise<void> {
        if (saving) return;
        setSaving(true);
        setEditorError(null);
        try {
            const token = await driveAuth.getAccessToken();
            const validationErrors = validateStudyDraft(draft);
            if (validationErrors.length) {
                setEditorError(validationErrors[0] ?? 'Error de validación');
                setSaving(false);
                return;
            }
            if (draft.file) await validatePdf(draft.file);
            const ownerOk = await verifyEditorOwner();
            if (!ownerOk) {
                setSaving(false);
                return;
            }
            const pendingOwner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
            const pending = pendingOwner ? await outbox.list(pendingOwner) : [];
            if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
            if (draft.driveFileId && pending.some((item) => item.studyId === draft.driveFileId)) {
                setEditorError('Este estudio ya tiene un cambio pendiente.');
                setSaving(false);
                return;
            }
            if (draft.operationId && pending.some((item) => item.kind === 'operation-delete' && item.operationId === draft.operationId)) {
                setEditorError('La operación tiene una eliminación pendiente.');
                setSaving(false);
                return;
            }
            if (!navigator.onLine) {
                if (!navigator.locks) {
                    setEditorError('Este navegador no admite la sincronización segura sin conexión.');
                    setSaving(false);
                    return;
                }
                const owner = driveAuth.cachedAccountId();
                if (!owner) {
                    setEditorError('Conectate primero para verificar tu cuenta antes de guardar sin conexión.');
                    setSaving(false);
                    return;
                }
                await enqueueOffline(owner, () => outbox.enqueueSave(owner, draft), token);
                const queued = await outbox.list(owner);
                if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
                pendingChanges.value = queued;
                setEditorOpen(false);
                return;
            }
            if (!draft.driveFileId) {
                const id = pendingId.current || await driveStudyRepo.reserveId();
                if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
                pendingId.current = id;
                draft.id = pendingId.current;
            }
            if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
            const saved = await driveStudyRepo.save(draft);
            if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
            invalidateStudies();
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
        } finally {
            setSaving(false);
        }
    }

    // --- Delete ---
    async function deleteStudyById(studyOrId: Study | string): Promise<void> {
        const studyId = typeof studyOrId === 'string' ? studyOrId : studyOrId.id;
        const study = typeof studyOrId === 'string' ? studies.value.find((s) => s.id === studyId) : studyOrId;

        if (!study) return;
        setDeleting(true);
        setError(null);
        try {
            const token = await driveAuth.getAccessToken();
            const pendingOwner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
            if (pendingOwner && (await outbox.list(pendingOwner)).some((item) => item.studyId === studyId)) {
                setError('Este estudio ya tiene un cambio pendiente.');
                setDeleting(false);
                return;
            }
            if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
            if (!navigator.onLine) {
                if (!navigator.locks) {
                    setError('Este navegador no admite la sincronización segura sin conexión.');
                    setDeleting(false);
                    return;
                }
                const owner = driveAuth.cachedAccountId();
                if (!owner) {
                    setError('Conectate primero para verificar tu cuenta antes de guardar sin conexión.');
                    setDeleting(false);
                    return;
                }
                await enqueueOffline(owner, () => outbox.enqueueDelete(owner, studyId, study.revision), token);
                const queued = await outbox.list(owner);
                if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
                pendingChanges.value = queued;
                setDeletingStudyId(null);
                return;
            }
            await driveStudyRepo.delete(studyId, study.revision);
            if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
            invalidateStudies();
            setStudies(studies.value.filter((s) => s.id !== studyId));
            setDeletingStudyId(null);
            await loadStudies(true);
        } catch (err) {
            handleDriveError(err, {
                onSessionLost: () => setSessionLost(true),
                onConflict: () => void loadStudies(true),
                onError: (message) => setError(message),
            });
        } finally {
            setDeleting(false);
        }
    }

    function openShare(study: Study): void {
        const hasShareable = study.hasPdf || study.viewer || study.documentIds?.length;
        if (!hasShareable) return;
        setSharingStudyId(study.id);
    }

    return (
        <>
            <AppShell isSignedIn={isSignedIn.value} onSignOut={() => void driveAuth.signOut()} onOpenStudy={openEditor} onAddStudy={() => openEditor(null)}>
                <main className="wrap" id="main" role="main">
                    <LibraryIntro onAddStudy={() => openEditor(null)} isSignedIn={isSignedIn.value}
                                  typesReady={typesReady} summary={isSignedIn.value && view.value === 'resumen'}/>
                    <section id="library" aria-label="Biblioteca"
                             className={view.value === 'resumen' ? 'library library-resumen' : 'library'}
                             hidden={!isSignedIn.value}>
                        {view.value === 'resumen' ? (
                            <Resumen
                                typesReady={typesReady}
                                onAddStudy={() => openEditor(null)}
                                onEdit={openEditor}
                                onDelete={(study: Study) => setDeletingStudyId(study.id)}
                                onShare={openShare}
                                onNavigate={(next) => {
                                    view.value = next;
                                }}
                                onRetryLoad={() => void loadStudies(true)}
                            />
                        ) : (
                            <StudyListContainer
                                onEdit={openEditor}
                                onDelete={(study: Study) => setDeletingStudyId(study.id)}
                                onShare={openShare}
                                onClearFilters={clearFilters}
                                onSearch={(query) => {
                                    filters.value = {...filters.value, query};
                                }}
                                onRetryLoad={loadStudies}
                                onAddStudy={() => openEditor(null)}
                                onOpenCandidate={openEditor}
                                typesReady={typesReady}
                                availableTypes={availableTypes}
                                offline={offline.value}
                                directoryWarning={directoryWarning.value}
                                pendingChangesCount={pendingChanges.value.length}
                            />
                        )}
                    </section>
                    <section id="access" className="library access" aria-labelledby="access-title"
                             hidden={isSignedIn.value}>
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
            </AppShell>
            <AppointmentDialog />
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
            <ExportDialog
                onReconnect={() => void connectDrive()}
                error={exportError.value}
                sessionLost={sessionLost}
            />
            <RecoveryDialog
                onReconnect={() => void connectDrive()}
                error={recoveryError.value}
                sessionLost={sessionLost}
            />
            <OnboardingDialog/>
        </>
    );
}
