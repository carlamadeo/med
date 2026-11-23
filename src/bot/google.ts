import {createHash, randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {CALENDAR_SCOPE, DRIVE_SCOPE, DriveClient, DriveSessionError} from '@data/drive-api';
import {DriveAppointmentRepository} from '@data/drive-appointment-repository';
import {DriveStudyRepository} from '@data/drive-study-repository';
import {GoogleCalendarRepository} from '@data/google-calendar';
import {appointmentDraft, CalendarSyncPending, type DocumentRef, type Draft} from './conversation';
import {readJson, writeJson} from './private-state';

type Credentials = {client_id: string; client_secret: string};
type Tokens = {access_token: string; refresh_token?: string; scope?: string; expires_in: number};
type Authorization = {refreshToken: string; folderId: string; calendar: boolean};

const DRIVE_API = 'https://www.googleapis.com/drive/v3/';

class BotDriveClient extends DriveClient {
    constructor(private token: string, private folder: string, private calendar: boolean) {
        super();
    }

    override get connected(): boolean {
        return Boolean(this.token);
    }

    protected override get requestToken(): string {
        return this.token;
    }

    override request(url: string, options: RequestInit = {}, expectedToken?: string): Promise<Response> {
        const signal = options.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(60_000)])
            : AbortSignal.timeout(60_000);
        return super.request(url, {...options, signal}, expectedToken);
    }

    override get hasCalendarAccess(): boolean {
        return this.calendar;
    }

    override async getFolderId(expectedToken?: string): Promise<string> {
        if (expectedToken !== undefined && expectedToken !== this.token) throw new DriveSessionError();
        return this.folder;
    }
}

async function credentials(directory: string): Promise<Credentials> {
    const {installed} = JSON.parse(await readFile(join(directory, 'google-client.json'), 'utf8')) as {installed?: Partial<Credentials>};
    if (!installed?.client_id || !installed.client_secret) throw new Error('El archivo google-client.json debe ser de un cliente OAuth de escritorio.');
    return {client_id: installed.client_id, client_secret: installed.client_secret};
}

async function exchange(client: Credentials, fields: Record<string, string>): Promise<Tokens> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        body: new URLSearchParams({...client, ...fields}),
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error('Google rechazó la autorización. Volvé a ejecutar el comando authorize si el permiso venció.');
    const tokens = await response.json() as Tokens;
    if (!tokens.access_token) throw new Error('Google no devolvió un token de acceso.');
    return tokens;
}

function openAuthorization(clientId: string, calendar: boolean): Promise<{code: string; redirectUri: string; verifier: string}> {
    const verifier = randomBytes(32).toString('base64url');
    const state = randomBytes(32).toString('base64url');
    return new Promise((resolve, reject) => {
        let redirectUri = '';
        const server = createServer((request, response) => {
            const callback = new URL(request.url ?? '/', redirectUri);
            if (callback.pathname !== '/oauth' || callback.searchParams.get('state') !== state) {
                response.writeHead(400).end('Solicitud inválida.');
                return;
            }
            const code = callback.searchParams.get('code');
            response.writeHead(code ? 200 : 400, {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'});
            response.end(code ? 'Google devolvió el permiso. Volvé a la terminal para ver el resultado.' : 'Google no concedió el permiso.');
            server.close();
            if (code) resolve({code, redirectUri, verifier});
            else reject(new Error('Google no concedió el permiso.'));
        });
        const timeout = setTimeout(() => {
            server.close();
            reject(new Error('La autorización de Google venció.'));
        }, 5 * 60_000);
        server.once('close', () => clearTimeout(timeout));
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close();
                reject(new Error('No pude abrir el puerto local de autorización.'));
                return;
            }
            redirectUri = `http://127.0.0.1:${address.port}/oauth`;
            const consent = new URL('https://accounts.google.com/o/oauth2/v2/auth');
            consent.search = new URLSearchParams({
                client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
                scope: calendar ? `${DRIVE_SCOPE} ${CALENDAR_SCOPE}` : DRIVE_SCOPE, access_type: 'offline',
                prompt: 'consent select_account', state, code_challenge_method: 'S256',
                code_challenge: createHash('sha256').update(verifier).digest('base64url'),
            }).toString();
            console.log(`Abrí este enlace y elegí la cuenta que usás en Mis estudios:\n${consent.href}`);
        });
    });
}

