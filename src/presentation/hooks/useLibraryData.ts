import {useCallback, useRef} from 'preact/hooks';
import {
    driveAuth, driveStudyRepo, driveOperationRepo, drivePortalRepo,
    driveMedicalEventRepo, driveEpisodeRepo, driveAppointmentRepo, DriveSessionError,
} from '@data';
import {
    isSignedIn, deletingStudyId, isEditorOpen, setLoading, setError, setIsSignedIn,
    setStudies, operations, portals, medicalEvents, episodes, appointments, directoryWarning,
} from '../state/store';

export function useLibraryData() {
    // --- Studies ---
    const loadSequence = useRef(0);
    const loadStudies = useCallback(async (force = false) => {
        if (!isSignedIn.value) return;
        const seq = ++loadSequence.current;
        setLoading(true);
        setError(null);
        let token: string | undefined;
        try {
            token = await driveAuth.getAccessToken();
            const list = await driveStudyRepo.list({force});
            if (seq !== loadSequence.current || await driveAuth.getAccessToken() !== token) return;
            setStudies(list);
        } catch (err) {
            if (seq !== loadSequence.current) return;
            if (token && await driveAuth.getAccessToken().catch(() => null) !== token) return;
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
        const token = await driveAuth.getAccessToken().catch(() => null);
        if (!token) return;
        const [operationResult, portalResult, eventResult, episodeResult, appointmentResult] = await Promise.allSettled([
            driveOperationRepo.list(),
            drivePortalRepo.list(),
            driveMedicalEventRepo.list(),
            driveEpisodeRepo.list(),
            driveAppointmentRepo.list(),
        ]);
        if (seq !== directorySequence.current || !isSignedIn.value || await driveAuth.getAccessToken().catch(() => null) !== token) return;
        if (operationResult.status === 'fulfilled') operations.value = operationResult.value;
        if (portalResult.status === 'fulfilled') portals.value = portalResult.value;
        if (eventResult.status === 'fulfilled') medicalEvents.value = eventResult.value;
        if (episodeResult.status === 'fulfilled') episodes.value = episodeResult.value;
        if (appointmentResult.status === 'fulfilled') appointments.value = appointmentResult.value;
        directoryWarning.value = operationResult.status === 'rejected' || portalResult.status === 'rejected' || eventResult.status === 'rejected' || episodeResult.status === 'rejected' || appointmentResult.status === 'rejected';
    }, []);

    const invalidateStudies = useCallback(() => {
        loadSequence.current += 1;
    }, []);
    return {loadStudies, loadDirectories, invalidateStudies};
}
