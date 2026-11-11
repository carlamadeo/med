import { CONFIG, type Config } from '@core/config';
import { isValidDate, viewerURL } from '@domain/utils';
import { storage, type StudyRecord } from '@core/storage';
import type { Study, StudyDraft, DriveFileMetadata, StudyRepository, AuthRepository } from '@domain/repository';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_ROOT = 'https://www.googleapis.com/drive/v3/';
const UPLOAD_ROOT = 'https://www.googleapis.com/upload/drive/v3/';
const ENTRY_FIELDS = 'id,description,version,modifiedTime,mimeType,trashed,appProperties';
const TAG = 'misEstudios';
const MARKER = 'estudio-v1';
const FOLDER_MARKER = 'carpeta-v1';
const PDF_MIME = 'application/pdf';
const JSON_MIME = 'application/json';
const ID_PATTERN = /^[\w-]+$/;

function getSessionKey(clientId: string): string {
  return `mis-estudios:drive-session:${clientId}`;
}

interface DriveFileResponse {
  id: string;
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

class DriveError extends Error {
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

/** The study changed in Drive after the caller loaded it (another device or tab). */
export class DriveConflictError extends Error {
  constructor() {
    super('Este estudio cambió en Drive. Cerrá la ficha y actualizá la lista antes de volver a editarlo.');
  }
}

export class DriveSessionError extends Error {
  constructor() {
    super('Volvé a conectar Google Drive para continuar.');
  }
}

export class DriveClient {
  constructor(private config: Config = CONFIG) {}

  private accessToken = '';
  private expires = 0;
  private folderId = '';
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
          this.expires = Date.now() + duration;
          this.folderId = '';
          try {
            window.sessionStorage.setItem(
              getSessionKey(this.config.GOOGLE_CLIENT_ID),
              JSON.stringify({ accessToken: this.accessToken, expires: this.expires })
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
      client.requestAccessToken({ prompt: '' });
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
      throw new DriveSessionError();
    }
    return this.accessToken;
  }

