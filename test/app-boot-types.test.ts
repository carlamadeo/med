/** The study type catalogue gates "Agregar estudio": the form needs its checkboxes before it can be used. */
import { http, HttpResponse } from 'msw';
import { expect, it, vi } from 'vitest';
import { $, mountPage, TYPES } from './page';

it('keeps "Agregar estudio" disabled until the study types have loaded', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await mountPage({
    signIn: false,
    types: http.get('*/types.json', async () => {
      await gate;
      return HttpResponse.json(TYPES);
    }),
  });

  await vi.waitFor(() => expect($<HTMLButtonElement>('[data-add]').disabled).toBe(true));
  expect(document.querySelectorAll('#study-types .type-option')).toHaveLength(0);
  expect($<HTMLSelectElement>('#type').options).toHaveLength(1); // just "Todos los tipos"

  release();

  await vi.waitFor(() => expect($<HTMLButtonElement>('[data-add]').disabled).toBe(false));
  expect(document.querySelectorAll('#study-types .type-option')).toHaveLength(TYPES.length);
  expect($<HTMLSelectElement>('#type').options).toHaveLength(TYPES.length + 1);
});
