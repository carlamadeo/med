import { act } from 'preact/test-utils';
import { expect, it, vi } from 'vitest';
import { gis } from './fake-google';
import { $, mountPage } from './page';

it('shows an authorization error without opening private history', async () => {
  await mountPage({ signIn: false });
  gis.tokenResponse.error = 'access_denied';
  act(() => { $<HTMLButtonElement>('#connect').click(); });
  await vi.waitFor(() => expect($('#access-error')?.textContent).toContain('autorización'));
  expect($('#library').hidden).toBe(true);
});
