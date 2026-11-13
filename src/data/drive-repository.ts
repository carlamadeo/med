import { CONFIG, type Config } from '@core/config';
import { isValidDate, viewerURL } from '@domain/utils';
import { documentAssociationIds } from '@domain/document-compatibility';
import { storage, type StudyRecord } from '@core/storage';
import type { Study, StudyDraft, Operation, OperationDraft, Portal, PortalDraft, DriveFileMetadata, StudyRepository, AuthRepository, IntakeCandidate } from '@domain/repository';
import type { MedicalEvent, MedicalEventDraft } from '@domain/models';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_ROOT = 'https://www.googleapis.com/drive/v3/';
const UPLOAD_ROOT = 'https://www.googleapis.com/upload/drive/v3/';
const ENTRY_FIELDS = 'id,description,version,modifiedTime,mimeType,trashed,appProperties';
const TAG = 'misEstudios';
const MARKER = 'estudio-v1';
const OPERATION_MARKER = 'operacion-v1';
const PORTAL_MARKER = 'portal-v1';
const EVENT_MARKER = 'evento-medico-v1';
const FOLDER_MARKER = 'carpeta-v1';
const PDF_MIME = 'application/pdf';
const JSON_MIME = 'application/json';
const ID_PATTERN = /^[\w-]+$/;

function getSessionKey(clientId: string): string {
  return `mis-estudios:drive-session:${clientId}`;
}

interface DriveFileResponse {
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
  constructor(subject: 'estudio' | 'operación' | 'portal' | 'evento' = 'estudio') {
    const prefix = subject === 'operación' ? 'Esta operación' : subject === 'portal' ? 'Este portal' : subject === 'evento' ? 'Este evento' : 'Este estudio';
    super(`${prefix} cambió en Drive. Cerrá la ficha y actualizá la lista antes de volver a editar.`);
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
  private verifiedAccountId: string | null = null;
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
    const response = await this.request(this.url(DRIVE_ROOT, 'about', { fields: 'user(permissionId,me)' })).then((r) => r.json() as Promise<{ user?: { permissionId?: unknown; me?: unknown } }>);
    if (await this.getAccessToken() !== token) throw new DriveSessionError();
    if (response.user?.me !== true || typeof response.user.permissionId !== 'string' || !response.user.permissionId) {
      throw new Error('No se pudo verificar la cuenta de Google Drive.');
    }
    this.verifiedAccountId = response.user.permissionId;
    try {
      const key = getSessionKey(this.config.GOOGLE_CLIENT_ID);
      const session = JSON.parse(window.sessionStorage.getItem(key) ?? '{}') as { accessToken?: string; accountId?: string };
      if (session.accessToken === token) { session.accountId = this.verifiedAccountId; window.sessionStorage.setItem(key, JSON.stringify(session)); }
    } catch { /* Session may be unavailable; keep the verified identity in memory. */ }
    return response.user.permissionId;
  }

