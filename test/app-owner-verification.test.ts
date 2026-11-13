import { http, HttpResponse } from 'msw';
import { act } from 'preact/test-utils';
import { expect, it, vi } from 'vitest';
import { driveAuth } from '@data';
import { $, mountPage, rowIds } from './page';
import { server } from './server';

it('keeps private history closed until the Drive account is verified', async () => {
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const verificationStarted = new Promise<void>((resolve) => { started = resolve; });
  server.use(http.get('https://www.googleapis.com/drive/v3/about', async () => {
    started();
    await pending;
    return HttpResponse.json({ user: { permissionId: 'account-one', me: true } });
  }));
  await mountPage({ signIn: false });
  try {
    await act(async () => { await driveAuth.signIn(); });
    await verificationStarted;
    expect($('#library').hidden).toBe(true);
    expect(rowIds()).toEqual([]);
  } finally {
    release();
  }
  await vi.waitFor(() => expect(rowIds()).toHaveLength(2));
});
