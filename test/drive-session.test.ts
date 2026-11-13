/**
 * Behaviour spec carried over from the original test/drive.test.mjs (web/drive.js), so the TypeScript
 * port is held to the same rules: session lifetime, token handling and how fichas are read.
 */
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { DriveAuthRepository, DriveClient, DriveConflictError, DriveSessionError, DriveStudyRepository } from '@data';
import { isValidDate } from '@domain/utils';
import { addRemoteRaw, fakeDriveFile, resetFakeDrive } from './fake-drive';
import { DRIVE_SCOPE, gis } from './fake-google';
import { server } from './server';

const SESSION_KEY = `mis-estudios:drive-session:${import.meta.env.VITE_GOOGLE_CLIENT_ID}`;
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';

/** A page reload: brand-new in-memory client, same sessionStorage. */
function reload() {
  const client = new DriveClient();
  return { auth: new DriveAuthRepository(client), studies: new DriveStudyRepository(client) };
}

const storedSession = () => window.sessionStorage.getItem(SESSION_KEY);

describe('session', () => {
  it('does not request the next page after the account changes', async () => {
    const client = new DriveClient();
    const auth = new DriveAuthRepository(client);
    await auth.signIn();
    let release!: () => void;
    let started!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const began = new Promise<void>((resolve) => { started = resolve; });
    let calls = 0;
    server.use(http.get(FILES_URL, async () => {
      calls += 1;
      started();
      await wait;
      return HttpResponse.json({ files: [], nextPageToken: 'next' });
    }));
    const result = new DriveStudyRepository(client).list({ force: true });
    const rejected = expect(result).rejects.toBeInstanceOf(DriveSessionError);
    await began;
    await auth.signOut();
    gis.tokenResponse.access_token = 'other-account-token';
    await auth.signIn();
    release();
    await rejected;
    expect(calls).toBe(1);
  });
  it('shares concurrent folder lookups for the same session', async () => {
    const client = new DriveClient();
    await client.signIn();
    let calls = 0;
    server.use(http.get(FILES_URL, async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return HttpResponse.json({ files: [{ id: 'shared-folder' }] });
    }));
    expect(await Promise.all([client.getFolderId(), client.getFolderId()])).toEqual(['shared-folder', 'shared-folder']);
    expect(calls).toBe(1);
  });
  it('does not keep a folder returned after the account changed', async () => {
    const client = new DriveClient();
    const auth = new DriveAuthRepository(client);
    await auth.signIn();
    let release!: () => void;
    let started!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const began = new Promise<void>((resolve) => { started = resolve; });
    let calls = 0;
    server.use(http.get(FILES_URL, async () => {
      calls += 1;
      if (calls === 1) { started(); await pending; return HttpResponse.json({ files: [{ id: 'old-folder' }] }); }
      return HttpResponse.json({ files: [{ id: 'new-folder' }] });
    }));
    const oldRequest = client.getFolderId();
    await began;
    await auth.signOut();
    gis.tokenResponse.access_token = 'other-account-token';
    await auth.signIn();
    release();
    await expect(oldRequest).rejects.toBeInstanceOf(DriveSessionError);
    expect(await client.getFolderId()).toBe('new-folder');
  });
  it('identifies the Drive account independently of the access token and refuses stale identity after account change', async () => {
    const first = reload();
    await first.auth.signIn();
    expect(await first.auth.getAccountId()).toBe('account-one');
    const refreshed = reload();
    expect(refreshed.auth.restoreSession()).toBe(true);
    expect(refreshed.auth.cachedAccountId()).toBe('account-one');
    await first.auth.signOut();
    gis.tokenResponse.access_token = 'renewed-token';
    await first.auth.signIn();
    expect(await first.auth.getAccountId()).toBe('account-one');
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ accessToken: 'other-account-token', expires: Date.now() + 3_600_000 }));
    const second = reload();
    expect(second.auth.restoreSession()).toBe(true);
    expect(second.auth.cachedAccountId()).toBeNull();
    expect(await second.auth.getAccountId()).toBe('other-account');
  });

  it('keeps a verified account identity available if Drive is temporarily unreachable', async () => {
    const session = reload();
    await session.auth.signIn();
    await session.auth.getAccountId();
    server.use(http.get('https://www.googleapis.com/drive/v3/about', () => HttpResponse.error()));
    await expect(session.auth.getAccountId()).rejects.toThrow();
    expect(session.auth.cachedAccountId()).toBe('account-one');
  });
  it('does not expose a previous session cache after a different token is restored', async () => {
    const first = reload();
    await first.auth.signIn();
    await first.studies.list();
    resetFakeDrive();
    const remote = fakeDriveFile('study-1')!;
    const description = JSON.parse(remote.description) as Record<string, unknown>;
    description.title = 'Ficha de otra sesión';
    remote.description = JSON.stringify(description);
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ accessToken: 'different-session-token', expires: Date.now() + 3_600_000 }));
    const second = reload();
    expect(second.auth.restoreSession()).toBe(true);
    expect((await second.studies.list()).find((study) => study.id === 'study-1')?.title).toBe('Ficha de otra sesión');
  });

  it('a refresh restores access and loads Drive without another authorization or extending expiry', async () => {
    const first = reload();
    expect(first.auth.restoreSession()).toBe(false);
    await first.auth.signIn();
    const saved = storedSession()!;
    const { expires } = JSON.parse(saved) as { expires: number };
    expect(expires).toBeGreaterThan(Date.now());
    expect(expires).toBeLessThanOrEqual(Date.now() + 3_585_000);

    const refreshed = reload();
    expect(refreshed.auth.isSignedIn()).toBe(false);
    expect(refreshed.auth.restoreSession()).toBe(true);
    await refreshed.auth.signIn(); // already connected: must not open the popup again

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await refreshed.studies.list({ force: true });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const [, options] of fetchSpy.mock.calls) {
      expect(((options as RequestInit).headers as Headers).get('Authorization')).toBe('Bearer test-access-token');
    }
    expect(gis.authorizations).toBe(1);
    expect(JSON.parse(storedSession()!)).toMatchObject({ expires, accountId: 'account-one' });
  });

  it('expired or malformed sessions are discarded', async () => {
    for (const value of [
      'invalid json',
      'null',
      '[]',
      JSON.stringify({ accessToken: 'expired', expires: Date.now() - 1 }),
      JSON.stringify({ accessToken: 'invalid', expires: String(Date.now() + 3_600_000) }),
      JSON.stringify({ accessToken: '', expires: Date.now() + 3_600_000 }),
      JSON.stringify({ accessToken: 42, expires: Date.now() + 3_600_000 }),
    ]) {
      window.sessionStorage.setItem(SESSION_KEY, value);
      const { auth } = reload();

      expect(auth.restoreSession(), value).toBe(false);
      expect(auth.isSignedIn(), value).toBe(false);
      expect(storedSession(), value).toBeNull();
    }
  });

  it('signing out prevents a refresh from restoring access', async () => {
    const { auth } = reload();
    await auth.signIn();
    await auth.signOut();

    expect(auth.isSignedIn()).toBe(false);
    expect(storedSession()).toBeNull();
    expect(reload().auth.restoreSession()).toBe(false);
  });

  it('expiry while the page is open clears the session before calling Drive', async () => {
    const { auth, studies } = reload();
    await auth.signIn();
    await studies.list();
    const { expires } = JSON.parse(storedSession()!) as { expires: number };
    vi.spyOn(Date, 'now').mockReturnValue(expires + 1);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(studies.list()).rejects.toBeInstanceOf(DriveSessionError);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storedSession()).toBeNull();
  });

  it('a rejected token is cleared so it cannot be restored on the next refresh', async () => {
    await reload().auth.signIn();
    const { auth, studies } = reload();
    expect(auth.restoreSession()).toBe(true);
    server.use(http.get(FILES_URL, () => new HttpResponse(null, { status: 401 })));

    await expect(studies.list({ force: true })).rejects.toBeInstanceOf(DriveSessionError);

    expect(auth.isSignedIn()).toBe(false);
    expect(storedSession()).toBeNull();
    expect(reload().auth.restoreSession()).toBe(false);
  });

  it('a 401 for an old token does not log out a newer connection made while it was in flight', async () => {
    const { auth, studies } = reload();
    await auth.signIn();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.get(FILES_URL, async () => {
        await gate;
        return new HttpResponse(null, { status: 401 });
      })
    );

    const pending = studies.list({ force: true });
    const rejected = expect(pending).rejects.toBeInstanceOf(DriveSessionError);
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the request leave with the old token

    await auth.signOut();
    gis.tokenResponse = { ...gis.tokenResponse, access_token: 'newer-token' };
    await auth.signIn();
    release();
    await rejected;

    expect(auth.isSignedIn()).toBe(true);
    expect((JSON.parse(storedSession()!) as { accessToken: string }).accessToken).toBe('newer-token');
  });

  it('blocked session storage still allows connecting and using Drive in memory', async () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    const { auth, studies } = reload();

    expect(auth.restoreSession()).toBe(false);
    await auth.signIn();
    expect(auth.isSignedIn()).toBe(true);
    expect(await studies.list({ force: true })).toHaveLength(2);
    await expect(auth.signOut()).resolves.toBeUndefined();
    expect(auth.isSignedIn()).toBe(false);
  });

  it('invalid token lifetimes or missing permission do not create a saved session', async () => {
    const valid = { access_token: 'test-access-token', expires_in: 3600, scope: DRIVE_SCOPE };
    for (const response of [
      { ...valid, expires_in: 'invalid' },
      { ...valid, expires_in: 0 },
      { ...valid, scope: '' },
      { ...valid, error: 'access_denied' },
      { ...valid, access_token: '' },
    ]) {
      gis.tokenResponse = response;
      const { auth } = reload();

      await expect(auth.signIn()).rejects.toThrow();

      expect(auth.isSignedIn(), JSON.stringify(response)).toBe(false);
      expect(storedSession(), JSON.stringify(response)).toBeNull();
    }
  });
});

