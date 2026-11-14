import {act} from 'preact/test-utils';
import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {driveAppointmentRepo} from '@data';
import {appointments, clearFilters, view} from '@presentation/state/store';
import {$, mountPage} from './page';

beforeAll(async () => {
    localStorage.setItem('mis-estudios-onboarding-seen', 'true');
    await mountPage();
});

beforeEach(() => {
    clearFilters();
    act(() => {
        view.value = 'resumen';
    });
});

async function openSummary() {
    act(() => {
        $<HTMLButtonElement>('#nav-resumen').click();
    });
    await vi.waitFor(() => expect($('#resumen')).not.toBeNull());
}

function submitAppointmentForm() {
    const form = $<HTMLFormElement>('#appointment-form');
    act(() => {
        form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
}

describe('appointment dialog', () => {
    it('creates an appointment from the summary', async () => {
        await openSummary();
        act(() => {
            [...document.querySelectorAll<HTMLButtonElement>('#resumen button')]
                .find((button) => button.textContent?.includes('Agendar turno'))?.click();
        });

        await vi.waitFor(() => expect($('#appointment-dialog')?.hasAttribute('open')).toBe(true));
        $<HTMLInputElement>('#appointment-date').value = '2026-11-25';
        $<HTMLInputElement>('#appointment-time').value = '09:30';
        $<HTMLInputElement>('#appointment-professional').value = 'Dr. Nuevo';

        await act(async () => {
            submitAppointmentForm();
        });

        await vi.waitFor(() => expect(appointments.value).toHaveLength(1));
        expect(appointments.value[0]?.professional).toBe('Dr. Nuevo');
        await vi.waitFor(() => expect($('#appointment-dialog')?.hasAttribute('open')).toBe(false));
        expect($('#resumen')?.textContent).toContain('Dr. Nuevo');
    });

    it('marks an existing appointment as completed', async () => {
        const created = await driveAppointmentRepo.save({
            date: '2026-11-20',
            time: '10:30',
            timeZone: 'America/Argentina/Buenos_Aires',
            professional: 'Dra. Pérez',
            notes: 'Control anual',
            status: 'scheduled',
            cost: null,
            coverage: null,
        });
        act(() => {
            appointments.value = [created];
        });

        await openSummary();
        act(() => {
            [...document.querySelectorAll<HTMLButtonElement>('#resumen button')]
                .find((button) => button.textContent?.includes('Editar turno'))?.click();
        });

        await vi.waitFor(() => expect($('#appointment-dialog')?.hasAttribute('open')).toBe(true));
        $<HTMLSelectElement>('#appointment-status').value = 'completed';

        await act(async () => {
            submitAppointmentForm();
        });

        await vi.waitFor(() => expect(appointments.value[0]?.status).toBe('completed'));
        expect(appointments.value).toHaveLength(1);
    });
});