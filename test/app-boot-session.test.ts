/** Reloading the page with a still-valid session must open the library on its own. */
import { expect, it, vi } from 'vitest';
import { driveAuth } from '@data';
import { resetFakeDrive } from './fake-drive';
import { $, mountPage, rowIds } from './page';
import { installGis, resetGis } from './fake-google';

it('opens the library and loads the studies without any click', async () => {
  resetFakeDrive();
  resetGis();
  installGis();
  await driveAuth.signIn(); // leaves a session in sessionStorage, as a previous visit would have

  await mountPage({ signIn: false });

  await vi.waitFor(() => expect(rowIds()).toHaveLength(2));
  expect($('#library').hidden).toBe(false);
  expect($('#access').hidden).toBe(true);
});
