import { expect, it } from 'vitest';
import { validateDocument } from '@data/pdf-analysis';

it('detects PDF, JPEG and PNG from their signatures', async () => {
  expect(await validateDocument(new Blob(['%PDF-1.7'], { type: 'application/pdf' }))).toBe('application/pdf');
  expect(await validateDocument(new Blob([new Uint8Array([255, 216, 255, 224])], { type: 'image/jpeg' }))).toBe('image/jpeg');
  expect(await validateDocument(new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }))).toBe('image/png');
});

it('rejects forged MIME types and oversized attachments', async () => {
  await expect(validateDocument(new Blob(['not an image'], { type: 'image/png' }))).rejects.toThrow();
  await expect(validateDocument(new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: 'image/jpeg' }))).rejects.toThrow('20 MB');
});
