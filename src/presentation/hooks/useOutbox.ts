import {useCallback, useRef} from 'preact/hooks';
import type {Outbox, OutboxEntry} from '@data/outbox';
import {
    driveAuth, driveStudyRepo, driveOperationRepo, drivePortalRepo,
    driveMedicalEventRepo, driveEpisodeRepo, driveAppointmentRepo, DriveSessionError,
} from '@data';
import {
    pendingChanges, syncMessage, syncing, setStudies, operations, portals,
    medicalEvents, episodes, appointments,
} from '../state/store';

export function useOutbox(
    outbox: Outbox,
    loadStudies: (force?: boolean) => Promise<void>,
    loadDirectories: () => Promise<void>,
) {
    const syncTail = useRef<Promise<void>>(Promise.resolve());
    // --- Outbox ---
    const prepareOutbox = useCallback(async () => {
        try {
            const token = await driveAuth.getAccessToken();
            let owner = driveAuth.cachedAccountId();
            if (navigator.onLine) {
                try {
                    owner = await driveAuth.getAccountId();
                } catch {
                    if (!owner) return;
                }
            }
            if (!owner) return;
            const pending = await outbox.list(owner);
            if (await driveAuth.getAccessToken() !== token) return;
            pendingChanges.value = pending;
            if (navigator.onLine && pending.length) await syncOutbox(owner);
        } catch {
            syncMessage.value = 'No se pudo verificar la cuenta para sincronizar los cambios pendientes.';
        }
    }, []);

    const syncOutbox = useCallback(async (owner: string) => {
        if (!navigator.locks) {
            syncMessage.value = 'Este navegador no puede sincronizar cambios pendientes de forma segura.';
            return;
        }
        const token = await driveAuth.getAccessToken();
        const previous = syncTail.current;
        let release!: () => void;
        const current = new Promise<void>((resolve) => {
            release = resolve;
        });
        syncTail.current = current;
        await previous;
        const assertToken = async () => {
            if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
        };
        try {
            await assertToken();
            syncing.value = true;
            syncMessage.value = '';
            await outbox.sync(owner, {
                accountId: async () => {
                    await assertToken();
                    const id = await driveAuth.getAccountId();
                    await assertToken();
                    return id;
                },
                reserveId: async () => {
                    await assertToken();
                    const id = await driveStudyRepo.reserveId();
                    await assertToken();
                    return id;
                },
                save: async (draft) => {
                    await assertToken();
                    await driveStudyRepo.save(draft);
                    await assertToken();
                },
                delete: async (id, revision) => {
                    await assertToken();
                    await driveStudyRepo.delete(id, revision);
                    await assertToken();
                },
                restore: async (id, revision) => {
                    await assertToken();
                    await driveStudyRepo.restore(id, revision);
                    await assertToken();
                },
                saveOperation: async (draft) => {
                    await assertToken();
                    await driveOperationRepo.save(draft);
                    await assertToken();
                },
                deleteOperation: async (id, revision) => {
                    await assertToken();
                    await driveOperationRepo.delete(id, revision);
                    await assertToken();
                },
                restoreOperation: async (id, revision) => {
                    await assertToken();
                    await driveOperationRepo.restore(id, revision);
                    await assertToken();
                },
                savePortal: async (draft) => {
                    await assertToken();
                    await drivePortalRepo.save(draft);
                    await assertToken();
                },
                deletePortal: async (portal) => {
                    await assertToken();
                    await drivePortalRepo.delete(portal);
                    await assertToken();
                },
                restorePortal: async (id, revision) => {
                    await assertToken();
                    await drivePortalRepo.restore(id, revision);
                    await assertToken();
                },
                saveEvent: async (draft) => {
                    await assertToken();
                    await driveMedicalEventRepo.save(draft);
                    await assertToken();
                },
                deleteEvent: async (id, revision) => {
                    await assertToken();
                    await driveMedicalEventRepo.delete(id, revision);
                    await assertToken();
                },
                restoreEvent: async (id, revision) => {
                    await assertToken();
                    await driveMedicalEventRepo.restore(id, revision);
                    await assertToken();
                },
                saveEpisode: async (draft) => {
                    await assertToken();
                    await driveEpisodeRepo.save(draft);
                    await assertToken();
                },
                deleteEpisode: async (id, revision) => {
                    await assertToken();
                    await driveEpisodeRepo.delete(id, revision);
                    await assertToken();
                },
                restoreEpisode: async (id, revision) => {
                    await assertToken();
                    await driveEpisodeRepo.restore(id, revision);
                    await assertToken();
                },
                saveAppointment: async (draft) => {
                    await assertToken();
                    await driveAppointmentRepo.save(draft);
                    await assertToken();
                },
                deleteAppointment: async (id, revision) => {
                    await assertToken();
                    await driveAppointmentRepo.delete(id, revision);
                    await assertToken();
                },
                restoreAppointment: async (id, revision) => {
                    await assertToken();
                    await driveAppointmentRepo.restore(id, revision);
                    await assertToken();
                },
                lock: async (name, callback) => {
                    await navigator.locks.request(name, callback);
                },
            });
            await assertToken();
            const remaining = await outbox.list(owner);
            pendingChanges.value = remaining;
            if (remaining.some((entry) => entry.status === 'conflict')) syncMessage.value = 'Un estudio cambió en Drive. Revisá el cambio pendiente antes de continuar.';
            else if (remaining.some((entry) => entry.status === 'failed')) syncMessage.value = 'Hay un cambio que no se puede sincronizar. Revisalo o descartalo para continuar.';
            else if (remaining.length) syncMessage.value = 'Hay cambios pendientes que no se pudieron sincronizar.';
            await loadStudies(true);
            await loadDirectories();
        } catch {
            syncMessage.value = 'No se pudieron sincronizar los cambios pendientes.';
        } finally {
            if (syncTail.current === current) syncing.value = false;
            release();
        }
    }, []);

    const discardPending = useCallback(async (entry: OutboxEntry) => {
        const owner = driveAuth.cachedAccountId();
        if (!owner || entry.id === undefined || !navigator.locks) {
            syncMessage.value = 'Este navegador no puede modificar la cola de forma segura.';
            return;
        }
        if (!window.confirm(entry.attachment ? '¿Descartar este cambio pendiente y el PDF guardado en este dispositivo?' : '¿Descartar este cambio pendiente?')) return;
        try {
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
        } catch (err) {
            syncMessage.value = err instanceof Error ? err.message : 'No se pudo descartar el cambio pendiente.';
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
                    const current = await driveStudyRepo.list({force: true});
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
                } else if (entry.episodeId) {
                    const current = await driveEpisodeRepo.list();
                    if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
                    episodes.value = current;
                    currentRevision = current.find((item) => item.id === entry.episodeId)?.revision;
                } else if (entry.appointmentId) {
                    const current = await driveAppointmentRepo.list();
                    if (await driveAuth.getAccessToken() !== token) throw new DriveSessionError();
                    appointments.value = current;
                    currentRevision = current.find((item) => item.id === entry.appointmentId)?.revision;
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

    return {prepareOutbox, discardPending, resolveConflict};
}