  cachedAccountId(): string | null { return this.connected ? this.verifiedAccountId : null; }

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
      options.signal?.throwIfAborted();
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
        reportName: file.mimeType === PDF_MIME ? entry.reportName || 'Informe.pdf' : '',
        hasPdf: file.mimeType === PDF_MIME,
        driveFileId: file.id,
        driveModifiedTime: file.modifiedTime ?? '',
        revision: file.version,
        operationId: typeof entry.operationId === 'string' ? entry.operationId : '',
        documentIds: documentAssociationIds(entry.documentIds, file.id),
      };
    } catch (err) {
      if (err instanceof Error && err.message === 'Drive tiene un estudio cuya ficha no se puede leer.') throw err;
      throw new Error('Drive tiene un estudio cuya ficha no se puede leer.');
    }
  }

  async getFolderId(): Promise<string> {
    if (this.folderId) return this.folderId;
    const token = await this.getAccessToken();
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
      this.url(DRIVE_ROOT, 'files', { fields: 'id' }),
      this.jsonBody('POST', {
        name: 'Mis estudios',
        mimeType: 'application/vnd.google-apps.folder',
        appProperties: { [TAG]: FOLDER_MARKER },
      })
    ).then((r) => r.json() as Promise<DriveFileResponse>);

    await this.assertSession(token);
    this.folderId = created.id;
    return this.folderId;
  }

  async isAlreadyTrashed(id: string, marker: string): Promise<boolean> {
    const file = await this.request(this.url(DRIVE_ROOT, `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS }))
      .then((response) => response.json() as Promise<DriveFileResponse>);
    return file.id === id && file.appProperties?.[TAG] === marker && file.trashed;
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

  async upload(path: string, method: string, metadata: Record<string, unknown>, media: Blob, mediaType: string, signal?: AbortSignal): Promise<DriveFileResponse> {
    signal?.throwIfAborted();
    if (media.size > 5 * 1024 * 1024) {
      const options = this.jsonBody(method, metadata);
      options.signal = signal;
      options.headers = { ...options.headers, 'X-Upload-Content-Type': mediaType, 'X-Upload-Content-Length': String(media.size) };
      const started = await this.request(
        this.url(UPLOAD_ROOT, path, { uploadType: 'resumable', fields: ENTRY_FIELDS }),
        options
      );
      const location = started.headers.get('Location');
      if (!location) throw new Error('Drive no pudo iniciar la carga del PDF.');
      signal?.throwIfAborted();
      return this.request(location, { method: 'PUT', headers: { 'Content-Type': mediaType }, body: media, signal }).then((r) => r.json() as Promise<DriveFileResponse>);
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
      { method, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body, signal }
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

  async getAccountId(): Promise<string> {
    return this.client.getAccountId();
  }

  cachedAccountId(): string | null { return this.client.cachedAccountId(); }
}

export class DriveStudyRepository implements StudyRepository {
  constructor(private client: DriveClient = new DriveClient()) {}

  private async cacheOwner(): Promise<string> {
    return this.client.cacheOwner();
  }

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
      operationId: study.operationId,
      documentIds: study.documentIds,
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
      operationId: record.operationId,
      documentIds: documentAssociationIds(record.documentIds, record.id),
    };
  }

  async list(options: { force?: boolean } = {}): Promise<Study[]> {
    const owner = await this.cacheOwner();
    if (!options.force || !navigator.onLine) {
      const cached = await storage.readCompleteSessionStudies(owner);
      if (cached && (!navigator.onLine || Date.now() - cached.lastSync <= 24 * 60 * 60 * 1000)) {
        return cached.records.map(this.recordToStudy);
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

    await storage.writeSessionStudies(owner, records.map(this.studyToRecord), true);
    return records;
  }

  private async fetchFile(id: string): Promise<Study> {
    const response = await this.client
      .request(this.client.url(DRIVE_ROOT, `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS }))
      .then((r) => r.json() as Promise<DriveFileResponse>);
    return this.client.parseRecord(response);
  }

  async get(id: string): Promise<Study> {
    const owner = await this.cacheOwner();
    const cached = (await storage.readSessionStudies(owner))?.find((record) => record.id === id);
    if (cached) return this.recordToStudy(cached);
    return this.fetchFile(id);
  }

  async reserveId(): Promise<string> {
    return this.client.reserveId();
  }

  async save(draft: StudyDraft): Promise<Study> {
    const token = await this.client.getAccessToken();
    const owner = await this.cacheOwner();
    const isUpdate = Boolean(draft.driveFileId);
    // On edit we must start from what Drive has now, not from what the form remembers.
    const existing = draft.driveFileId ? await this.fetchFile(draft.driveFileId) : null;
    if (existing && existing.revision !== draft.revision) throw new DriveConflictError();
    if (existing?.hasPdf && (draft.file || draft.removeReport)) {
      const events = await new DriveMedicalEventRepository(this.client).list();
      if (events.some((event) => event.documentIds.includes(existing.id))) throw new Error('Desvinculá el documento de los eventos antes de reemplazarlo o quitarlo.');
      const linkedStudies = await this.list({ force: true });
      if (linkedStudies.some((study) => study.id !== existing.id && study.documentIds?.includes(existing.id))) {
        throw new Error('Desvinculá el documento de los otros estudios antes de reemplazarlo o quitarlo.');
      }
    }
    const id = existing?.id ?? draft.id ?? (await this.client.reserveId());
    const documentIds = documentAssociationIds(draft.documentIds ?? existing?.documentIds, id);
    if (documentIds.length) {
      const available = await this.list({ force: true });
      if (documentIds.some((documentId) => !available.some((study) => study.id === documentId && study.hasPdf))) {
        throw new Error('Un documento vinculado ya no está disponible en esta cuenta.');
      }
    }

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
      operationId: draft.operationId ?? existing?.operationId ?? '',
      documentIds,
    };
    const description = JSON.stringify(payload);
    const fileName = `${draft.date} ${draft.title}`.replace(/[\\/]/g, '-') + (hasPdf ? '.pdf' : '.json');

    let response: DriveFileResponse;
    // Same rule as the original: no new file and no PDF to drop means only the ficha changes.
    if (existing && !draft.file && !(draft.removeReport && existing.hasPdf)) {
      // Leave the stored file (and its mimeType) untouched.
      await this.client.assertSession(token);
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
      await this.client.assertSession(token);
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
        if (draft.file) {
          if (response.mimeType !== PDF_MIME) throw new Error('La carga anterior es diferente. Actualizá la lista para revisarla.');
          const remoteFile = await this.getPdfFile(id);
          const [localDigest, remoteDigest] = await Promise.all([
            draft.file.arrayBuffer().then((bytes) => crypto.subtle.digest('SHA-256', bytes)),
            remoteFile.arrayBuffer().then((bytes) => crypto.subtle.digest('SHA-256', bytes)),
          ]);
          if (!new Uint8Array(localDigest).every((byte, index) => byte === new Uint8Array(remoteDigest)[index])) {
            throw new Error('La carga anterior es diferente. Actualizá la lista para revisarla.');
          }
          await this.client.assertSession(token);
        }
      }
    }

    const saved = this.client.parseRecord(response);
    await storage.writeSessionStudies(owner, [this.studyToRecord(saved)]);
    return saved;
  }

  async delete(id: string, revision: string): Promise<void> {
    const token = await this.client.getAccessToken();
    const owner = await this.cacheOwner();
    if (await this.client.isAlreadyTrashed(id, MARKER)) {
      await this.client.assertSession(token);
      await storage.deleteSessionStudy(owner, id);
      return;
    }
    if ((await this.fetchFile(id)).revision !== revision) throw new DriveConflictError();
    const events = await new DriveMedicalEventRepository(this.client).list();
    if (events.some((event) => event.studyIds.includes(id) || event.documentIds.includes(id))) {
      throw new Error('Desvinculá el estudio y su documento de los eventos antes de eliminarlo.');
    }
    const linkedStudies = await this.list({ force: true });
    if (linkedStudies.some((study) => study.id !== id && study.documentIds?.includes(id))) {
      throw new Error('Desvinculá el documento de los otros estudios antes de eliminarlo.');
    }
    await this.client.assertSession(token);
    await this.client.request(
      this.client.url(DRIVE_ROOT, `files/${encodeURIComponent(id)}`, { fields: 'id' }),
      this.client.jsonBody('PATCH', { trashed: true })
    );
    await storage.deleteSessionStudy(owner, id);
  }

  async getPdfFile(fileId: string): Promise<File> {
    const response = await this.client.request(
      this.client.url(DRIVE_ROOT, `files/${encodeURIComponent(fileId)}`, { alt: 'media' })
    );
    const blob = await response.blob();
    return new File([blob], 'informe.pdf', { type: PDF_MIME });
  }
}

