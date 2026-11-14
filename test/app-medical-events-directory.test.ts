import {act} from 'preact/test-utils';
import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {medicalEvents, view} from '@presentation/state/store';
import type {MedicalEvent} from '@domain/models';
import {$, mountPage, typeInto} from './page';

const base: MedicalEvent = {
    id: 'e1',
    kind: 'consultation',
    date: '2026-11-05',
    doctor: 'Dra. Pérez',
    notes: 'Control anual',
    studyIds: [],
    documentIds: [],
    revision: '1',
};

const prescription: MedicalEvent = {
    ...base,
    id: 'e2',
    kind: 'prescription',
    date: '2026-10-20',
    notes: 'Amoxicilina 500 mg',
};

beforeAll(async () => {
    localStorage.setItem('mis-estudios-onboarding-seen', 'true');
    await mountPage();
});

beforeEach(() => {
    act(() => {
        view.value = 'eventos';
    });
});

async function openEvents() {
    act(() => {
        $<HTMLButtonElement>('#tab-eventos').click();
    });
}

describe('medical events directory', () => {
    it('filters by kind and professional', async () => {
        await openEvents();
        act(() => {
            medicalEvents.value = [base, prescription];
        });
        await vi.waitFor(() => expect(document.querySelectorAll('#events-list .event-card')).toHaveLength(2));

        await act(async () => {
            typeInto('#event-search', 'receta');
        });
        await vi.waitFor(() => expect(document.querySelectorAll('#events-list .event-card')).toHaveLength(1));

        await act(async () => {
            typeInto('#event-search', 'perez');
        });
        await vi.waitFor(() => expect(document.querySelectorAll('#events-list .event-card')).toHaveLength(2));
    });

    it('opens the add dialog and creates an event', async () => {
        await openEvents();
        await act(async () => {
            typeInto('#event-search', '');
        });
        act(() => {
            medicalEvents.value = [];
        });

        act(() => {
            [...document.querySelectorAll<HTMLButtonElement>('.events-head-actions button')]
                .find((button) => button.textContent?.includes('Agregar consulta'))?.click();
        });
        await vi.waitFor(() => expect($('#event-dialog')?.hasAttribute('open')).toBe(true));

        typeInto('#event-date', '2026-12-01');
        typeInto('#event-notes', 'Consulta de prueba');
        await act(async () => {
            $<HTMLFormElement>('#event-form').requestSubmit();
        });

        await vi.waitFor(() => expect(medicalEvents.value.some((event) => event.notes === 'Consulta de prueba')).toBe(true));
        expect($('#events-list')?.textContent).toContain('Consulta de prueba');
    });
});