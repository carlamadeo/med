import {act} from 'preact/test-utils';
import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {clearFilters, operations, view} from '@presentation/state/store';
import type {Operation} from '@domain/models';
import {$, mountPage, typeInto} from './page';

const base: Operation = {
    id: 'op1',
    name: 'Rinoplastia',
    date: '2026-10-15',
    surgeon: 'Dr. Gómez',
    institution: 'Hospital Italiano',
    type: 'Cirugía estética',
    notes: '',
    color: '',
    revision: '1',
    studyIds: [],
};

const second: Operation = {
    ...base,
    id: 'op2',
    name: 'Artroscopía de rodilla',
    date: '2026-08-22',
};

beforeAll(async () => {
    localStorage.setItem('mis-estudios-onboarding-seen', 'true');
    await mountPage();
});

beforeEach(() => {
    clearFilters();
    act(() => {
        view.value = 'operaciones';
    });
});

async function openOperations() {
    act(() => {
        $<HTMLButtonElement>('#tab-operaciones').click();
    });
}

describe('operations directory', () => {
    it('filters operations and opens the add dialog', async () => {
        await openOperations();
        act(() => {
            operations.value = [base, second];
        });
        await vi.waitFor(() => expect(document.querySelectorAll('#operations-list .operation-card')).toHaveLength(2));

        await act(async () => {
            typeInto('#operation-search', 'rodilla');
        });
        await vi.waitFor(() => expect(document.querySelectorAll('#operations-list .operation-card')).toHaveLength(1));

        await act(async () => {
            typeInto('#operation-search', '');
        });
        act(() => {
            [...document.querySelectorAll<HTMLButtonElement>('.operations-head-actions button')]
                .find((button) => button.textContent?.includes('Agregar operación'))?.click();
        });
        await vi.waitFor(() => expect($('#operation-dialog')?.hasAttribute('open')).toBe(true));

        typeInto('#operation-name', 'Cirugía nueva');
        typeInto('#operation-date', '2026-12-01');
        typeInto('#operation-type', 'Procedimiento');
        await act(async () => {
            $<HTMLFormElement>('#operation-form').requestSubmit();
        });

        await vi.waitFor(() => expect(operations.value.some((operation) => operation.name === 'Cirugía nueva')).toBe(true));
        expect($('#operations-list')?.textContent).toContain('Cirugía nueva');
    });
});