export class DriveOperationRepository {
  constructor(private client: DriveClient) {}

  private parse(file: DriveFileResponse): Operation {
    if (!ID_PATTERN.test(file.id) || file.trashed || file.appProperties?.[TAG] !== OPERATION_MARKER) throw new Error('Operación no disponible.');
    try {
      const value = JSON.parse(file.description) as OperationDraft;
      if (typeof value.name !== 'string' || !value.name.trim()) throw new Error('Drive tiene una operación cuya ficha no se puede leer.');
      return { id: file.id, name: value.name, date: value.date ?? '', surgeon: value.surgeon ?? '', institution: value.institution ?? '', type: value.type ?? '', notes: value.notes ?? '', color: value.color ?? '', studyIds: [], revision: file.version };
    } catch (err) {
      if (err instanceof Error && err.message === 'Drive tiene una operación cuya ficha no se puede leer.') throw err;
      throw new Error('Drive tiene una operación cuya ficha no se puede leer.');
    }
  }

  async list(): Promise<Operation[]> {
    const owner = await this.client.cacheOwner();
    if (!navigator.onLine) {
      const cached = await storage.readSessionDirectory<Operation>(owner, 'operationsCache');
      if (cached) return cached;
    }
    const result: Operation[] = [];
    let pageToken = '';
    do {
      const response = await this.client.request(this.client.url(DRIVE_ROOT, 'files', {
        q: this.client.query(OPERATION_MARKER), spaces: 'drive', pageSize: '100', fields: `nextPageToken,files(${ENTRY_FIELDS})`, ...(pageToken ? { pageToken } : {}),
      })).then((r) => r.json() as Promise<DriveFileResponse>);
      result.push(...(response.files ?? []).map((file) => this.parse(file)));
      pageToken = response.nextPageToken ?? '';
    } while (pageToken);
    await storage.writeSessionDirectory(owner, 'operationsCache', result);
    return result;
  }

