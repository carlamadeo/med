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
let authorizations;
let tokenResponse;
const originalWindow = globalThis.window;

before(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'mis-estudios-drive-'));
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
  authorizations = 0;
  tokenResponse = { access_token: 'test-access-token', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.file' };
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    google: { accounts: { oauth2: {
      initTokenClient: ({ callback }) => ({ requestAccessToken() { authorizations++; callback(tokenResponse); } }),
      hasGrantedAllScopes: (response, scope) => response.scope === scope,
    } } },
  };
});

function reloadDrive() {
  return import(pathToFileURL(join(fixture, 'drive.js')).href + '?load=' + ++reload);
}

test('a refresh restores access and loads Drive without another authorization or extending expiry', async (t) => {
  const first = await reloadDrive();
  assert.equal(first.restoreSession(), false);
  await first.connect();
  const saved = storage.get(sessionKey);
  const { expires } = JSON.parse(saved);
  assert.ok(expires > Date.now());
  assert.ok(expires <= Date.now() + 3585000);

  const refreshed = await reloadDrive();
  assert.equal(refreshed.connected(), false);
  assert.equal(refreshed.restoreSession(), true);
  await refreshed.connect();
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.headers.get('Authorization'), 'Bearer test-access-token');
    return Response.json({ files: [] });
  });
  assert.deepEqual(await refreshed.listStudies(), []);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(authorizations, 1);
  assert.equal(storage.get(sessionKey), saved);
});

test('expired or malformed sessions are discarded', async () => {
  for (const value of [
    'invalid json', 'null', '[]',
    JSON.stringify({ accessToken: 'expired', expires: Date.now() - 1 }),
    JSON.stringify({ accessToken: 'invalid', expires: String(Date.now() + 3600000) }),
    JSON.stringify({ accessToken: '', expires: Date.now() + 3600000 }),
    JSON.stringify({ accessToken: 42, expires: Date.now() + 3600000 }),
  ]) {
    storage.set(sessionKey, value);
    const drive = await reloadDrive();
    assert.equal(drive.restoreSession(), false);
    assert.equal(drive.connected(), false);
    assert.equal(storage.has(sessionKey), false);
  }
});

test('signing out prevents a refresh from restoring access', async () => {
  const drive = await reloadDrive();
  await drive.connect();
  drive.disconnect();
  assert.equal(drive.connected(), false);
  assert.equal(storage.has(sessionKey), false);
  assert.equal((await reloadDrive()).restoreSession(), false);
});

test('expiry while the page is open clears the session before calling Drive', async (t) => {
  const drive = await reloadDrive();
  await drive.connect();
  const { expires } = JSON.parse(storage.get(sessionKey));
  t.mock.method(Date, 'now', () => expires + 1);
  const fetch = t.mock.method(globalThis, 'fetch', () => assert.fail('Expired access must not be sent to Drive'));
  await assert.rejects(drive.listStudies(), drive.DriveSessionError);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(storage.has(sessionKey), false);
});

test('a rejected token is cleared so it cannot be restored on the next refresh', async (t) => {
  await (await reloadDrive()).connect();
  const drive = await reloadDrive();
  assert.equal(drive.restoreSession(), true);
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 401 }));
  await assert.rejects(drive.listStudies(), drive.DriveSessionError);
  assert.equal(drive.connected(), false);
  assert.equal(storage.has(sessionKey), false);
  assert.equal((await reloadDrive()).restoreSession(), false);
});

test('blocked session storage still allows connecting and using Drive in memory', async (t) => {
  Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Storage blocked'); } });
  const drive = await reloadDrive();
  assert.equal(drive.restoreSession(), false);
  await drive.connect();
  assert.equal(drive.connected(), true);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ files: [] }));
  assert.deepEqual(await drive.listStudies(), []);
  assert.doesNotThrow(() => drive.disconnect());
  assert.equal(drive.connected(), false);
});

test('invalid token lifetimes or missing permission do not create a saved session', async () => {
  for (const response of [
    { ...tokenResponse, expires_in: 'invalid' },
    { ...tokenResponse, expires_in: 0 },
    { ...tokenResponse, scope: '' },
  ]) {
    tokenResponse = response;
    const drive = await reloadDrive();
    await assert.rejects(drive.connect());
    assert.equal(drive.connected(), false);
    assert.equal(storage.has(sessionKey), false);
  }
});
