import { expect, it } from 'vitest';
import { view } from '@presentation/state/store';

it('opens the signed-in archive on the summary view', () => {
  expect(view.value).toBe('resumen');
});