  async request(url: string, options: RequestInit = {}): Promise<Response> {
    if (!this.connected) {
      this.disconnect();
      throw new DriveSessionError();
    }
    const destination = new URL(url);
    if (destination.origin !== 'https://www.googleapis.com') {
      throw new Error('Google Drive devolvió una dirección inválida.');
    }
    const token = this.accessToken;
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${token}`);
    let response: Response;
    try {
      response = await fetch(destination, { ...options, headers, redirect: 'error', cache: 'no-store' });
    } catch {
      throw new Error('No se pudo conectar con Google Drive. Revisá tu conexión.');
    }
    if (response.status === 401) {
      // Only drop the session if nobody reconnected with a newer token while this request was in flight.
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

  jsonBody(method: string, body: unknown): RequestInit {
    return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  }

  parseRecord(file: DriveFileResponse): Study {
    if (!ID_PATTERN.test(file.id) || file.trashed || file.appProperties?.[TAG] !== MARKER) {
      throw new Error('Estudio no disponible.');
    }
    try {
      const entry = JSON.parse(file.description) as DriveFileMetadata;
      const viewer = viewerURL(entry.viewer || '');
      const types: unknown = entry.types ?? (entry.type ? [entry.type] : []);
      if (!entry.title || !isValidDate(entry.date) || !Array.isArray(types) || !types.length || types.some((t) => typeof t !== 'string' || !t.trim())) {
        throw new Error();
      }
      return {
        id: file.id,
        title: entry.title,
        date: entry.date,
        types: [...new Set(types)],
        doctor: entry.doctor || '',
        portal: entry.portal || '',
        viewer,
        reportName: file.mimeType === PDF_MIME ? entry.reportName || 'Informe.pdf' : '',
        hasPdf: file.mimeType === PDF_MIME,
        driveFileId: file.id,
        driveModifiedTime: file.modifiedTime ?? '',
        revision: file.version,
      };
    } catch {
      throw new Error('Drive tiene un estudio cuya ficha no se puede leer.');
    }
  }

  async getFolderId(): Promise<string> {
    if (this.folderId) return this.folderId;
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
      this.folderId = existing.id;
      return this.folderId;
    }

    const created = await this.request(
      this.url(DRIVE_ROOT, 'files', { fields: 'id' }),
      this.jsonBody('POST', {
        name: 'Mis estudios',
        mimeType: 'application/vnd.google-apps.folder',
        appProperties: { [TAG]: FOLDER_MARKER },
      })
    ).then((r) => r.json() as Promise<DriveFileResponse>);

    this.folderId = created.id;
    return this.folderId;
  }

  async reserveId(): Promise<string> {
    const response = await this.request(
      this.url(DRIVE_ROOT, 'files/generateIds', { count: '1' })
    ).then((r) => r.json() as Promise<{ ids?: string[] }>);

    const ids = response.ids ?? [];
    if (ids.length === 0) throw new Error('Drive no pudo generar un ID.');
    const firstId = ids[0];
    if (!firstId) throw new Error('Drive no pudo generar un ID.');
    return firstId;
  }

  async upload(path: string, method: string, metadata: Record<string, unknown>, media: Blob, mediaType: string): Promise<DriveFileResponse> {
    if (media.size > 5 * 1024 * 1024) {
      const options = this.jsonBody(method, metadata);
      options.headers = { ...options.headers, 'X-Upload-Content-Type': mediaType, 'X-Upload-Content-Length': String(media.size) };
      const started = await this.request(
        this.url(UPLOAD_ROOT, path, { uploadType: 'resumable', fields: ENTRY_FIELDS }),
        options
      );
      const location = started.headers.get('Location');
      if (!location) throw new Error('Drive no pudo iniciar la carga del PDF.');
      return this.request(location, { method: 'PUT', headers: { 'Content-Type': mediaType }, body: media }).then((r) => r.json() as Promise<DriveFileResponse>);
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
      this.url(UPLOAD_ROOT, path, { uploadType: 'multipart', fields: ENTRY_FIELDS }),
      { method, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body }
    ).then((r) => r.json() as Promise<DriveFileResponse>);
  }
}

export class DriveAuthRepository implements AuthRepository {
  constructor(private client: DriveClient = new DriveClient()) {}

  get configured(): boolean {
    return this.client.configured;
  }

  get connected(): boolean {
    return this.client.connected;
  }

  isSignedIn(): boolean {
    return this.client.connected;
  }

  onAuthChange(callback: (signedIn: boolean) => void): () => void {
    return this.client.onAuthChange(callback);
  }

  restoreSession(): boolean {
    return this.client.restoreSession();
  }

  async signIn(): Promise<void> {
    return this.client.signIn();
  }

  async signOut(): Promise<void> {
    await this.client.signOut();
    // Medical data must not outlive the session in the browser.
    await storage.clearStudyCache();
  }

  async getAccessToken(): Promise<string> {
    return this.client.getAccessToken();
  }
}

export class DriveStudyRepository implements StudyRepository {
  constructor(private client: DriveClient = new DriveClient()) {}

  private studyToRecord(study: Study): StudyRecord {
    return {
      id: study.id,
      title: study.title,
      date: study.date,
      types: study.types,
      doctor: study.doctor,
      portal: study.portal,
      viewer: study.viewer,
      reportName: study.reportName,
      hasPdf: study.hasPdf,
      driveFileId: study.driveFileId,
      driveModifiedTime: study.driveModifiedTime,
      revision: study.revision,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private recordToStudy(record: StudyRecord): Study {
    return {
      id: record.id,
      title: record.title,
      date: record.date,
      types: record.types,
      doctor: record.doctor,
      portal: record.portal,
      viewer: record.viewer,
      reportName: record.reportName,
      hasPdf: record.hasPdf,
      driveFileId: record.driveFileId,
      driveModifiedTime: record.driveModifiedTime,
      revision: record.revision,
    };
  }

  async list(options: { force?: boolean } = {}): Promise<Study[]> {
    if (!options.force) {
      const cached = await storage.getStudies();
      if (cached.length && !(await storage.isStale())) {
        return cached.map(this.recordToStudy);
      }
    }

    const records: Study[] = [];
    let pageToken = '';
    do {
      const response = await this.client.request(
        this.client.url(DRIVE_ROOT, 'files', {
          q: this.client.query(MARKER),
          spaces: 'drive',
          pageSize: '100',
          fields: `nextPageToken,files(${ENTRY_FIELDS})`,
          ...(pageToken ? { pageToken } : {}),
        })
      ).then((r) => r.json() as Promise<DriveFileResponse>);

      records.push(...(response.files ?? []).map((f) => this.client.parseRecord(f)));
      pageToken = response.nextPageToken ?? '';
    } while (pageToken);

    await storage.replaceStudies(records.map(this.studyToRecord));
    await storage.setLastSync();
    return records;
  }

  private async fetchFile(id: string): Promise<Study> {
    const response = await this.client
      .request(this.client.url(DRIVE_ROOT, `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS }))
      .then((r) => r.json() as Promise<DriveFileResponse>);
    return this.client.parseRecord(response);
  }

  async get(id: string): Promise<Study> {
    const cached = await storage.getStudy(id);
    if (cached) return this.recordToStudy(cached);
    return this.fetchFile(id);
  }

  async reserveId(): Promise<string> {
    return this.client.reserveId();
  }

  async save(draft: StudyDraft): Promise<Study> {
    const isUpdate = Boolean(draft.driveFileId);
    // On edit we must start from what Drive has now, not from what the form remembers.
    const existing = draft.driveFileId ? await this.fetchFile(draft.driveFileId) : null;
    if (existing && existing.revision !== draft.revision) throw new DriveConflictError();
    const id = existing?.id ?? draft.id ?? (await this.client.reserveId());

    const keepPdf = Boolean(existing?.hasPdf) && !draft.file && !draft.removeReport;
    const hasPdf = Boolean(draft.file) || keepPdf;
    const reportName = draft.file?.name ?? (keepPdf ? (existing?.reportName ?? '') : '');

    const payload: DriveFileMetadata = {
      id,
      title: draft.title,
      date: draft.date,
      types: draft.types,
      doctor: draft.doctor,
      portal: draft.portal,
      viewer: draft.viewer,
      reportName,
    };
    const description = JSON.stringify(payload);
    const fileName = `${draft.date} ${draft.title}`.replace(/[\\/]/g, '-') + (hasPdf ? '.pdf' : '.json');

    let response: DriveFileResponse;
    // Same rule as the original: no new file and no PDF to drop means only the ficha changes.
    if (existing && !draft.file && !(draft.removeReport && existing.hasPdf)) {
      // Leave the stored file (and its mimeType) untouched.
      response = await this.client
        .request(
          this.client.url(DRIVE_ROOT, `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS }),
          this.client.jsonBody('PATCH', { name: fileName, description })
        )
        .then((r) => r.json() as Promise<DriveFileResponse>);
    } else {
      const media = draft.file ?? new Blob([description], { type: JSON_MIME });
      const mediaType = draft.file ? PDF_MIME : JSON_MIME;
      const metadata: Record<string, unknown> = { name: fileName, description, mimeType: mediaType };
      if (!isUpdate) {
        metadata.id = id;
        metadata.parents = [await this.client.getFolderId()];
        metadata.appProperties = { [TAG]: MARKER };
      }
      const path = isUpdate ? `files/${encodeURIComponent(id)}` : 'files';
      try {
        response = await this.client.upload(path, isUpdate ? 'PATCH' : 'POST', metadata, media, mediaType);
      } catch (error: unknown) {
        // A retried create may have already landed: accept it only if it is identical.
        if (isUpdate || (error as { status?: number }).status !== 409) throw error;
        response = await this.client
          .request(this.client.url(DRIVE_ROOT, `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS }))
          .then((r) => r.json() as Promise<DriveFileResponse>);
        if (response.description !== description) {
          throw new Error('La carga anterior ya se guardó. Actualizá la lista para revisarla.');
        }
      }
    }

    const saved = this.client.parseRecord(response);
    await storage.setStudies([this.studyToRecord(saved)]);
    return saved;
  }

  async delete(id: string, revision: string): Promise<void> {
    if ((await this.fetchFile(id)).revision !== revision) throw new DriveConflictError();
    await this.client.request(
      this.client.url(DRIVE_ROOT, `files/${encodeURIComponent(id)}`, { fields: 'id' }),
      this.client.jsonBody('PATCH', { trashed: true })
    );
    await storage.deleteStudy(id);
  }

  async getPdfFile(fileId: string): Promise<File> {
    const response = await this.client.request(
      this.client.url(DRIVE_ROOT, `files/${encodeURIComponent(fileId)}`, { alt: 'media' })
    );
    const blob = await response.blob();
    return new File([blob], 'informe.pdf', { type: PDF_MIME });
  }
}

// One client for both repositories: the token obtained by signIn() must be the one used for requests.
const driveClient = new DriveClient();
export const driveAuth = new DriveAuthRepository(driveClient);
export const driveStudyRepo = new DriveStudyRepository(driveClient);