  async get(id: string): Promise<Operation> {
    const file = await this.client.request(this.client.url(DRIVE_ROOT, `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS })).then((r) => r.json() as Promise<DriveFileResponse>);
    return this.parse(file);
  }

  async save(draft: OperationDraft): Promise<Operation> {
    const token = await this.client.getAccessToken();
    const owner = await this.client.cacheOwner();
    const name = draft.name.trim();
    if (!name) throw new Error('Ingresá un nombre para la operación.');
    if (draft.date && !isValidDate(draft.date)) throw new Error('Ingresá una fecha válida.');
    const payload = { name, date: draft.date ?? '', surgeon: draft.surgeon ?? '', institution: draft.institution ?? '', type: draft.type ?? '', notes: draft.notes ?? '', color: draft.color ?? '' };
    const description = JSON.stringify(payload);
    let response: DriveFileResponse;
    if (draft.id) {
      const existing = await this.get(draft.id);
      if (!draft.revision || existing.revision !== draft.revision) throw new DriveConflictError('operación');
      await this.client.assertSession(token);
      response = await this.client.request(this.client.url(DRIVE_ROOT, `files/${encodeURIComponent(draft.id)}`, { fields: ENTRY_FIELDS }), this.client.jsonBody('PATCH', { name, description })).then((r) => r.json() as Promise<DriveFileResponse>);
    } else {
      const id = draft.createId ?? await this.client.reserveId();
      const folder = await this.client.getFolderId();
      await this.client.assertSession(token);
      try {
        response = await this.client.upload('files', 'POST', { id, name, description, mimeType: JSON_MIME, parents: [folder], appProperties: { [TAG]: OPERATION_MARKER } }, new Blob([description], { type: JSON_MIME }), JSON_MIME);
      } catch (err) {
        if (!draft.createId || !(err instanceof DriveError) || err.status !== 409) throw err;
        response = await this.client.request(this.client.url(DRIVE_ROOT, `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS })).then((r) => r.json() as Promise<DriveFileResponse>);
        if (response.description !== description) throw new DriveConflictError('operación');
      }
    }
    const saved = this.parse(response);
    await this.client.assertSession(token);
    const cached = await storage.readSessionDirectory<Operation>(owner, 'operationsCache');
    if (cached) await storage.writeSessionDirectory(owner, 'operationsCache', [...cached.filter((item) => item.id !== saved.id), saved]);
    return saved;
  }

  async delete(id: string, revision: string): Promise<void> {
    const token = await this.client.getAccessToken();
    const owner = await this.client.cacheOwner();
    if (await this.client.isAlreadyTrashed(id, OPERATION_MARKER)) {
      await this.client.assertSession(token);
      const cached = await storage.readSessionDirectory<Operation>(owner, 'operationsCache');
      if (cached) await storage.writeSessionDirectory(owner, 'operationsCache', cached.filter((item) => item.id !== id));
      return;
    }
    if (!revision || (await this.get(id)).revision !== revision) throw new DriveConflictError('operación');
    const studies = await new DriveStudyRepository(this.client).list({ force: true });
    if (studies.some((study) => study.operationId === id)) throw new Error('Desvinculá los estudios antes de eliminar esta operación.');
    await this.client.assertSession(token);
    await this.client.request(this.client.url(DRIVE_ROOT, `files/${encodeURIComponent(id)}`, { fields: 'id' }), this.client.jsonBody('PATCH', { trashed: true }));
    await this.client.assertSession(token);
    const cached = await storage.readSessionDirectory<Operation>(owner, 'operationsCache');
    if (cached) await storage.writeSessionDirectory(owner, 'operationsCache', cached.filter((item) => item.id !== id));
  }
}

