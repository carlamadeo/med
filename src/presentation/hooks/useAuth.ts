import {useEffect, useRef, useCallback} from 'preact/hooks';
import {driveAuth} from '@data';
import {
    isSignedIn,
    studies,
    operations,
    portals,
    medicalEvents,
    episodes,
    appointments,
    pendingChanges,
    syncMessage,
    isEditorOpen,
    deletingStudyId,
    view,
    setEditorOpen,
} from '../state/store';
import {
    setIsSignedIn,
    setError,
    setApprovedFolderId,
    setIntakeCandidates,
    setIntakeError,
    setOffline,
} from '../state/store';

interface UseAuthOptions {
    loadStudies: (force?: boolean) => Promise<void>;
    loadDirectories: () => Promise<void>;
    prepareOutbox: () => Promise<void>;
    editorOwner: { current: Promise<string | null> };
    setSessionLost: (value: boolean) => void;
    onEditorReconnect?: () => void;
}

export function useAuth({
                            loadStudies,
                            loadDirectories,
                            prepareOutbox,
                            editorOwner,
                            setSessionLost,
                            onEditorReconnect,
                        }: UseAuthOptions): {
    connectDrive: () => Promise<void>;
} {
    const authSequence = useRef(0);

    const handleAuthChange = useCallback(
        (signedIn: boolean) => {
            const sequence = ++authSequence.current;
            if (!signedIn) {
                setIsSignedIn(false);
                view.value = 'cronologia';
                setApprovedFolderId(null);
                setIntakeCandidates([]);
                setIntakeError(null);
                studies.value = [];
                operations.value = [];
                portals.value = [];
                medicalEvents.value = [];
                episodes.value = [];
                appointments.value = [];
                pendingChanges.value = [];
                syncMessage.value = '';
                setSessionLost(true);
                return;
            }

            void (async () => {
                try {
                    const token = await driveAuth.getAccessToken();
                    let owner = driveAuth.cachedAccountId();
                    if (navigator.onLine) {
                        try {
                            owner = await driveAuth.getAccountId();
                        } catch {
                            if (!owner) {
                                await driveAuth.signOut();
                                setError('No se pudo verificar la cuenta de Google Drive. Conectate y volvé a intentar.');
                                return;
                            }
                        }
                    }
                    if (!owner) {
                        await driveAuth.signOut();
                        setError('No se pudo verificar la cuenta de Google Drive. Conectate y volvé a intentar.');
                        return;
                    }
                    const originalEditorOwner = isEditorOpen.value ? await editorOwner.current : null;
                    if (sequence !== authSequence.current || (await driveAuth.getAccessToken()) !== token) return;
                    if (isEditorOpen.value && originalEditorOwner !== owner) {
                        setEditorOpen(false);
                    }
                    setIsSignedIn(true);
                    setSessionLost(false);
                    setError(null);
                    // Update editorOwner ref after successful sign-in so future saves verify correctly
                    editorOwner.current = Promise.resolve(owner);
                    // Clear editor error on successful reconnect
                    onEditorReconnect?.();
                    await loadStudies();
                    await loadDirectories();
                    await prepareOutbox();
                } catch (err) {
                    if (sequence !== authSequence.current) return;
                    await driveAuth.signOut();
                    setError(err instanceof Error ? err.message : 'No se pudo verificar la cuenta de Google Drive.');
                }
            })();
        },
        [
            loadStudies,
            loadDirectories,
            prepareOutbox,
            editorOwner,
            setSessionLost,
            onEditorReconnect,
        ]
    );

    const connectDrive = useCallback(async () => {
        setError(null);
        try {
            await driveAuth.signIn();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'No se pudo conectar Google Drive.';
            setError(message);
        }
    }, []);

    useEffect(() => {
        const unsub = driveAuth.onAuthChange(handleAuthChange);
        if (driveAuth.configured) {
            driveAuth.restoreSession();
        }
        return () => {
            authSequence.current += 1;
            unsub();
        };
    }, [handleAuthChange]);

    useEffect(() => {
        const refresh = () => {
            if (!document.hidden && isSignedIn.value && driveAuth.isSignedIn() && !isEditorOpen.value && !deletingStudyId.value) {
                void loadStudies(true);
            }
        };
        const online = () => {
            setOffline(false);
            if (isSignedIn.value && driveAuth.isSignedIn()) {
                void prepareOutbox();
                void loadStudies(true);
                void loadDirectories();
            }
        };
        const disconnected = () => setOffline(true);
        const outboxChanged = () => {
            if (isSignedIn.value && driveAuth.isSignedIn()) void prepareOutbox();
        };
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
    }, [prepareOutbox, loadStudies, loadDirectories]);

    return {connectDrive};
}