import { beforeAll, expect, it, vi } from 'vitest';
import { act } from 'preact/test-utils';
import axe from 'axe-core';
import { isEditorOpen, setEditingStudy, studies, view } from '@presentation/state/store';
import { mountPage, reloadLibrary } from './page';

const views = ['resumen', 'cronologia', 'portales', 'operaciones', 'turnos', 'eventos', 'episodios', 'intake'] as const;

async function seriousViolations() {
  const results = await axe.run(document, { rules: { 'color-contrast': { enabled: false } } });
  return results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
}

beforeAll(() => mountPage());

for (const name of views) {
  it(`has no serious accessibility violations in ${name}`, async () => {
    await act(async () => { view.value = name; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await seriousViolations()).toEqual([]);
  }, 60000);
}

it('has no serious accessibility violations in the editor', async () => {
  await reloadLibrary();
  await vi.waitFor(() => expect(studies.value.length).toBeGreaterThan(0));
  const study = studies.value[0];
  if (!study) throw new Error('missing study');
  await act(async () => { setEditingStudy(study); isEditorOpen.value = true; });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(await seriousViolations()).toEqual([]);
}, 60000);