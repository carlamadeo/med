import { http, HttpResponse } from 'msw';

const API = 'https://www.googleapis.com';

export interface FakeFile {
  id: string;
  name: string;
  description: string;
  mimeType: string;
  trashed: boolean;
  version: number;
  appProperties: Record<string, string>;
  content: string;
}

const files = new Map<string, FakeFile>();
let idCounter = 0;

/** Every upload request seen, by `uploadType`, so tests can prove which flow was used. */
export const uploadLog: string[] = [];

export const SEED_PDF_ID = 'study-1';
export const SEED_JSON_ID = 'study-2';
export const FOLDER_ID = 'folder-1';

function ficha(id: string, fields: Record<string, unknown>): string {
  return JSON.stringify({ id, viewer: '', doctor: '', portal: '', ...fields });
}

/** Resets the in-memory Drive to two known studies (one with PDF, one ficha-only). */
export function resetFakeDrive(): void {
  files.clear();
  uploadLog.length = 0;
  idCounter = 0;
  files.set(SEED_PDF_ID, {
    id: SEED_PDF_ID,
    name: '2024-01-15 Ecografía abdominal.pdf',
    description: ficha(SEED_PDF_ID, {
      title: 'Ecografía abdominal',
      date: '2024-01-15',
      types: ['Ecografía'],
      doctor: 'Dra. Ana Pérez',
      portal: 'Hospital Central',
      viewer: 'https://portal.hospital.com/viewer/123',
      reportName: 'Informe.pdf',
    }),
    mimeType: 'application/pdf',
    trashed: false,
    version: 1,
    appProperties: { misEstudios: 'estudio-v1' },
    content: 'PDF content',
  });
  files.set(SEED_JSON_ID, {
    id: SEED_JSON_ID,
    name: '2024-02-20 Análisis de sangre.json',
    description: ficha(SEED_JSON_ID, {
      title: 'Análisis de sangre',
      date: '2024-02-20',
      types: ['Análisis de laboratorio'],
      doctor: 'Dr. Juan López',
      portal: 'LabCorp',
      reportName: '',
    }),
    mimeType: 'application/json',
    trashed: false,
    version: 1,
    appProperties: { misEstudios: 'estudio-v1' },
    content: '{}',
  });
}

/** Leaves Drive with no studies at all. */
export function clearFakeDrive(): void {
  files.clear();
}

export function fakeDriveFile(id: string): FakeFile | undefined {
  return files.get(id);
}

/** Adds a study straight to "Drive", bypassing the app (simulates another device). */
export function addRemoteStudy(id: string, title: string): void {
  files.set(id, {
    id,
    name: `2024-05-01 ${title}.json`,
    description: ficha(id, { title, date: '2024-05-01', types: ['Otro'], reportName: '' }),
    mimeType: 'application/json',
    trashed: false,
    version: 1,
    appProperties: { misEstudios: 'estudio-v1' },
    content: '{}',
  });
}

/** Simulates another device editing the file: Drive bumps `version`, the content stays. */
export function touchRemote(id: string): void {
  const file = files.get(id);
  if (file) file.version += 1;
}

/** Adds a file with an arbitrary ficha (legacy or invalid shapes included), as written by any app version. */
export function addRemoteRaw(id: string, entry: Record<string, unknown>, mimeType = 'application/json'): void {
  files.set(id, {
    id,
    name: `${id}.${mimeType === 'application/pdf' ? 'pdf' : 'json'}`,
    description: JSON.stringify({ title: 'Informe de prueba', date: '2024-03-18', ...entry }),
    mimeType,
    trashed: false,
    version: 1,
    appProperties: { misEstudios: 'estudio-v1' },
    content: mimeType === 'application/pdf' ? 'PDF content' : '{}',
  });
}

function publicView(file: FakeFile) {
  const { content: _content, version, ...rest } = file;
  // Deterministic and strictly increasing with each version.
  const modifiedTime = new Date(Date.UTC(2024, 0, version)).toISOString();
  return { ...rest, version: String(version), modifiedTime };
}

/** Parses the body produced by DriveClient.upload(): JSON metadata part + media part. */
function parseMultipart(body: string, contentType: string): { metadata: Record<string, unknown>; content: string } {
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1];
  if (!boundary) throw new Error('multipart boundary missing');
  const parts = body
    .split(`--${boundary}`)
    .map((part) => part.trim())
    .filter((part) => part && part !== '--');
  const payload = (part: string | undefined) => (part ?? '').split('\r\n\r\n').slice(1).join('\r\n\r\n');
  return { metadata: JSON.parse(payload(parts[0])), content: payload(parts[1]) };
}

