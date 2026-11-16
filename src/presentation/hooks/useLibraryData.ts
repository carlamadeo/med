import {useCallback, useRef} from 'preact/hooks';
import {
    driveAuth, driveStudyRepo, driveOperationRepo, drivePortalRepo,
    driveMedicalEventRepo, driveEpisodeRepo, driveAppointmentRepo, DriveSessionError,
} from '@data';
import {
    isSignedIn, deletingStudyId, isEditorOpen, setLoading, setError, setIsSignedIn,
    setStudies, operations, portals, medicalEvents, episodes, appointments, directoryWarning,
    studiesReady, directoriesReady, directoryFailures,
} from '../state/store';

export function useLibraryData() {
    // --- Studies ---
    const loadSequence = useRef(0);
    const loadStudies = useCallback(async (force = false) => {
        if (!isSignedIn.value) return;
        const seq = ++loadSequence.current;
        studiesReady.value = false;
        setLoading(true);
        setError(null);
        let token: string | undefined;
        try {
            token = await driveAuth.getAccessToken();
            const list = await driveStudyRepo.list({force});
            if (await driveAuth.getAccessToken() !== token || seq !== loadSequence.current || !isSignedIn.value) return;
            setStudies(list);
            studiesReady.value = true;
        } catch (err) {
            if (token && await driveAuth.getAccessToken().catch(() => null) !== token) return;
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
        directoriesReady.value = false;
        directoryWarning.value = false;
        const token = await driveAuth.getAccessToken().catch(() => null);
        if (!token) return;
        const [operationResult, portalResult, eventResult, episodeResult, appointmentResult] = await Promise.allSettled([
            driveOperationRepo.list(),
            drivePortalRepo.list(),
            driveMedicalEventRepo.list(),
            driveEpisodeRepo.list(),
            driveAppointmentRepo.list(),
        ]);
        if (await driveAuth.getAccessToken().catch(() => null) !== token || seq !== directorySequence.current || !isSignedIn.value) return;
        if (operationResult.status === 'fulfilled') operations.value = operationResult.value;
        if (portalResult.status === 'fulfilled') portals.value = portalResult.value;
        if (eventResult.status === 'fulfilled') medicalEvents.value = eventResult.value;
        if (episodeResult.status === 'fulfilled') episodes.value = episodeResult.value;
        if (appointmentResult.status === 'fulfilled') appointments.value = appointmentResult.value;
        const results: Array<[string, PromiseSettledResult<unknown>]> = [
            ['Operaciones', operationResult], ['Portales', portalResult],
            ['Consultas y recetas', eventResult], ['Episodios', episodeResult], ['Turnos', appointmentResult],
        ];
        directoryFailures.value = results.filter(([, result]) => result.status === 'rejected').map(([name]) => name);
        directoryWarning.value = directoryFailures.value.length > 0;
        directoriesReady.value = !directoryWarning.value;
    }, []);

    const invalidateStudies = useCallback(() => {
        loadSequence.current += 1;
    }, []);
    return {loadStudies, loadDirectories, invalidateStudies};
}
