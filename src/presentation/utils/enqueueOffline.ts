import {driveAuth} from '@data';

export async function enqueueOffline(owner: string, enqueue: () => Promise<void>, expectedToken?: string): Promise<void> {
    if (!navigator.locks) throw new Error('Este navegador no admite la sincronización segura sin conexión.');
    const token = expectedToken ?? await driveAuth.getAccessToken();
    await navigator.locks.request(`mis-estudios-outbox:${owner}`, async () => {
        if (await driveAuth.getAccessToken() !== token || driveAuth.cachedAccountId() !== owner) {
            throw new Error('La cuenta cambió. Volvé a intentar.');
        }
        await enqueue();
    });
}
