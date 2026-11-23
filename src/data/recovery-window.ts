import {storage} from '@core/storage';
import {DriveConflictError, type DriveClient, type DriveFileResponse} from './drive-api';

const ID_PATTERN = /^[\w-]+$/;

export function isRecoverable(deletedAt: string, now = Date.now()): boolean {
    const age = now - Date.parse(deletedAt);
    return Number.isFinite(age) && age >= 0 && age < 30 * 86400000;
}

export interface RestoreDriveRecordOptions<T extends {id: string}> {
    client: DriveClient;
    id: string;
    revision: string;
    marker: string;
    fields: string;
    invalidRevisionMessage: string;
    expiredMessage: string;
    conflictTarget?: ConstructorParameters<typeof DriveConflictError>[0];
    deletedCacheKey: string;
    activeCacheKey?: string;
    parse: (file: DriveFileResponse) => T;
    onRestored?: (owner: string, record: T) => Promise<void>;
}

/** Restores a trashed Drive record after verifying revision, ownership, and recovery window. */
export async function restoreDriveRecord<T extends {id: string}>(
    options: RestoreDriveRecordOptions<T>,
): Promise<T> {
    const {
        client,
        id,
        revision,
        marker,
        fields,
        invalidRevisionMessage,
        expiredMessage,
        conflictTarget,
        deletedCacheKey,
        activeCacheKey,
        parse,
        onRestored,
    } = options;
    if (!ID_PATTERN.test(id) || !revision) throw new Error(invalidRevisionMessage);
    const token = await client.getAccessToken();
    const owner = await client.cacheOwner();
    const fileUrl = client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, {fields});
    const file = await client.request(fileUrl, {}, token).then(r => r.json() as Promise<DriveFileResponse>);
    if (file.appProperties?.misEstudios !== marker) throw new DriveConflictError(conflictTarget);
    if (!file.trashed && file.appProperties.restoredRevision === revision) {
        await client.assertSession(token);
        return parse(file);
    }
    if (!file.trashed || file.version !== revision) throw new DriveConflictError(conflictTarget);
    if (!isRecoverable(file.appProperties.deletedAt ?? '')) throw new Error(expiredMessage);
    await client.assertSession(token);
    const restored = await client.request(
        fileUrl,
        client.jsonBody('PATCH', {
            trashed: false,
            appProperties: {...file.appProperties, deletedAt: undefined, restoredRevision: revision},
        }),
        token,
    ).then(r => r.json() as Promise<DriveFileResponse>);
    await client.assertSession(token);
    const record = parse(restored);
    if (activeCacheKey) {
        await storage.updateSessionDirectory<T>(owner, activeCacheKey, (cached) => [
            ...(cached ?? []).filter(item => item.id !== id),
            record,
        ]);
    }
    if (onRestored) {
        await onRestored(owner, record);
    }
    await storage.updateSessionDirectory<{id: string}>(owner, deletedCacheKey, (cached) =>
        cached ? cached.filter(item => item.id !== id) : null,
    );
    return record;
}
