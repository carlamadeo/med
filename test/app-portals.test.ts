import { act } from 'preact/test-utils';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { portals, clearFilters, view } from '@presentation/state/store';
import { $, mountPage, typeInto } from './page';

beforeAll(async () => {
  localStorage.setItem('mis-estudios-onboarding-seen', 'true');
  await mountPage();
});

beforeEach(() => {
  clearFilters();
  act(() => { view.value = 'portales'; });
});

async function openPortals() {
  act(() => { $<HTMLButtonElement>('#tab-portales').click(); });
}

describe('portals directory', () => {
  it('creates and edits a portal from the dialog', async () => {
    await openPortals();
    act(() => {
      [...document.querySelectorAll<HTMLButtonElement>('.portals-head-actions button')]
        .find((button) => button.textContent?.includes('Agregar portal'))?.click();
    });
    await vi.waitFor(() => expect($('#portal-dialog')?.hasAttribute('open')).toBe(true));

    typeInto('#portal-name', 'Hospital Central');
    typeInto('#portal-url', 'https://hospital.example/');
    await act(async () => {
      $<HTMLFormElement>('#portal-form').requestSubmit();
    });

    await vi.waitFor(() => expect(portals.value.some((portal) => portal.displayName === 'Hospital Central')).toBe(true));
    await vi.waitFor(() => expect($('#portals-list')?.textContent).toContain('Hospital Central'));

    const edit = [...document.querySelectorAll<HTMLButtonElement>('#portals-list button')]
      .find((button) => button.textContent?.trim() === 'Editar');
    act(() => { edit?.click(); });
    await vi.waitFor(() => expect($('#portal-dialog')?.hasAttribute('open')).toBe(true));
    expect($<HTMLInputElement>('#portal-name').value).toBe('Hospital Central');

    typeInto('#portal-name', 'Hospital Central Sur');
    await act(async () => {
      $<HTMLFormElement>('#portal-form').requestSubmit();
    });

    await vi.waitFor(() => expect(portals.value.some((portal) => portal.displayName === 'Hospital Central Sur')).toBe(true));
    expect($('#portals-list')?.textContent).toContain('Hospital Central Sur');
  });

  it('filters the cards by name', async () => {
    await openPortals();
    act(() => {
      [...document.querySelectorAll<HTMLButtonElement>('.portals-head-actions button')]
        .find((button) => button.textContent?.includes('Agregar portal'))?.click();
    });
    await vi.waitFor(() => expect($('#portal-dialog')?.hasAttribute('open')).toBe(true));
    typeInto('#portal-name', 'Clínica Norte');
    await act(async () => {
      $<HTMLFormElement>('#portal-form').requestSubmit();
    });
    await vi.waitFor(() => expect(portals.value.some((portal) => portal.displayName === 'Clínica Norte')).toBe(true));

    typeInto('#portal-search', 'norte');
    await vi.waitFor(() => expect(document.querySelectorAll('#portals-list .portal-card')).toHaveLength(1));

    typeInto('#portal-search', 'no-existe');
    await vi.waitFor(() => expect(document.querySelector('#portals-list')).toBeNull());
  });
});