describe('reading fichas', () => {
  async function listWith(entries: Record<string, Record<string, unknown>>, mimeType?: string) {
    resetFakeDrive();
    for (const [id, entry] of Object.entries(entries)) addRemoteRaw(id, entry, mimeType);
    const { auth, studies } = reload();
    await auth.signIn();
    return studies.list({ force: true });
  }

  it('reads old single-type studies and new studies with multiple types', async () => {
    const all = await listWith({
      old: { type: 'Mamografía' },
      current: { types: ['Mamografía', 'Ecografía', 'Mamografía'] },
    });

    const byId = Object.fromEntries(all.map((s) => [s.id, s.types]));
    expect(byId.old).toEqual(['Mamografía']);
    expect(byId.current).toEqual(['Mamografía', 'Ecografía']);
  });

  it('editing an old study saves multiple types and they survive reloading the library', async () => {
    resetFakeDrive();
    addRemoteRaw('old', { type: 'Mamografía' });
    const { auth, studies } = reload();
    await auth.signIn();
    const previous = (await studies.list({ force: true })).find((s) => s.id === 'old')!;

    const saved = await studies.save({
      title: previous.title,
      date: previous.date,
      types: ['Mamografía', 'Ecografía'],
      doctor: '',
      portal: '',
      viewer: '',
      reportName: '',
      driveFileId: previous.id,
      revision: previous.revision,
    });

    expect(saved.types).toEqual(['Mamografía', 'Ecografía']);
    expect(saved.revision).toBe('2');
    const entry = JSON.parse(fakeDriveFile('old')!.description) as Record<string, unknown>;
    expect(entry.types).toEqual(['Mamografía', 'Ecografía']);
    expect(entry.type).toBeUndefined();
    const reloaded = (await studies.list({ force: true })).find((s) => s.id === 'old');
    expect(reloaded?.types).toEqual(saved.types);
  });

  it('invalid type lists do not make an unreadable study appear valid', async () => {
    for (const types of [[], [''], [42], 'Mamografía']) {
      await expect(listWith({ bad: { types } }), JSON.stringify(types)).rejects.toThrow(/ficha no se puede leer/);
    }
  });

  it('rejects dates that are not real calendar days from 1900 on', async () => {
    for (const date of ['2024-02-30', '1899-12-31', '2024-3-1', 'not a date', '', 20240318]) {
      await expect(listWith({ bad: { types: ['Otro'], date } }), String(date)).rejects.toThrow(/ficha no se puede leer/);
    }
    const [leap] = (await listWith({ ok: { types: ['Otro'], date: '2024-02-29' } })).filter((s) => s.id === 'ok');
    expect(leap?.date).toBe('2024-02-29');
  });

  it('rejects viewer links that are not plain http(s) URLs', async () => {
    for (const viewer of ['javascript:alert(1)', 'ftp://example.com/x', 'https://user:pass@example.com/', 'not a url']) {
      await expect(listWith({ bad: { types: ['Otro'], viewer } }), viewer).rejects.toThrow(/ficha no se puede leer/);
    }
  });

  it('falls back to "Informe.pdf" when a PDF study has no stored report name', async () => {
    const all = await listWith({ pdf: { types: ['Otro'], reportName: '' } }, 'application/pdf');
    expect(all.find((s) => s.id === 'pdf')).toMatchObject({ hasPdf: true, reportName: 'Informe.pdf' });
  });

  it('ignores files that are trashed or not marked as studies', async () => {
    resetFakeDrive();
    const { auth, studies } = reload();
    await auth.signIn();
    server.use(
      http.get(FILES_URL, () =>
        HttpResponse.json({
          files: [
            { id: 'trashed', version: '1', mimeType: 'application/json', trashed: true, appProperties: { misEstudios: 'estudio-v1' }, description: '{}' },
          ],
        })
      )
    );

    await expect(studies.list({ force: true })).rejects.toThrow(/Estudio no disponible/);
  });
});