export async function authorizeGoogle(directory: string, calendar: boolean): Promise<void> {
    const client = await credentials(directory);
    const {code, redirectUri, verifier} = await openAuthorization(client.client_id, calendar);
    const tokens = await exchange(client, {
        code, redirect_uri: redirectUri, code_verifier: verifier, grant_type: 'authorization_code',
    });
    const scopes = new Set(tokens.scope?.split(' '));
    if (!tokens.refresh_token || !scopes.has(DRIVE_SCOPE)) throw new Error('Google no concedió el acceso persistente a Drive.');
    const drive = new BotDriveClient(tokens.access_token, '', false);
    const {files} = await drive.request(drive.url(DRIVE_API, 'files', {
        q: `${drive.query('carpeta-v1')} and mimeType = 'application/vnd.google-apps.folder'`,
        fields: 'files(id)', orderBy: 'createdTime', pageSize: '1',
    }), {signal: AbortSignal.timeout(20_000)}).then(response => response.json() as Promise<{files?: Array<{id: string}>}>);
    const folderId = files?.[0]?.id;
    if (!folderId) throw new Error('No encontré la carpeta que usa Mis estudios. Verificá que sea la misma cuenta y que el cliente de escritorio pertenezca al mismo proyecto de Google Cloud.');
    const authorization = {refreshToken: tokens.refresh_token, calendar: calendar && scopes.has(CALENDAR_SCOPE), folderId};
    await writeJson(join(directory, 'google-authorization.json'), authorization);
    console.log(authorization.calendar ? 'Drive y Calendar autorizados.' : 'Drive autorizado.');
}

export async function googleServices(directory: string, download: (document: DocumentRef) => Promise<File>) {
    const client = await credentials(directory);
    const auth = await readJson<Authorization>(join(directory, 'google-authorization.json'));
    if (!auth?.refreshToken || !/^[\w-]+$/.test(auth.folderId)) throw new Error('Primero autorizá Google con el comando authorize.');
    const {folderId, refreshToken, calendar} = auth;
    let cached: {token: string; expires: number} | undefined;
    async function drive(): Promise<DriveClient> {
        if (!cached || cached.expires <= Date.now()) {
            const tokens = await exchange(client, {refresh_token: refreshToken, grant_type: 'refresh_token'});
            cached = {token: tokens.access_token, expires: Date.now() + tokens.expires_in * 1000 - 60_000};
        }
        return new BotDriveClient(cached.token, folderId, calendar);
    }
    return {
        folderId,
        reserve: async () => (await drive()).reserveId(),
        async save(draft: Draft): Promise<string> {
            if (!draft.recordId) throw new Error('Falta reservar el identificador en Drive.');
            const driveClient = await drive();
            if (draft.kind === 'study') {
                const file = draft.document ? await download(draft.document) : undefined;
                await new DriveStudyRepository(driveClient, false).save({
                    ...draft.fields, id: draft.recordId, reportName: file?.name ?? '', file,
                });
                return 'Estudio guardado en Mis estudios.';
            }
            const appointment = await new DriveAppointmentRepository(driveClient, false).save({
                ...appointmentDraft(draft.fields), createId: draft.recordId,
            });
            try {
                const result = await new GoogleCalendarRepository(driveClient).syncAppointment(appointment);
                return result === 'synced' ? 'Turno guardado en Mis estudios y en Google Calendar.' : 'Turno guardado en Mis estudios.';
            } catch (error) {
                throw new CalendarSyncPending('Falló la sincronización con Calendar.', {cause: error});
            }
        },
    };
}
