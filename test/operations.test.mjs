import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const clientId = '123456-test.apps.googleusercontent.com';
const sessionKey = 'mis-estudios:drive-session:' + clientId;
let fixture;
let reload = 0;
let storage;
let tokenResponse;
const originalWindow = globalThis.window;

before(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'mis-estudios-ops-'));
  await Promise.all([
    ...['drive.js', 'extract.js'].map((name) => copyFile(new URL('../web/' + name, import.meta.url), join(fixture, name))),
    writeFile(join(fixture, 'package.json'), '{"type":"module"}'),
    writeFile(join(fixture, 'config.js'), 'export const GOOGLE_CLIENT_ID = ' + JSON.stringify(clientId) + ';'),
  ]);
});

after(async () => {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  await rm(fixture, { recursive: true, force: true });
});

beforeEach(() => {
  storage = new Map();
  tokenResponse = { access_token: 'test-access-token', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.file' };
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    google: { accounts: { oauth2: {
      initTokenClient: ({ callback }) => ({ requestAccessToken() { callback(tokenResponse); } }),
      hasGrantedAllScopes: (response, scope) => response.scope === scope,
    } } },
  };
});

function reloadDrive() {
  return import(pathToFileURL(join(fixture, 'drive.js')).href + '?load=' + ++reload);
}

async function connectDrive() {
  const drive = await reloadDrive();
  await drive.connect();
  return drive;
}

function operationFile(overrides = {}) {
  return {
    id: 'test-operation', version: '1', mimeType: 'application/json',
    appProperties: { misEstudios: 'operacion-v1' },
    description: JSON.stringify({ title: 'Operación de prueba', date: '2024-05-10', surgeon: '', institution: '', type: '', notes: '', studies: [], ...overrides }),
  };
}

test('lista operaciones desde Drive', async (t) => {
  const drive = await connectDrive();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: [operationFile({ surgeon: 'Dra. Ana', institution: 'Clínica' })] }));
  const ops = await drive.listOperations();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].title, 'Operación de prueba');
  assert.equal(ops[0].surgeon, 'Dra. Ana');
});

test('guarda y lee una operación nueva', async (t) => {
  const drive = await connectDrive();
  let created;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const pathname = new URL(url).pathname;
    const method = options.method || 'GET';
    if (pathname === '/drive/v3/files/generateIds') {
      return Response.json({ ids: ['reserved-id'] });
    }
    if (pathname === '/drive/v3/files' && method === 'GET') {
      return Response.json({ files: [{ id: 'folder-1', name: 'Mis estudios', mimeType: 'application/vnd.google-apps.folder' }] });
    }
    if (pathname === '/upload/drive/v3/files' && method === 'POST') {
      created = {
        id: 'op-new', version: '1',
        description: JSON.stringify({ title: 'Cesárea', date: '2024-05-10', surgeon: 'Dr. Luis', institution: 'Sanatorio', type: 'Obstetricia', notes: '', studies: [] }),
        appProperties: { misEstudios: 'operacion-v1' },
      };
      return Response.json(created);
    }
    return Response.json({ files: [] });
  });
  const saved = await drive.saveOperation({ entry: { title: 'Cesárea', date: '2024-05-10', surgeon: 'Dr. Luis', institution: 'Sanatorio', type: 'Obstetricia', notes: '' } });
  assert.equal(saved.title, 'Cesárea');
  assert.equal(saved.id, 'op-new');
});

test('elimina una operación sin estudios vinculados', async (t) => {
  const drive = await connectDrive();
  assert.strictEqual(drive.connected(), true, 'debe estar conectado');
  let trashed = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const pathname = new URL(url).pathname;
    const method = options.method || 'GET';
    if (pathname === '/drive/v3/files/test-operation' && method === 'GET') {
      return Response.json({ id: 'test-operation', version: '1', mimeType: 'application/json' });
    }
    if (pathname === '/drive/v3/files/test-operation' && method === 'PATCH') {
      trashed = true;
      return Response.json({ id: 'test-operation' });
    }
    return Response.json({ files: [] });
  });
  await drive.trashOperation({ id: 'test-operation', revision: '1', title: 'X', date: '2024-05-10', studies: [] });
  assert.equal(trashed, true);
});