describe('creating studies', () => {
  const draft = {
    title: 'Con id reservado',
    date: '2024-03-01',
    types: ['Otro'],
    doctor: '',
    portal: '',
    viewer: '',
    reportName: '',
  };

  it('a retried create with the reserved id does not duplicate the study', async () => {
    const { auth, studies } = reload();
    await auth.signIn();
    const id = await studies.reserveId();

    const first = await studies.save({ ...draft, id });
    const retried = await studies.save({ ...draft, id }); // e.g. the first response was lost

    expect(retried.id).toBe(first.id);
    expect((await studies.list({ force: true })).filter((s) => s.title === draft.title)).toHaveLength(1);
  });

  it('refuses a create whose reserved id already holds a different study', async () => {
    const { auth, studies } = reload();
    await auth.signIn();
    const id = await studies.reserveId();
    await studies.save({ ...draft, id });

    await expect(studies.save({ ...draft, title: 'Otro distinto', id })).rejects.toThrow('La carga anterior ya se guardó');
  });

  it('conflicts are a dedicated error type', () => {
    expect(new DriveConflictError()).toBeInstanceOf(Error);
  });
});

describe('isValidDate', () => {
  it.each(['2024-03-18', '2024-02-29', '1900-01-01', '9999-12-31'])('accepts %s', (date) => {
    expect(isValidDate(date)).toBe(true);
  });

  it.each(['2023-02-29', '2024-13-01', '2024-00-10', '1899-12-31', '2024-3-18', ' 2024-03-18', 'ayer', ''])(
    'rejects %s',
    (date) => {
      expect(isValidDate(date)).toBe(false);
    }
  );

  it('rejects non-strings', () => {
    expect(isValidDate(20240318)).toBe(false);
    expect(isValidDate(null)).toBe(false);
    expect(isValidDate(undefined)).toBe(false);
  });
});