export class DrivePortalRepository {
  constructor(private client: DriveClient) {}
  private parse(file: DriveFileResponse): Portal {
    if (!ID_PATTERN.test(file.id) || file.trashed || file.appProperties?.[TAG] !== PORTAL_MARKER) throw new Error('Portal no disponible.');
    try {
      const item = JSON.parse(file.description) as PortalDraft;
      if (typeof item.displayName !== 'string' || !item.displayName.trim() || typeof item.name !== 'string') throw new Error('Drive tiene un portal cuya ficha no se puede leer.');
      return { id: file.id, name: item.name, displayName: item.displayName, url: viewerURL(item.url ?? ''), notes: item.notes ?? '', revision: file.version };
    } catch (err) {
      if (err instanceof Error && err.message === 'Drive tiene un portal cuya ficha no se puede leer.') throw err;
      throw new Error('Drive tiene un portal cuya ficha no se puede leer.');
    }
  }
  async list(): Promise<Portal[]> {
    const owner = await this.client.cacheOwner();
    if (!navigator.onLine) {
      const cached = await storage.readSessionDirectory<Portal>(owner, 'portalsCache');
      if (cached) return cached;
    }
    const items: Portal[] = []; let pageToken = '';
    do {
      const response = await this.client.request(this.client.url(DRIVE_ROOT, 'files', { q: this.client.query(PORTAL_MARKER), spaces: 'drive', pageSize: '100', fields: `nextPageToken,files(${ENTRY_FIELDS})`, ...(pageToken ? { pageToken } : {}) })).then((r) => r.json() as Promise<DriveFileResponse>);
      items.push(...(response.files ?? []).map((file) => this.parse(file))); pageToken = response.nextPageToken ?? '';
    } while (pageToken);
    await storage.writeSessionDirectory(owner, 'portalsCache', items);
    return items;
  }
  private async get(id: string): Promise<Portal> {
    return this.parse(await this.client.request(this.client.url(DRIVE_ROOT, `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS })).then((r) => r.json() as Promise<DriveFileResponse>));
  }
  async save(draft: PortalDraft): Promise<Portal> {
    const token = await this.client.getAccessToken();
    const owner = await this.client.cacheOwner();
    const displayName = draft.displayName.trim();
    if (!displayName) throw new Error('Ingresá un nombre para el portal.');
    const payload = { name: draft.name.trim() || displayName, displayName, url: viewerURL(draft.url.trim()), notes: draft.notes?.trim() ?? '' };
    const description = JSON.stringify(payload);
    let file: DriveFileResponse;
    if (draft.id) {
      const existing = await this.get(draft.id);
      if (!draft.revision || existing.revision !== draft.revision) throw new DriveConflictError('portal');
      await this.client.assertSession(token);
      file = await this.client.request(this.client.url(DRIVE_ROOT, `files/${encodeURIComponent(draft.id)}`, { fields: ENTRY_FIELDS }), this.client.jsonBody('PATCH', { name: displayName, description })).then((r) => r.json() as Promise<DriveFileResponse>);
    } else {
      const id = draft.createId ?? await this.client.reserveId();
      const folder = await this.client.getFolderId();
      await this.client.assertSession(token);
      try {
        file = await this.client.upload('files', 'POST', { id, name: displayName, description, mimeType: JSON_MIME, parents: [folder], appProperties: { [TAG]: PORTAL_MARKER } }, new Blob([description], { type: JSON_MIME }), JSON_MIME);
      } catch (err) {
        if (!draft.createId || !(err instanceof DriveError) || err.status !== 409) throw err;
        file = await this.client.request(this.client.url(DRIVE_ROOT, `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS })).then((r) => r.json() as Promise<DriveFileResponse>);
        if (file.description !== description) throw new DriveConflictError('portal');
      }
    }
    const saved = this.parse(file);
    await this.client.assertSession(token);
    const cached = await storage.readSessionDirectory<Portal>(owner, 'portalsCache');
    if (cached) await storage.writeSessionDirectory(owner, 'portalsCache', [...cached.filter((item) => item.id !== saved.id), saved]);
    return saved;
  }
  async delete(portal: Portal): Promise<void> {
    const token = await this.client.getAccessToken();
    const owner = await this.client.cacheOwner();
    if (!portal.id) throw new Error('Portal no disponible.');
    if (await this.client.isAlreadyTrashed(portal.id, PORTAL_MARKER)) {
      await this.client.assertSession(token);
      const cached = await storage.readSessionDirectory<Portal>(owner, 'portalsCache');
      if (cached) await storage.writeSessionDirectory(owner, 'portalsCache', cached.filter((item) => item.id !== portal.id));
      return;
    }
    const existing = await this.get(portal.id);
    if (!portal.revision || existing.revision !== portal.revision) throw new DriveConflictError('portal');
    await this.client.assertSession(token);
    await this.client.request(this.client.url(DRIVE_ROOT, `files/${encodeURIComponent(portal.id)}`, { fields: 'id' }), this.client.jsonBody('PATCH', { trashed: true }));
    await this.client.assertSession(token);
    const cached = await storage.readSessionDirectory<Portal>(owner, 'portalsCache');
    if (cached) await storage.writeSessionDirectory(owner, 'portalsCache', cached.filter((item) => item.id !== portal.id));
  }
}

