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
  fixture = await mkdtemp(join(tmpdir(), 'mis-estudios-portals-'));
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

test('lee y escribe el directorio de portales', async (t) => {
  const drive = await connectDrive();
  let createdDir = false;
  let captured;
  let dirVersion = '1';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/drive/v3/files' && options.method === 'GET') {
      if (createdDir) {
        return Response.json({ files: [{ id: 'portal-dir', version: dirVersion }] });
      }
      return Response.json({ files: [] });
    }
    if (pathname === '/drive/v3/files' && options.method === 'POST') {
      createdDir = true;
      return Response.json({ id: 'portal-dir', version: dirVersion });
    }
    if (pathname === '/drive/v3/files/portal-dir' && options.method === 'GET') {
      return Response.json({ description: JSON.stringify({ portals: [] }), version: dirVersion });
    }
    if (pathname === '/drive/v3/files/portal-dir' && options.method === 'PATCH') {
      captured = JSON.parse(options.body);
      dirVersion = '2';
      return Response.json({ id: 'portal-dir', version: dirVersion });
    }
    return Response.json({ files: [] });
  });

  const dir = await drive.readPortals();
  assert.equal(dir.id, 'portal-dir');
  assert.deepEqual(dir.portals, []);

  const portals = [{ name: 'Clínica Modelo', url: 'https://clinica.example.com', notes: 'Obra social' }];
  await drive.writePortals(portals);
  assert.deepEqual(JSON.parse(captured.description).portals, portals);
});
