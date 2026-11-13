import { act } from 'preact/test-utils';
import { expect, it, vi } from 'vitest';
import { driveAuth } from '@data';
import { $, mountPage } from './page';

it('clears unsubmitted appointment and episode drafts after sign-out', async () => {
  await mountPage();
  for (const tab of ['turnos', 'episodios']) {
    act(() => { $(`#tab-${tab}`).click(); });
    const form = document.querySelector<HTMLFormElement>(tab === 'turnos' ? '#appointments-title + form' : '#episode-form')!;
    const notes = form.querySelector<HTMLTextAreaElement>('textarea')!;
    notes.value = 'Información privada';
    notes.dispatchEvent(new Event('input', { bubbles: true }));
    await act(async () => { await driveAuth.signOut(); });
    await act(async () => { await driveAuth.signIn(); });
    await vi.waitFor(() => expect($('#library').hidden).toBe(false));
    act(() => { $(`#tab-${tab}`).click(); });
    const restored = document.querySelector<HTMLFormElement>(tab === 'turnos' ? '#appointments-title + form' : '#episode-form')!;
    expect(restored.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('');
  }
});
