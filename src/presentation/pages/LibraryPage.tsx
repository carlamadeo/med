import {enqueueOffline} from '../utils/enqueueOffline';
import {reserveIntakeDestination, clearIntakeReservation, hasIntakeReservation} from '../utils/intakeReservation';
/**
 * Página principal: lista de estudios, filtros, editor y borrado.
 * Orquesta el estado reactivo (store) con los repositorios de Drive.
 */
import {useEffect, useRef, useState, useCallback} from 'preact/hooks';
import {todayLocal} from '@domain/utils';
import {getStudyTypes} from '@data/study-types';
import {validateDocument} from '@data/pdf-analysis';
import {hasStudyAttachment} from '@domain/library';
import {validateStudyDraft} from '@domain/validation/study';
import {Outbox} from '@data/outbox';
import {
    driveAuth,
    driveStudyRepo,
    DriveSessionError,
} from '@data';
import {
    isSignedIn,
    isLocalDemo,
    setIsSignedIn,
    setIsLocalDemo,
    view,
    studies,
    error,
    exportError,
    recoveryError,
    setStudies,
    setError,
    setEditingStudy,
    setEditorOpen,
    setDeletingStudyId,
    setSharingStudyId,
    pendingChanges,
    offline,
    directoryWarning,
    studiesReady,
    directoriesReady,
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
    CommandPalette,
} from '../components';
import {handleDriveError} from '../utils/driveErrorHandler';
import {checkAppointmentReminders} from '../utils/appointmentReminders';
import {StudyImportDialog} from '../components/StudyImportDialog';

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
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [importGeneration, setImportGeneration] = useState(0);

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
            if (!isSignedIn.value || event.defaultPrevented) return;
            if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                setPaletteOpen((prev) => !prev);
                return;
            }
            if (!typesReady || event.ctrlKey || event.metaKey || event.altKey ||
                document.querySelector('dialog[open]')) return;
            const target = event.target;
            if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
            if (event.key.toLowerCase() === 'n' && !event.repeat) {
                event.preventDefault();
                openEditor(null);
            }
        };
        document.addEventListener('keydown', handleShortcut);
        return () => document.removeEventListener('keydown', handleShortcut);
    }, [typesReady]);

    // Demo local mode (sin cuenta Drive)
    const enterDemoMode = useCallback(() => {
        setIsLocalDemo(true);
        setIsSignedIn(true);
        studiesReady.value = true;
        directoriesReady.value = true;
        if (studies.value.length === 0) {
            setStudies([
                {
                    id: 'demo-1',
                    driveFileId: '',
                    title: 'Ecografía abdominal completa',
                    date: '2024-03-15',
                    doctor: 'Dra. Mariana López',
                    portal: 'Centro Médico Belgrano',
                    types: ['Ecografía'],
                    viewer: '',
                    reportName: '',
                    hasPdf: false,
                    driveModifiedTime: '',
                    revision: '1',
                },
                {
                    id: 'demo-2',
                    driveFileId: '',
                    title: 'Hemograma y perfil lipídico',
                    date: '2024-01-20',
                    doctor: 'Dr. Santiago Méndez',
                    portal: 'Laboratorio Central',
                    types: ['Laboratorio'],
                    viewer: '',
                    reportName: '',
                    hasPdf: false,
                    driveModifiedTime: '',
                    revision: '1',
                },
            ]);
        }
    }, []);

    // --- Editor ---
    function openEditor(studyOrDraft: Study | null | (Partial<StudyDraft> & {
        _candidateId: string;
        _candidateName: string
    })) {
        pendingId.current = '';
        const owner = driveAuth.cachedAccountId();
        editorOwner.current = isLocalDemo.value
            ? Promise.resolve(null)
            : owner ? Promise.resolve(owner) : driveAuth.getAccountId().catch(() => null);
        setEditorError(null);
        setSessionLost(false);
        if (studyOrDraft && '_candidateId' in studyOrDraft) {
            // Intake candidate: pre-fill title from candidate name, keep file
            setEditingStudy({
                ...studyOrDraft,
                id: `pending-${Date.now()}`,
                intakeSourceId: studyOrDraft._candidateId,
                title: studyOrDraft.title ?? studyOrDraft._candidateName ?? '',
                date: studyOrDraft.date ?? todayLocal(),
                types: studyOrDraft.types ?? [],
                doctor: studyOrDraft.doctor ?? '',
                portal: studyOrDraft.portal ?? '',
                viewer: studyOrDraft.viewer ?? '',
                reportName: studyOrDraft.reportName ?? '',
                hasPdf: true,
                driveFileId: '',
                driveModifiedTime: '',
                revision: '',
                operationId: studyOrDraft.operationId ?? '',
                documentIds: studyOrDraft.documentIds ?? [],
                syncStatus: undefined,
                pendingAttachment: true,
            } as Study);
        } else {
            setEditingStudy(studyOrDraft as Study | null);
        }
    }

    async function verifyEditorOwner(): Promise<boolean> {
        if (isLocalDemo.value || !driveAuth.configured) {
            return true;
        }
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
            const validationErrors = validateStudyDraft(draft);
            if (validationErrors.length) {
                setEditorError(validationErrors[0] ?? 'Error de validación');
                setSaving(false);
                return;
            }

            if (isLocalDemo.value || !driveAuth.configured) {
                const existing = draft.id ? studies.value.find((s) => s.id === draft.id) : null;
                const hasPdf = draft.file ? true : (draft.removeReport ? false : Boolean(existing?.hasPdf));
                const reportName = draft.file ? draft.file.name : (draft.removeReport ? '' : (draft.reportName || existing?.reportName || ''));

                const saved: Study = {
                    id: draft.id || `demo-${Date.now()}`,
                    driveFileId: '',
                    title: draft.title,
                    date: draft.date,
                    doctor: draft.doctor || '',
                    portal: draft.portal || '',
                    types: [...draft.types],
                    viewer: draft.viewer || '',
                    reportName,
                    hasPdf,
                    driveModifiedTime: new Date().toISOString(),
                    revision: '1',
                    operationId: draft.operationId || '',
                };
                setStudies([...studies.value.filter((item) => item.id !== saved.id), saved]);
                setEditorOpen(false);
                return;
            }

            const token = await driveAuth.getAccessToken();
            if (draft.file) {
                const type = await validateDocument(draft.file);
                if (draft.file.type !== type) {
                    draft.file = new File([draft.file], draft.file.name, {type, lastModified: draft.file.lastModified});
                }
            }
            const ownerOk = await verifyEditorOwner();
            if (!ownerOk) {
                setSaving(false);
                return;
            }
            const pendingOwner = driveAuth.cachedAccountId() ?? (navigator.onLine ? await driveAuth.getAccountId() : null);
            const pending = pendingOwner ? await outbox.list(pendingOwner) : [];
            if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
            if (draft.intakeSourceId && pending.some(item => item.kind === 'save' && item.draft?.intakeSourceId === draft.intakeSourceId)) {
                setEditorError('Este documento ya tiene un cambio pendiente de sincronización.');
                return;
            }
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
                await enqueueOffline(owner, async () => {
                    const current = await outbox.list(owner);
                    if (draft.intakeSourceId && current.some(item => item.kind === 'save' && item.draft?.intakeSourceId === draft.intakeSourceId)) {
                        throw new Error('Este documento ya tiene un cambio pendiente de sincronización.');
                    }
                    await outbox.enqueueSave(owner, draft);
                }, token);
                const queued = await outbox.list(owner);
                if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
                pendingChanges.value = queued;
                setEditorOpen(false);
                return;
            }
            const save = async () => {
                if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
                if (draft.intakeSourceId && pendingOwner) {
                    const queued = await outbox.list(pendingOwner);
                    if (queued.some(item => item.kind === 'save' && item.draft?.intakeSourceId === draft.intakeSourceId)) {
                        throw new Error('Este documento ya tiene un cambio pendiente de sincronización.');
                    }
                    if (!hasIntakeReservation(pendingOwner, draft.intakeSourceId)) {
                        const existing = (await driveStudyRepo.list({force: true})).find(study => study.intakeSourceId === draft.intakeSourceId);
                        if (existing) return existing;
                        const deleted = await driveStudyRepo.listDeleted();
                        if (deleted.some(study => study.recoverable && study.intakeSourceId === draft.intakeSourceId)) {
                            throw new Error('Este informe ya fue importado y está en la papelera. Usá Recuperar informe para restaurarlo.');
                        }
                    }
                    draft.id = await reserveIntakeDestination(pendingOwner, draft.intakeSourceId, draft, () => driveStudyRepo.reserveId());
                } else if (!draft.driveFileId) {
                    const id = pendingId.current || await driveStudyRepo.reserveId();
                    if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
                    pendingId.current = id;
                    draft.id = id;
                }
                if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
                return driveStudyRepo.save(draft);
            };
            const saved = draft.intakeSourceId && pendingOwner && navigator.locks
                ? await navigator.locks.request(`mis-estudios-outbox:${pendingOwner}`, save)
                : await save();
            if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
            if (draft.intakeSourceId && pendingOwner) clearIntakeReservation(pendingOwner, draft.intakeSourceId);
            invalidateStudies();
            setStudies([...studies.value.filter((item) => item.id !== saved.id), saved]);
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
            if (isLocalDemo.value || !driveAuth.configured) {
                setStudies(studies.value.filter((s) => s.id !== studyId));
                setDeletingStudyId(null);
                setDeleting(false);
                return;
            }

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
        const hasShareable = hasStudyAttachment(study) || study.viewer || study.documentIds?.length;
        if (!hasShareable) return;
        setSharingStudyId(study.id);
    }

    return (
        <>
            <AppShell
                isSignedIn={isSignedIn.value}
                onOpenSearch={() => setPaletteOpen(true)}
                onSignOut={() => {
                    setImportOpen(false);
                    setImportGeneration(value => value + 1);
                    if (isLocalDemo.value) {
                        setIsLocalDemo(false);
                        setIsSignedIn(false);
                        studiesReady.value = false;
                        directoriesReady.value = false;
                    } else {
                        void driveAuth.signOut();
                    }
                }}
            >
                <main className="wrap" id="main" role="main">
                    {isLocalDemo.value && (
                        <aside className="demo-notice" role="status" aria-label="Modo de prueba local">
                            <strong>Modo local de prueba:</strong> Estás probando la app sin conexión a Google Drive. Podés crear, ver, ordenar y filtrar estudios libremente.
                        </aside>
                    )}
                    <LibraryIntro onAddStudy={() => openEditor(null)} onImport={() => setImportOpen(true)}
                                  isSignedIn={isSignedIn.value} isLocalDemo={isLocalDemo.value}
                                  typesReady={typesReady} view={view.value}/>
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
                                onRetryDirectories={() => void loadDirectories()}
                            />
                        ) : (
                            <StudyListContainer
                                key={isSignedIn.value ? 'signed-in' : 'signed-out'}
                                onEdit={openEditor}
                                onDelete={(study: Study) => setDeletingStudyId(study.id)}
                                onShare={openShare}
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
                            onEnterDemo={enterDemoMode}
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
            <AppointmentDialog/>
            <StudyImportDialog key={importGeneration} open={importOpen} onClose={() => setImportOpen(false)} studies={studies.value} onSaved={study => setStudies([...studies.value.filter(item => item.id !== study.id), study])}/>
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
            <CommandPalette
                open={paletteOpen}
                onClose={() => setPaletteOpen(false)}
                onOpenStudy={(study) => openEditor(study)}
                onAddStudy={() => openEditor(null)}
                onNavigate={(next) => {
                    view.value = next;
                }}
            />
            <OnboardingDialog/>
        </>
    );
}
