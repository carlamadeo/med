import { act } from 'preact/test-utils';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearFilters, view } from '@presentation/state/store';
import { $, mountPage, reloadLibrary } from './page';

beforeAll(async () => {
  localStorage.setItem('mis-estudios-onboarding-seen', 'true');
  await mountPage();
});

beforeEach(async () => {
  clearFilters();
  act(() => { view.value = 'cronologia'; });
  await reloadLibrary();
});

describe('command palette', () => {
  it('opens with Cmd+K and opens a matching study', async () => {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true }));
    });

    await vi.waitFor(() => expect($('.command-palette')?.hasAttribute('open')).toBe(true));
    const input = $<HTMLInputElement>('#command-input');
    await act(async () => {
      input.value = 'sangre';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await vi.waitFor(() => expect([...document.querySelectorAll('.command-item')].some((element) => element.textContent?.includes('Análisis de sangre'))).toBe(true));
    const item = [...document.querySelectorAll<HTMLElement>('.command-item')]
      .find((element) => element.textContent?.includes('Análisis de sangre'));

    act(() => { item?.click(); });

    await vi.waitFor(() => expect($('#editor')?.hasAttribute('open')).toBe(true));
  });

  it('opens from the topbar search and filters the library from an action', async () => {
    act(() => { $<HTMLButtonElement>('#global-search-trigger').click(); });
    await vi.waitFor(() => expect($('.command-palette')?.hasAttribute('open')).toBe(true));

    const input = $<HTMLInputElement>('#command-input');
    await act(async () => {
      input.value = 'ecografia';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await vi.waitFor(() => expect([...document.querySelectorAll('.command-item')].some((element) => element.textContent?.includes('Ecografía abdominal'))).toBe(true));
    const action = [...document.querySelectorAll<HTMLElement>('.command-item')]
      .find((element) => element.textContent?.includes('Buscar «ecografia» en la biblioteca'));

    act(() => { action?.click(); });

    await vi.waitFor(() => expect($<HTMLInputElement>('#search').value).toBe('ecografia'));
    expect(view.value).toBe('cronologia');
  });
});