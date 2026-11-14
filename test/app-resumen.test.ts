import {act} from 'preact/test-utils';
import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {clearFilters, view} from '@presentation/state/store';
import {$, mountPage, reloadLibrary} from './page';

beforeAll(() => mountPage());

beforeEach(async () => {
    clearFilters();
    act(() => {
        view.value = 'cronologia';
    });
    await reloadLibrary();
});

describe('resumen', () => {
    it('shows the KPIs, activity chart, next appointment and recent studies', async () => {
        await vi.waitFor(() => expect(document.querySelectorAll('#results li.record')).toHaveLength(2));
        act(() => {
            $<HTMLButtonElement>('#nav-resumen').click();
        });

        await vi.waitFor(() => expect($('#resumen')).not.toBeNull());
        const summary = $('#resumen');
        expect(summary.textContent).toContain('Estudios totales');
        expect(summary.textContent).toContain('Análisis de sangre');
        expect(summary.textContent).toContain('No hay turnos próximos.');
        expect(summary.querySelectorAll('.kpi-card')).toHaveLength(4);
        expect(summary.querySelectorAll('.study-title')).toHaveLength(2);
        expect(summary.querySelectorAll('.activity-dot')).toHaveLength(6);
        expect(summary.querySelector('.activity-line')).not.toBeNull();
        expect(summary.textContent).toContain('Todo sincronizado');
    });

    it('opens the appointments view from the next-appointment card', async () => {
        await vi.waitFor(() => expect(document.querySelectorAll('#results li.record')).toHaveLength(2));
        act(() => {
            $<HTMLButtonElement>('#nav-resumen').click();
        });
        await vi.waitFor(() => expect($('#resumen')).not.toBeNull());

        const button = [...document.querySelectorAll<HTMLButtonElement>('#resumen button')]
            .find((item) => item.textContent?.includes('Agendar turno'));

        act(() => {
            button?.click();
        });

        await vi.waitFor(() => expect($('#appointments-title')).not.toBeNull());
        expect(view.value).toBe('turnos');
    });
});