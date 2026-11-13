import { act } from 'preact/test-utils';
import { expect, it, vi } from 'vitest';
import { $, mountPage } from './page';

it('creates a turn and preserves a zero cost', async () => {
  await mountPage();
  act(() => { $('#tab-turnos').click(); });
  const form = document.querySelector<HTMLFormElement>('#appointments-title + form')!;
  (form.elements.namedItem('date') as HTMLInputElement).value = '2026-11-20';
  (form.elements.namedItem('time') as HTMLInputElement).value = '10:30';
  (form.elements.namedItem('timeZone') as HTMLInputElement).value = 'America/Argentina/Buenos_Aires';
  (form.elements.namedItem('cost') as HTMLInputElement).value = '0';
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await vi.waitFor(() => expect(document.querySelector('#appointments-title')?.parentElement?.textContent).toContain('Importe: 0'));
});
