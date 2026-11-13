import { expect, it, vi } from 'vitest';
import { DriveClient, DriveAuthRepository } from '@data';

it('does not start an upload when cancellation was already requested', async () => {
  const client = new DriveClient();
  await new DriveAuthRepository(client).signIn();
  const controller = new AbortController();
  controller.abort();
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  await expect(client.upload('files', 'POST', {}, new Blob(['%PDF-']), 'application/pdf', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetchSpy).not.toHaveBeenCalled();
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
