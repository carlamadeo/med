import { expect, it, vi } from 'vitest';
import { DriveClient, DriveAuthRepository, DriveSessionError } from '@data';
import { gis } from './fake-google';

it('does not start an upload when cancellation was already requested', async () => {
  const client = new DriveClient();
  await new DriveAuthRepository(client).signIn();
  const controller = new AbortController();
  controller.abort();
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  await expect(client.upload('files', 'POST', {}, new Blob(['%PDF-']), 'application/pdf', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

it('does not send a resumable upload using a different session', async () => {
  const client = new DriveClient();
  await client.signIn();
  let finish!: (response: Response) => void;
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    new Promise<Response>((resolve) => { finish = resolve; })
  );
  const pending = client.upload('files', 'POST', {}, new Blob([new Uint8Array(6 * 1024 * 1024)]), 'application/pdf');
  const rejected = expect(pending).rejects.toBeInstanceOf(DriveSessionError);
  await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
  await client.signOut();
  gis.tokenResponse.access_token = 'another-account-token';
  await client.signIn();
  finish(new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/session' } }));
  await rejected;
  expect(fetchSpy).toHaveBeenCalledOnce();
});

it('rejects a response that arrives after the session changes', async () => {
  const client = new DriveClient();
  await client.signIn();
  let finish!: (response: Response) => void;
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    new Promise<Response>((resolve) => { finish = resolve; })
  );
  const request = client.request('https://www.googleapis.com/drive/v3/files');
  const rejected = expect(request).rejects.toBeInstanceOf(DriveSessionError);
  await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
  await client.signOut();
  gis.tokenResponse.access_token = 'another-account-token';
  await client.signIn();
  finish(new Response('{}', { status: 200 }));
  await rejected;
});

it('propagates cancellation to an in-flight multipart upload', async () => {
  const client = new DriveClient();
  await new DriveAuthRepository(client).signIn();
  const controller = new AbortController();
  let requestSignal: AbortSignal | null | undefined;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
    requestSignal = options?.signal;
    return new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason));
    });
  });
  const pending = client.upload('files', 'POST', {}, new Blob(['%PDF-']), 'application/pdf', controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(requestSignal).toBeDefined());
  controller.abort();
  await rejected;
  expect(requestSignal?.aborted).toBe(true);
});