export class DriveMedicalEventRepository {
  constructor(private client: DriveClient) {}

  private parse(file: DriveFileResponse): MedicalEvent {
    if (!ID_PATTERN.test(file.id) || file.trashed || file.appProperties?.[TAG] !== EVENT_MARKER) throw new Error('Evento no disponible.');
    const item = JSON.parse(file.description) as MedicalEventDraft;
    if (!['consultation', 'prescription'].includes(item.kind) || !isValidDate(item.date) ||
        !Array.isArray(item.studyIds) || !Array.isArray(item.documentIds) ||
        [...item.studyIds, ...item.documentIds].some((id) => typeof id !== 'string' || !ID_PATTERN.test(id))) {
      throw new Error('Drive tiene un evento cuya ficha no se puede leer.');
    }
    return { id: file.id, kind: item.kind, date: item.date, doctor: item.doctor ?? '', notes: item.notes ?? '',
      studyIds: [...new Set(item.studyIds)], documentIds: [...new Set(item.documentIds)], revision: file.version };
  }

  async list(): Promise<MedicalEvent[]> {
    const owner = await this.client.cacheOwner();
    if (!navigator.onLine) {
      const cached = await storage.readSessionDirectory<MedicalEvent>(owner, 'eventsCache');
      if (cached) return cached;
    }
    const items: MedicalEvent[] = [];
    let pageToken = '';
    do {
      const response = await this.client.request(this.client.url(DRIVE_ROOT, 'files', {
        q: this.client.query(EVENT_MARKER), spaces: 'drive', pageSize: '100', fields: `nextPageToken,files(${ENTRY_FIELDS})`,
        ...(pageToken ? { pageToken } : {}),
      })).then((r) => r.json() as Promise<DriveFileResponse>);
      items.push(...(response.files ?? []).map((file) => this.parse(file)));
      pageToken = response.nextPageToken ?? '';
    } while (pageToken);
    await storage.writeSessionDirectory(owner, 'eventsCache', items);
    return items;
  }

