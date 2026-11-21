import {http, HttpResponse} from 'msw';
import {render} from 'preact';
import {act} from 'preact/test-utils';
import {afterEach, expect, it, vi} from 'vitest';
import {driveAppointmentRepo, driveAuth} from '@data';
import {fakeCalendarEvents, fakeCalendars} from './fake-calendar';
import {$, mountPage} from './page';
import {server} from './server';

afterEach(async () => {
    const app = document.getElementById('app');
    if (app) render(null, app);
    await driveAuth.signOut();
});

it('creates a turn and preserves a zero cost', async () => {
    await mountPage();
    act(() => $('#nav-turnos').click());
    act(() => $('.appointments-head button').click());
    const form = document.querySelector<HTMLFormElement>('#appointment-form')!;
    expect(document.querySelector('#appointment-reminder')).toBeNull();
    expect(document.querySelector('#appointment-dialog')?.textContent).not.toContain(
        'Activar recordatorios del navegador',
    );
    (form.elements.namedItem('date') as HTMLInputElement).value = '2026-11-20';
    (form.elements.namedItem('time') as HTMLInputElement).value = '10:30';
    (form.elements.namedItem('timeZone') as HTMLInputElement).value = 'America/Argentina/Buenos_Aires';
    (form.elements.namedItem('cost') as HTMLInputElement).value = '0';
    await act(async () => {
        form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    await vi.waitFor(() => expect($<HTMLDialogElement>('#appointment-dialog').open).toBe(false));
    expect(document.querySelector('.appointments')?.textContent).toContain('Importe: 0');
    expect(document.querySelector('.appointments')?.textContent).not.toContain('Agregar al calendario');
    expect(fakeCalendars()).toHaveLength(1);
    const cal = fakeCalendars()[0]!;
    expect(cal.summary).toBe('Turnos');
    expect(fakeCalendarEvents(cal.id)[0]).toMatchObject({
        summary: 'Turno médico',
        status: 'confirmed',
    });
});

it('syncs appointment location, doctor, edits and deletes with Google Calendar', async () => {
    await mountPage();
    act(() => $('#nav-turnos').click());
    act(() => $('.appointments-head button').click());
    const form = document.querySelector<HTMLFormElement>('#appointment-form')!;
    (form.elements.namedItem('date') as HTMLInputElement).value = '2026-11-25';
    (form.elements.namedItem('time') as HTMLInputElement).value = '14:30';
    (form.elements.namedItem('timeZone') as HTMLInputElement).value = 'America/Argentina/Buenos_Aires';
    (form.elements.namedItem('professional') as HTMLInputElement).value = 'Dra. Perez';
    (form.elements.namedItem('specialty') as HTMLInputElement).value = 'Cardiología';
    (form.elements.namedItem('location') as HTMLInputElement).value = 'Av. Santa Fe 1234';
    (form.elements.namedItem('reason') as HTMLTextAreaElement).value = '  Control anual  ';
    await act(async () => {
        form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    await vi.waitFor(() => expect($<HTMLDialogElement>('#appointment-dialog').open).toBe(false));
    expect($('.appointments').textContent).toContain('Av. Santa Fe 1234');
    expect($('.appointments').textContent).toContain('Dra. Perez');
    expect($('.appointments').textContent).not.toContain('Agregar al calendario');
    expect((await driveAppointmentRepo.list())[0]?.reason).toBe('Control anual');

    const cal = fakeCalendars()[0]!;
    expect(cal.summary).toBe('Turnos');
    expect(fakeCalendarEvents(cal.id)[0]).toMatchObject({
        summary: 'Dra. Perez',
        location: 'Av. Santa Fe 1234',
        description: 'Especialidad: Cardiología\nLugar: Av. Santa Fe 1234',
        reminders: {
            useDefault: false,
            overrides: [
                {method: 'popup', minutes: 10290},
                {method: 'popup', minutes: 1650},
            ],
        },
    });

    const editBtn = [...document.querySelectorAll<HTMLButtonElement>('#appointments-list button')].find(
        (button) => button.textContent === 'Editar turno',
    )!;
    act(() => editBtn.click());
    const editForm = document.querySelector<HTMLFormElement>('#appointment-form')!;
    (editForm.elements.namedItem('time') as HTMLInputElement).value = '15:00';
    (editForm.elements.namedItem('location') as HTMLInputElement).value = 'Sede Belgrano';
    (editForm.elements.namedItem('reason') as HTMLTextAreaElement).value = '   ';
    await act(async () => {
        editForm.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    await vi.waitFor(() => expect($<HTMLDialogElement>('#appointment-dialog').open).toBe(false));
    expect($('.appointments').textContent).toContain('Sede Belgrano');
    expect((await driveAppointmentRepo.list())[0]?.reason).toBeUndefined();
    expect(fakeCalendarEvents(cal.id)[0]).toMatchObject({
        location: 'Sede Belgrano',
        reminders: {
            useDefault: false,
            overrides: [
                {method: 'popup', minutes: 10320},
                {method: 'popup', minutes: 1680},
            ],
        },
    });

    const deleteBtn = [...document.querySelectorAll<HTMLButtonElement>('#appointments-list button')].find(
        (button) => button.textContent === 'Eliminar',
    )!;
    act(() => deleteBtn.click());
    const confirmBtn = [...document.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find(
        (button) => button.textContent === 'Eliminar turno',
    )!;
    await act(async () => {
        confirmBtn.click();
    });
    await vi.waitFor(() => expect(fakeCalendarEvents(cal.id)[0]?.status).toBe('cancelled'));
});

it('preserves the appointment in Drive and warns inside the dialog if Google Calendar fails', async () => {
    server.use(
        http.post('https://www.googleapis.com/calendar/v3/calendars', () => new HttpResponse(null, {status: 403})),
    );
    await mountPage();
    act(() => $('#nav-turnos').click());
    act(() => $('.appointments-head button').click());
    const form = document.querySelector<HTMLFormElement>('#appointment-form')!;
    (form.elements.namedItem('date') as HTMLInputElement).value = '2026-11-25';
    (form.elements.namedItem('time') as HTMLInputElement).value = '14:30';
    (form.elements.namedItem('timeZone') as HTMLInputElement).value = 'America/Argentina/Buenos_Aires';
    (form.elements.namedItem('professional') as HTMLInputElement).value = 'Dra. Perez';
    (form.elements.namedItem('location') as HTMLInputElement).value = 'Av. Santa Fe 1234';
    await act(async () => {
        form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    await vi.waitFor(() =>
        expect($<HTMLDialogElement>('#appointment-dialog').textContent).toContain(
            'El turno se guardó en Drive, pero no se pudo sincronizar con Google Calendar',
        ),
    );
    expect($<HTMLDialogElement>('#appointment-dialog').open).toBe(true);
    expect($('.appointments').textContent).toContain('Dra. Perez');
    expect($('.appointments').textContent).toContain('Av. Santa Fe 1234');
});
