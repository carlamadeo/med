import {CONFIG, type Config} from '@core/config';
import {storage} from '@core/storage';
import {isValidDate, viewerURL} from '@domain/utils';
import {documentAssociationIds} from '@domain/document-compatibility';
import type {DriveFileMetadata, Study} from '@domain/repository';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_ROOT = 'https://www.googleapis.com/drive/v3/';
const UPLOAD_ROOT = 'https://www.googleapis.com/upload/drive/v3/';
const ENTRY_FIELDS = 'id,description,version,modifiedTime,mimeType,trashed,appProperties';
const TAG = 'misEstudios';
const MARKER = 'estudio-v1';
const FOLDER_MARKER = 'carpeta-v1';
const PDF_MIME = 'application/pdf';
const ID_PATTERN = /^[\w-]+$/;

function getSessionKey(clientId: string): string {
    return `mis-estudios:drive-session:${clientId}`;
}

export interface DriveFileResponse {
    id: string;
    name: string;
    description: string;
    version: string;
    modifiedTime?: string;
    mimeType: string;
    trashed: boolean;
    appProperties?: Record<string, string>;
    files?: DriveFileResponse[];
    nextPageToken?: string;
    ids?: string[];
}

interface GoogleOAuthResponse {
    access_token?: string;
    expires_in?: number;
    error?: string;
}

declare global {
    interface Window {
        google?: {
            accounts?: {
                oauth2?: {
                    initTokenClient: (options: {
                        client_id: string;
                        scope: string;
                        include_granted_scopes: boolean;
                        callback: (response: GoogleOAuthResponse) => void;
                        error_callback: () => void;
                    }) => {
                        requestAccessToken: (options: { prompt: string }) => void;
                    };
                    hasGrantedAllScopes: (response: GoogleOAuthResponse, ...scopes: string[]) => boolean;
                };
            };
        };
    }
}

export class DriveError extends Error {
    constructor(public status: number) {
        super(
            status === 404
                ? 'El estudio ya no está disponible en Drive.'
                : status === 403
                    ? 'Drive rechazó la operación. Revisá el acceso y el espacio disponible.'
                    : 'Google Drive no pudo completar la operación. Volvé a intentar.'
        );
    }
}

export class DriveConflictError extends Error {
    constructor(subject: 'estudio' | 'operación' | 'portal' | 'evento' | 'episodio' | 'turno' = 'estudio') {
        const prefix = subject === 'operación' ? 'Esta operación' : subject === 'portal' ? 'Este portal' : subject === 'evento' ? 'Este evento' : subject === 'episodio' ? 'Este episodio' : subject === 'turno' ? 'Este turno' : 'Este estudio';
        super(`${prefix} cambió en Drive. Cerrá la ficha y actualizá la lista antes de volver a editar.`);
    }
}

export class DriveSessionError extends Error {
    constructor() {
        super('Volvé a conectar Google Drive para continuar.');
    }
}

export class DriveClient {
    constructor(private config: Config = CONFIG) {
    }

    private accessToken = '';
    private verifiedAccountId: string | null = null;
    private expires = 0;
    private folderId = '';
    private folderRequest: { token: string; promise: Promise<string> } | null = null;
    private connection: Promise<void> | null = null;
    private listeners = new Set<(signedIn: boolean) => void>();

    get configured(): boolean {
        return /^\d+-[\w-]+\.apps\.googleusercontent\.com$/.test(this.config.GOOGLE_CLIENT_ID);
    }

    get connected(): boolean {
        return Boolean(this.accessToken) && Date.now() < this.expires;
    }