  async save(draft: MedicalEventDraft): Promise<MedicalEvent> {
    if (!['consultation', 'prescription'].includes(draft.kind) || !isValidDate(draft.date)) throw new Error('Ingresá una fecha y un tipo de evento válidos.');
    const token = await this.client.getAccessToken();
    const owner = await this.client.cacheOwner();
    const available = await new DriveStudyRepository(this.client).list();
    const studyIds = [...new Set(draft.studyIds)];
    const documentIds = [...new Set(draft.documentIds)];
    if (studyIds.some((id) => !available.some((study) => study.id === id)) ||
        documentIds.some((id) => !available.some((study) => study.id === id && study.hasPdf))) {
      throw new Error('Uno de los estudios o documentos ya no está disponible en esta cuenta.');
    }
    const description = JSON.stringify({ kind: draft.kind, date: draft.date, doctor: draft.doctor, notes: draft.notes, studyIds, documentIds });
    let file: DriveFileResponse;
    if (draft.id) {
      const existing = await this.client.request(this.client.url(DRIVE_ROOT, `files/${encodeURIComponent(draft.id)}`, { fields: ENTRY_FIELDS })).then((r) => r.json() as Promise<DriveFileResponse>);
      if (!draft.revision || this.parse(existing).revision !== draft.revision) throw new DriveConflictError('evento');
      await this.client.assertSession(token);
      file = await this.client.request(this.client.url(DRIVE_ROOT, `files/${encodeURIComponent(draft.id)}`, { fields: ENTRY_FIELDS }), this.client.jsonBody('PATCH', { description })).then((r) => r.json() as Promise<DriveFileResponse>);
    } else {
      const id = draft.createId ?? await this.client.reserveId();
      const folder = await this.client.getFolderId();
      await this.client.assertSession(token);
      try {
        file = await this.client.upload('files', 'POST', { id, name: `${draft.date} ${draft.kind}`, description, mimeType: JSON_MIME, parents: [folder], appProperties: { [TAG]: EVENT_MARKER } }, new Blob([description], { type: JSON_MIME }), JSON_MIME);
      } catch (err) {
        if (!draft.createId || !(err instanceof DriveError) || err.status !== 409) throw err;
        file = await this.client.request(this.client.url(DRIVE_ROOT, `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS })).then((r) => r.json() as Promise<DriveFileResponse>);
        if (file.description !== description) throw new DriveConflictError('evento');
      }
    }
    const saved = this.parse(file);
    await this.client.assertSession(token);
    const cached = await storage.readSessionDirectory<MedicalEvent>(owner, 'eventsCache');
    if (cached) await storage.writeSessionDirectory(owner, 'eventsCache', [...cached.filter((item) => item.id !== saved.id), saved]);
    return saved;
  }
}

export class DriveIntakeRepository {
  constructor(private client: DriveClient) {}

  private parseCandidate(file: DriveFileResponse): IntakeCandidate {
    return {
      id: file.id,
      name: file.description ? JSON.parse(file.description).title || file.name : file.name,
      mimeType: file.mimeType,
      modifiedTime: file.modifiedTime ?? '',
      size: 0, // Drive doesn't return size in list, would need separate call
      status: 'new',
    };
  }

  async listCandidates(folderId: string): Promise<IntakeCandidate[]> {
    const owner = await this.client.cacheOwner();
    const candidates: IntakeCandidate[] = [];
    let pageToken = '';
    const query = `'${folderId}' in parents and mimeType = 'application/pdf' and trashed = false`;
    do {
      const response = await this.client.request(
        this.client.url(DRIVE_ROOT, 'files', {
          q: query,
          spaces: 'drive',
          pageSize: '100',
          fields: `nextPageToken,files(${ENTRY_FIELDS},size)`,
          ...(pageToken ? { pageToken } : {}),
        })
      ).then((r) => r.json() as Promise<DriveFileResponse>);

      const files = (response.files ?? []).filter(f => f.mimeType === 'application/pdf');
      candidates.push(...files.map((f) => this.parseCandidate(f)));
      pageToken = response.nextPageToken ?? '';
    } while (pageToken);

    // Load status from local storage (imported/discarded/pending)
    const stored = await storage.readSessionDirectory<IntakeCandidate>(owner, 'intakeCandidatesStatus');
    if (stored) {
      const statusMap = new Map(stored.map(c => [c.id, c.status]));
      candidates.forEach(c => { if (statusMap.has(c.id)) c.status = statusMap.get(c.id)!; });
    }
    return candidates;
  }

  async getPdfFile(fileId: string): Promise<File> {
    const response = await this.client.request(
      this.client.url(DRIVE_ROOT, `files/${encodeURIComponent(fileId)}`, { alt: 'media' })
    );
    const blob = await response.blob();
    return new File([blob], 'informe.pdf', { type: 'application/pdf' });
  }
}

// One client for both repositories: the token obtained by signIn() must be the one used for requests.
const driveClient = new DriveClient();
export const driveAuth = new DriveAuthRepository(driveClient);
export const driveStudyRepo = new DriveStudyRepository(driveClient);
export const driveOperationRepo = new DriveOperationRepository(driveClient);
export const drivePortalRepo = new DrivePortalRepository(driveClient);
export const driveMedicalEventRepo = new DriveMedicalEventRepository(driveClient);
export const driveIntakeRepo = new DriveIntakeRepository(driveClient);