export const driveHandlers = [
  // Must precede ':id' so "generateIds" is not read as a file id.
  http.get(`${API}/drive/v3/files/generateIds`, () => HttpResponse.json({ ids: [`generated-${++idCounter}`] })),

  http.get(`${API}/drive/v3/files`, ({ request }) => {
    const q = new URL(request.url).searchParams.get('q') ?? '';
    if (q.includes('carpeta-v1')) return HttpResponse.json({ files: [{ id: FOLDER_ID }] });
    const studies = [...files.values()].filter((f) => !f.trashed && f.appProperties.misEstudios === 'estudio-v1');
    return HttpResponse.json({ files: studies.map(publicView) });
  }),

  http.get(`${API}/drive/v3/files/:id`, ({ params, request }) => {
    const file = files.get(String(params.id));
    if (!file) return new HttpResponse(null, { status: 404 });
    if (new URL(request.url).searchParams.get('alt') === 'media') {
      return new HttpResponse(file.content, { headers: { 'content-type': file.mimeType } });
    }
    return HttpResponse.json(publicView(file));
  }),

  http.patch(`${API}/drive/v3/files/:id`, async ({ params, request }) => {
    const file = files.get(String(params.id));
    if (!file) return new HttpResponse(null, { status: 404 });
    Object.assign(file, (await request.json()) as Partial<FakeFile>, { version: file.version + 1 });
    return HttpResponse.json(publicView(file));
  }),

  http.post(`${API}/upload/drive/v3/files`, async ({ request }) => {
    if (isResumable(request)) return startResumable(await request.json());
    const { metadata, content } = parseMultipart(await request.text(), request.headers.get('content-type') ?? '');
    return createFile(metadata, content);
  }),

  http.patch(`${API}/upload/drive/v3/files/:id`, async ({ params, request }) => {
    const id = String(params.id);
    if (isResumable(request)) return startResumable(await request.json(), id);
    const { metadata, content } = parseMultipart(await request.text(), request.headers.get('content-type') ?? '');
    return updateFile(id, metadata, content);
  }),

  // Second leg of a resumable upload: the raw media goes to the session URL.
  http.put(`${API}/upload/resumable/:session`, async ({ params, request }) => {
    const session = sessions.get(String(params.session));
    if (!session) return new HttpResponse(null, { status: 404 });
    sessions.delete(String(params.session));
    const content = await request.text();
    return session.fileId ? updateFile(session.fileId, session.metadata, content) : createFile(session.metadata, content);
  }),
];

interface ResumableSession {
  metadata: Record<string, unknown>;
  fileId?: string;
}
const sessions = new Map<string, ResumableSession>();

function isResumable(request: Request): boolean {
  const uploadType = new URL(request.url).searchParams.get('uploadType') ?? 'unknown';
  uploadLog.push(uploadType);
  return uploadType === 'resumable';
}

function startResumable(metadata: unknown, fileId?: string): Response {
  const session = `session-${sessions.size + 1}-${Date.now()}`;
  sessions.set(session, { metadata: metadata as Record<string, unknown>, fileId });
  return new HttpResponse(null, { status: 200, headers: { Location: `${API}/upload/resumable/${session}` } });
}

function createFile(metadata: Record<string, unknown>, content: string): Response {
  const id = String(metadata.id);
  if (files.has(id)) return new HttpResponse(null, { status: 409 });
  const file: FakeFile = {
    id,
    name: String(metadata.name),
    description: String(metadata.description),
    mimeType: String(metadata.mimeType),
    trashed: false,
    version: 1,
    appProperties: (metadata.appProperties ?? {}) as Record<string, string>,
    content,
  };
  files.set(id, file);
  return HttpResponse.json(publicView(file));
}

function updateFile(id: string, metadata: Record<string, unknown>, content: string): Response {
  const file = files.get(id);
  if (!file) return new HttpResponse(null, { status: 404 });
  Object.assign(file, {
    name: String(metadata.name),
    description: String(metadata.description),
    mimeType: String(metadata.mimeType),
    content,
    version: file.version + 1,
  });
  return HttpResponse.json(publicView(file));
}
