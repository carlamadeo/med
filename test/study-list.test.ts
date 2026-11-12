import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { StudyList } from '@presentation/components/StudyList';
import { clearFilters, setStudies } from '@presentation/state/store';

const root = document.createElement('div');
afterEach(() => { render(null, root); setStudies([]); clearFilters(); vi.restoreAllMocks(); });

it('shows loaded studies instead of remaining on the loading placeholder', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  setStudies([{ id: 'one', title: 'Estudio visible', date: '2024-01-01', types: [], doctor: '', portal: '', viewer: '', reportName: '', hasPdf: false, driveFileId: 'one', driveModifiedTime: '', revision: '1' }]);
  await act(() => { render(h(StudyList, { onEdit: () => {}, onDelete: () => {} }), root); });
  expect(root.textContent).toContain('Estudio visible');
});

it('prepares all filtered studies for printing and removes the temporary copy afterwards', async () => {
  const base = { date: '2024-01-01', types: ['Otro'], doctor: '', portal: '', viewer: '', reportName: '', hasPdf: false, driveModifiedTime: '', revision: '1' };
  setStudies(Array.from({ length: 200 }, (_, index) => ({ ...base, id: String(index), driveFileId: String(index), title: `Estudio ${index}` })));
  await act(() => { render(h(StudyList, { onEdit: () => {}, onDelete: () => {} }), root); });
  expect(root.querySelector('.print-results')?.children).toHaveLength(0);
  window.dispatchEvent(new Event('beforeprint'));
  expect(root.querySelector('.print-results')?.children).toHaveLength(200);
  window.dispatchEvent(new Event('afterprint'));
  expect(root.querySelector('.print-results')?.children).toHaveLength(0);
});
