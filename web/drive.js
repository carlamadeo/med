import { GOOGLE_CLIENT_ID } from './config.js';
import { validDate } from './extract.js';

const scope = 'https://www.googleapis.com/auth/drive.file';
const driveRoot = 'https://www.googleapis.com/drive/v3/';
const uploadRoot = 'https://www.googleapis.com/upload/drive/v3/';
const entryFields = 'id,description,version,mimeType,trashed,appProperties';
const tag = 'misEstudios';
const marker = 'estudio-v1';
const pdf = 'application/pdf';
const metadataType = 'application/json';
const idPattern = /^[\w-]+$/;
const sessionKey = 'mis-estudios:drive-session:' + GOOGLE_CLIENT_ID;
let accessToken = '';
let expires = 0;
let folderId = '';
let connection = null;

export const configured = /^\d+-[\w-]+\.apps\.googleusercontent\.com$/.test(GOOGLE_CLIENT_ID);
export const connected = () => Boolean(accessToken) && Date.now() < expires;

export function restoreSession() {
  if (!configured) return false;
  try {
    const session = JSON.parse(window.sessionStorage.getItem(sessionKey));
    if (typeof session?.accessToken !== 'string' || !session.accessToken ||
        !Number.isFinite(session.expires) || session.expires <= Date.now()) {
      disconnect();
      return false;
    }
    accessToken = session.accessToken;
    expires = session.expires;
    return true;
  } catch {
    disconnect();
    return false;
  }
}

export class DriveSessionError extends Error {
  constructor() {
    super('Volvé a conectar Google Drive para continuar.');
  }
}

class DriveError extends Error {
  constructor(status) {
    super(status === 404 ? 'El estudio ya no está disponible en Drive.'
      : status === 403 ? 'Drive rechazó la operación. Revisá el acceso y el espacio disponible.'
      : 'Google Drive no pudo completar la operación. Volvé a intentar.');
    this.status = status;
  }
}

export function connect() {
  if (connected()) return Promise.resolve();
  if (connection) return connection;
  const oauth = window.google?.accounts?.oauth2;
  if (!configured || !oauth) return Promise.reject(new Error('Google Drive todavía no está disponible. Revisá la configuración o volvé a intentar.'));
  connection = new Promise((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope,
      include_granted_scopes: false,
      callback(response) {
        const duration = Number(response.expires_in) * 1000 - 15000;
        if (response.error || typeof response.access_token !== 'string' || !response.access_token ||
            !Number.isFinite(duration) || duration <= 0 || !oauth.hasGrantedAllScopes(response, scope)) {
          reject(new Error('Google Drive necesita tu autorización para abrir el archivo.'));
          return;
        }
        accessToken = response.access_token;
        expires = Date.now() + duration;
        folderId = '';
        try {
          window.sessionStorage.setItem(sessionKey, JSON.stringify({ accessToken, expires }));
        } catch {
          // Si el navegador bloquea el almacenamiento, el acceso sigue en memoria.
        }
        resolve();
      },
      error_callback() {
        reject(new Error('La ventana de Google se cerró o el navegador la bloqueó. Volvé a intentar.'));
      },
    });
    client.requestAccessToken({ prompt: '' });
  }).finally(() => { connection = null; });
  return connection;
}

export function disconnect() {
  accessToken = '';
  expires = 0;
  folderId = '';
  try {
    window.sessionStorage.removeItem(sessionKey);
  } catch {
    // El almacenamiento puede estar deshabilitado en este navegador.
  }
}

async function request(url, options = {}) {
  if (!connected()) {
    disconnect();
    throw new DriveSessionError();
  }
  const destination = new URL(url);
  if (destination.origin !== 'https://www.googleapis.com') throw new Error('Google Drive devolvió una dirección inválida.');
  const token = accessToken;
  const headers = new Headers(options.headers);
  headers.set('Authorization', 'Bearer ' + token);
  let response;
  try {
    response = await fetch(destination, { ...options, headers, redirect: 'error', cache: 'no-store' });
  } catch {
    throw new Error('No se pudo conectar con Google Drive. Revisá tu conexión.');
  }
  if (response.status === 401) {
    if (token === accessToken) disconnect();
    throw new DriveSessionError();
  }
  if (!response.ok) throw new DriveError(response.status);
  return response;
}

function url(root, path, params) {
  const endpoint = new URL(path, root);
  endpoint.search = new URLSearchParams(params);
  return endpoint.href;
}

async function json(path, params, options) {
  return (await request(url(driveRoot, path, params), options)).json();
}

function jsonBody(method, body) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function query(value) {
  return "trashed = false and appProperties has { key='" + tag + "' and value='" + value + "' }";
}

export function viewerURL(value) {
  if (!value) return '';
  const link = new URL(value);
  if (!['http:', 'https:'].includes(link.protocol) || link.username || link.password) throw new Error();
  return link.href;
}

