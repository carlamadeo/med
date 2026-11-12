import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { EditorDialog } from '@presentation/components/EditorDialog';
import { setEditingStudy, setEditorOpen } from '@presentation/state/store';

it('submits a new study with its selected type', async () => {
  const root = document.createElement('div');
  document.body.append(root);
  const save = vi.fn().mockResolvedValue(undefined);
  await act(() => { render(h(EditorDialog, { onClose: () => {}, onSave: save, error: null, busy: false, availableTypes: ['Otro'] }), root); });
  await act(() => setEditingStudy(null));
  const form = root.querySelector<HTMLFormElement>('form')!;
  (form.elements.namedItem('title') as HTMLInputElement).value = 'Estudio';
  (form.elements.namedItem('date') as HTMLInputElement).value = '2024-01-01';
  const type = form.querySelector<HTMLInputElement>('[name="types"]')!;
  type.checked = true;
  await act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: 'Estudio', date: '2024-01-01', types: ['Otro'] }));
  render(null, root);
  root.remove();
});
afterEach(() => setEditorOpen(false));