    onAuthChange(callback: (signedIn: boolean) => void): () => void {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    private emitAuthChange(): void {
        this.listeners.forEach((l) => l(this.connected));
    }

    restoreSession(): boolean {
        if (!this.configured) return false;
        try {
            const session = JSON.parse(window.sessionStorage.getItem(getSessionKey(this.config.GOOGLE_CLIENT_ID)) ?? '{}');
            if (
                typeof session?.accessToken !== 'string' ||
                !session.accessToken ||
                !Number.isFinite(session.expires) ||
                session.expires <= Date.now()
            ) {
                this.disconnect();
                return false;
            }
            this.accessToken = session.accessToken;
            this.expires = session.expires;
            this.verifiedAccountId = typeof session.accountId === 'string' && session.accountId ? session.accountId : null;
            this.emitAuthChange();
            return true;
        } catch {
            this.disconnect();
            return false;
        }
    }

    async signIn(): Promise<void> {
        if (this.connected) return;
        if (this.connection) return this.connection;

        const oauth = window.google?.accounts?.oauth2;
        if (!this.configured || !oauth) {
            throw new Error('Google Drive todavía no está disponible. Revisá la configuración o volvé a intentar.');
        }

        this.connection = new Promise<void>((resolve, reject) => {
            const client = oauth.initTokenClient({
                client_id: this.config.GOOGLE_CLIENT_ID,
                scope: SCOPE,
                include_granted_scopes: false,
                callback: (response) => {
                    const duration = Number(response.expires_in) * 1000 - 15_000;
                    if (
                        response.error ||
                        typeof response.access_token !== 'string' ||
                        !response.access_token ||
                        !Number.isFinite(duration) ||
                        duration <= 0 ||
                        !oauth.hasGrantedAllScopes(response, SCOPE)
                    ) {
                        reject(new Error('Google Drive necesita tu autorización para abrir el archivo.'));
                        return;
                    }
                    this.accessToken = response.access_token;
                    this.verifiedAccountId = null;
                    this.expires = Date.now() + duration;
                    this.folderId = '';
                    try {
                        window.sessionStorage.setItem(
                            getSessionKey(this.config.GOOGLE_CLIENT_ID),
                            JSON.stringify({accessToken: this.accessToken, expires: this.expires})
                        );
                    } catch {
                        // Storage blocked, keep in memory
                    }
                    this.emitAuthChange();
                    resolve();
                },
                error_callback: () => {
                    reject(new Error('La ventana de Google se cerró o el navegador la bloqueó. Volvé a intentar.'));
                },
            });
            client.requestAccessToken({prompt: ''});
        }).finally(() => {
            this.connection = null;
        });

        return this.connection;
    }

    async signOut(): Promise<void> {
        this.disconnect();
    }

    private disconnect(): void {
        this.accessToken = '';
        this.verifiedAccountId = null;
        this.expires = 0;
        this.folderId = '';
        try {
            window.sessionStorage.removeItem(getSessionKey(this.config.GOOGLE_CLIENT_ID));
        } catch {
            // Ignore
        }
        this.emitAuthChange();
    }

    async getAccessToken(): Promise<string> {
        if (!this.connected) {
            this.disconnect();
            throw new DriveSessionError();
        }
        return this.accessToken;
    }

    async assertSession(token: string): Promise<void> {
        if (await this.getAccessToken() !== token) throw new DriveSessionError();
    }

    /** Re-throws error unless it's a 409 conflict on a retried create (reserved id). */
    shouldRethrowCreateError(draftCreateId: string | undefined, err: unknown): boolean {
        return !draftCreateId || !(err instanceof DriveError) || err.status !== 409;
    }

    /** Parses JSON description. */
    parseDescription<T>(file: DriveFileResponse, fallbackError: string): T {
        try {
            return JSON.parse(file.description) as T;
        } catch {
            throw new Error(fallbackError);
        }
    }

    async cacheOwner(): Promise<string> {
        const token = await this.getAccessToken();
        if (!this.cachedAccountId()) {
            if (!navigator.onLine) throw new Error('Conectate para verificar tu cuenta de Google Drive.');
            await this.getAccountId();
            await this.assertSession(token);
        }
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([this.cachedAccountId(), token])));
        const owner = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
        await this.assertSession(token);
        await storage.bindStudySession(owner);
        return owner;
    }

    async getAccountId(): Promise<string> {
        const token = await this.getAccessToken();
        const response = await this.request(this.url(DRIVE_ROOT, 'about', {fields: 'user(permissionId,me)'})).then((r) => r.json() as Promise<{
            user?: { permissionId?: unknown; me?: unknown }
        }>);
        if (await this.getAccessToken() !== token) throw new DriveSessionError();
        if (response.user?.me !== true || typeof response.user.permissionId !== 'string' || !response.user.permissionId) {
            throw new Error('No se pudo verificar la cuenta de Google Drive.');
        }
        this.verifiedAccountId = response.user.permissionId;
        try {
            const key = getSessionKey(this.config.GOOGLE_CLIENT_ID);
            const session = JSON.parse(window.sessionStorage.getItem(key) ?? '{}') as {
                accessToken?: string;
                accountId?: string
            };
            if (session.accessToken === token) {
                session.accountId = this.verifiedAccountId;
                window.sessionStorage.setItem(key, JSON.stringify(session));
            }
        } catch { /* Session may be unavailable; keep the verified identity in memory. */
        }
        return response.user.permissionId;
    }

    cachedAccountId(): string | null {
        return this.connected ? this.verifiedAccountId : null;
    }

    async request(url: string, options: RequestInit = {}, expectedToken?: string): Promise<Response> {
        if (!this.connected) {
            this.disconnect();
            throw new DriveSessionError();
        }
        const destination = new URL(url);
        if (destination.origin !== 'https://www.googleapis.com') {
            throw new Error('Google Drive devolvió una dirección inválida.');
        }
        const token = this.accessToken;
        if (expectedToken !== undefined && token !== expectedToken) throw new DriveSessionError();
        const headers = new Headers(options.headers);
        headers.set('Authorization', `Bearer ${token}`);
        let response: Response;
        try {
            response = await fetch(destination, {...options, headers, redirect: 'error', cache: 'no-store'});
        } catch {
            options.signal?.throwIfAborted();
            throw new Error('No se pudo conectar con Google Drive. Revisá tu conexión.');
        }
        if (token !== this.accessToken) throw new DriveSessionError();
        if (response.status === 401) {
            if (token === this.accessToken) this.disconnect();
            throw new DriveSessionError();
        }
        if (!response.ok) throw new DriveError(response.status);
        return response;
    }

    url(root: string, path: string, params: Record<string, string>): string {
        const endpoint = new URL(path, root);
        endpoint.search = new URLSearchParams(params).toString();
        return endpoint.href;
    }

    query(value: string): string {
        return `trashed = false and appProperties has { key='${TAG}' and value='${value}' }`;
    }

    async listFiles(marker: string, fields: string, token: string): Promise<DriveFileResponse[]> {
        const files: DriveFileResponse[] = [];
        let pageToken = '';
        do {
            const response = await this.request(this.url(DRIVE_ROOT, 'files', {
                q: this.query(marker), spaces: 'drive', pageSize: '100', fields: `nextPageToken,files(${fields})`,
                ...(pageToken ? {pageToken} : {}),
            }), {}, token).then((result) => result.json() as Promise<DriveFileResponse>);
            files.push(...(response.files ?? []));
            pageToken = response.nextPageToken ?? '';
        } while (pageToken);
        await this.assertSession(token);
        return files;
    }

    jsonBody(method: string, body: unknown): RequestInit {
        return {method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)};
    }

    parseRecord(file: DriveFileResponse): Study {
        if (!ID_PATTERN.test(file.id) || file.trashed || file.appProperties?.[TAG] !== MARKER) {
            throw new Error('Estudio no disponible.');
        }
        const entry = this.parseDescription<DriveFileMetadata>(file, 'Drive tiene un estudio cuya ficha no se puede leer.');
        let viewer: string;
        try {
            viewer = viewerURL(entry.viewer || '');
        } catch {
            throw new Error('Drive tiene un estudio cuya ficha no se puede leer.');
        }
        const types: unknown = entry.types ?? (entry.type ? [entry.type] : []);
        if (!entry.title || !isValidDate(entry.date) || !Array.isArray(types) || !types.length || types.some((t) => typeof t !== 'string' || !t.trim())) {
            throw new Error('Drive tiene un estudio cuya ficha no se puede leer.');
        }
        return {
            id: file.id,
            title: entry.title,
            date: entry.date,
            types: [...new Set(types)],
            doctor: entry.doctor || '',
            portal: entry.portal || '',
            viewer,
            reportName: file.mimeType === PDF_MIME ? entry.reportName || 'Informe.pdf' : file.mimeType === 'image/jpeg' || file.mimeType === 'image/png' ? entry.reportName || 'Informe' : '',
            hasPdf: file.mimeType === PDF_MIME,
            ...(file.mimeType === 'image/jpeg' || file.mimeType === 'image/png' ? {attachmentMime: file.mimeType} : {}),
            driveFileId: file.id,
            driveModifiedTime: file.modifiedTime ?? '',
            revision: file.version,
            operationId: typeof entry.operationId === 'string' ? entry.operationId : '',
            documentIds: documentAssociationIds(entry.documentIds, file.id),
        };
    }

    async getFolderId(expectedToken?: string): Promise<string> {
        const token = await this.getAccessToken();
        if (expectedToken !== undefined && token !== expectedToken) throw new DriveSessionError();
        if (this.folderId) return this.folderId;
        if (this.folderRequest?.token === token) return this.folderRequest.promise;
        const promise = this.findOrCreateFolder(token);
        this.folderRequest = {token, promise};
        try {
            return await promise;
        } finally {
            if (this.folderRequest?.promise === promise) this.folderRequest = null;
        }
    }

    private async findOrCreateFolder(token: string): Promise<string> {
        const response = await this.request(
            this.url(DRIVE_ROOT, 'files', {
                q: `${this.query(FOLDER_MARKER)} and mimeType = 'application/vnd.google-apps.folder'`,
                fields: 'files(id)',
                orderBy: 'createdTime',
                pageSize: '1',
            })
        ).then((r) => r.json() as Promise<DriveFileResponse>);

        const existing = response.files?.[0];
        if (existing) {
            await this.assertSession(token);
            this.folderId = existing.id;
            return this.folderId;
        }

        await this.assertSession(token);
        const created = await this.request(
            this.url(DRIVE_ROOT, 'files', {fields: 'id'}),
            this.jsonBody('POST', {
                name: 'Mis estudios',
                mimeType: 'application/vnd.google-apps.folder',
                appProperties: {[TAG]: FOLDER_MARKER},
            })
        ).then((r) => r.json() as Promise<DriveFileResponse>);

        await this.assertSession(token);
        this.folderId = created.id;
        return this.folderId;
    }

    async isAlreadyTrashed(id: string, marker: string, expectedToken?: string): Promise<boolean> {
        const file = await this.request(this.url(DRIVE_ROOT, `files/${encodeURIComponent(id)}`, {fields: ENTRY_FIELDS}), {}, expectedToken)
            .then((response) => response.json() as Promise<DriveFileResponse>);
        return file.id === id && file.appProperties?.[TAG] === marker && file.trashed;
    }

    async reserveId(expectedToken?: string): Promise<string> {
        const response = await this.request(
            this.url(DRIVE_ROOT, 'files/generateIds', {count: '1'}), {}, expectedToken
        ).then((r) => r.json() as Promise<{ ids?: string[] }>);

        const ids = response.ids ?? [];
        if (ids.length === 0) throw new Error('Drive no pudo generar un ID.');
        const firstId = ids[0];
        if (!firstId) throw new Error('Drive no pudo generar un ID.');
        return firstId;
    }

    async upload(path: string, method: string, metadata: Record<string, unknown>, media: Blob, mediaType: string, signal?: AbortSignal, expectedToken?: string): Promise<DriveFileResponse> {
        signal?.throwIfAborted();
        const token = await this.getAccessToken();
        if (expectedToken !== undefined && token !== expectedToken) throw new DriveSessionError();
        if (media.size > 5 * 1024 * 1024) {
            const options = this.jsonBody(method, metadata);
            options.signal = signal;
            options.headers = {
                ...options.headers,
                'X-Upload-Content-Type': mediaType,
                'X-Upload-Content-Length': String(media.size)
            };
            const started = await this.request(
                this.url(UPLOAD_ROOT, path, {uploadType: 'resumable', fields: ENTRY_FIELDS}),
                options,
                token
            );
            const location = started.headers.get('Location');
            if (!location) throw new Error('Drive no pudo iniciar la carga del PDF.');
            signal?.throwIfAborted();
            await this.assertSession(token);
            return this.request(location, {
                method: 'PUT',
                headers: {'Content-Type': mediaType},
                body: media,
                signal
            }, token).then((r) => r.json() as Promise<DriveFileResponse>);
        }
        const boundary = `mis-estudios-${crypto.randomUUID()}`;
        const body = new Blob([
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
            JSON.stringify(metadata),
            `\r\n--${boundary}\r\nContent-Type: ${mediaType}\r\n\r\n`,
            media,
            `\r\n--${boundary}--\r\n`,
        ]);
        return this.request(
            this.url(UPLOAD_ROOT, path, {uploadType: 'multipart', fields: ENTRY_FIELDS}),
            {method, headers: {'Content-Type': `multipart/related; boundary=${boundary}`}, body, signal},
            token
        ).then((r) => r.json() as Promise<DriveFileResponse>);
    }
}