function record(file) {
  if (!idPattern.test(file.id) || file.trashed || file.appProperties?.[tag] !== marker) throw new Error('Estudio no disponible.');
  try {
    const entry = JSON.parse(file.description);
    const viewer = viewerURL(entry.viewer || '');
    if (!entry.title || !validDate(entry.date) || !entry.type) throw new Error();
    return {
      id: file.id, revision: file.version, title: entry.title, date: entry.date, type: entry.type,
      doctor: entry.doctor || '', portal: entry.portal || '', viewer,
      reportName: file.mimeType === pdf ? entry.reportName || 'Informe.pdf' : '',
    };
  } catch {
    throw new Error('Drive tiene un estudio cuya ficha no se puede leer.');
  }
}

export async function listStudies() {
  const records = [];
  let pageToken = '';
  do {
    const response = await json('files', {
      q: query(marker), spaces: 'drive', pageSize: '100',
      fields: 'nextPageToken,files(' + entryFields + ')',
      ...(pageToken ? { pageToken } : {}),
    });
    records.push(...response.files.map(record));
    pageToken = response.nextPageToken;
  } while (pageToken);
  return records;
}

async function folder() {
  if (folderId) return folderId;
  const { files } = await json('files', {
    q: query('carpeta-v1') + " and mimeType = 'application/vnd.google-apps.folder'",
    fields: 'files(id)', orderBy: 'createdTime', pageSize: '1',
  });
  const existing = files[0];
  const result = existing || await json('files', { fields: 'id' }, jsonBody('POST', {
    name: 'Mis estudios', mimeType: 'application/vnd.google-apps.folder', appProperties: { [tag]: 'carpeta-v1' },
  }));
  folderId = result.id;
  return folderId;
}

export async function reserveId() {
  const result = await json('files/generateIds', { count: '1' });
  return result.ids[0];
}

async function upload(path, method, metadata, media, mediaType) {
  if (media.size > 5 * 1024 * 1024) {
    const options = jsonBody(method, metadata);
    options.headers['X-Upload-Content-Type'] = mediaType;
    options.headers['X-Upload-Content-Length'] = String(media.size);
    const started = await request(url(uploadRoot, path, { uploadType: 'resumable', fields: entryFields }), options);
    const location = started.headers.get('Location');
    if (!location) throw new Error('Drive no pudo iniciar la carga del PDF.');
    return (await request(location, { method: 'PUT', headers: { 'Content-Type': mediaType }, body: media })).json();
  }
  const boundary = 'mis-estudios-' + crypto.randomUUID();
  const body = new Blob([
    '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify(metadata),
    '\r\n--' + boundary + '\r\nContent-Type: ' + mediaType + '\r\n\r\n',
    media, '\r\n--' + boundary + '--\r\n',
  ]);
  return (await request(url(uploadRoot, path, { uploadType: 'multipart', fields: entryFields }), {
    method, headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body,
  })).json();
}

async function currentStudy(study) {
  const file = await json('files/' + encodeURIComponent(study.id), { fields: entryFields });
  const current = record(file);
  if (current.revision !== study.revision) {
    throw new Error('Este estudio cambió en Drive. Cerrá la ficha y actualizá la lista antes de volver a editarlo.');
  }
  return current;
}

export async function saveStudy({ entry, report, previous, removeReport, newId }) {
  if (previous) await currentStudy(previous);
  const reportName = report?.name || (!removeReport && previous?.reportName) || '';
  const payload = { ...entry, reportName };
  const description = JSON.stringify(payload);
  const extension = reportName ? '.pdf' : '.json';
  const fileName = (entry.date + ' ' + entry.title).replace(/[\\/]/g, '-') + extension;
  const metadata = { name: fileName, description };
  const path = previous ? 'files/' + encodeURIComponent(previous.id) : 'files';

  if (!previous) {
    metadata.id = newId;
    metadata.parents = [await folder()];
    metadata.appProperties = { [tag]: marker };
  }
  const method = previous ? 'PATCH' : 'POST';
  if (previous && !report && !(removeReport && previous.reportName)) {
    return record(await json(path, { fields: entryFields }, jsonBody(method, metadata)));
  }

  const media = report || new Blob([description], { type: metadataType });
  const mediaType = report ? pdf : metadataType;
  metadata.mimeType = mediaType;
  try {
    return record(await upload(path, method, metadata, media, mediaType));
  } catch (error) {
    if (previous || error.status !== 409) throw error;
    const existing = await json('files/' + encodeURIComponent(newId), { fields: entryFields });
    if (existing.description !== description) throw new Error('La carga anterior ya se guardó. Actualizá la lista para revisarla.');
    return record(existing);
  }
}

export async function trashStudy(study) {
  await currentStudy(study);
  await json('files/' + encodeURIComponent(study.id), { fields: 'id' }, jsonBody('PATCH', { trashed: true }));
}

export function reportURL(id) {
  return 'https://drive.google.com/file/d/' + encodeURIComponent(id) + '/view';
}
