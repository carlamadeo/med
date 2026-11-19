import {act} from 'preact/test-utils';
import {expect, it, vi} from 'vitest';
import {driveAppointmentRepo, driveAuth} from '@data';
import {markSourceUnavailable} from '@presentation/state/store';
import {$, mountPage} from './page';
import {SEED_JSON_ID, SEED_PDF_ID, addRemoteRaw} from './fake-drive';

it('offers the associated attachment when the selected study has no direct attachment', async () => {
    addRemoteRaw('study-association', {
        title: 'Control sin adjunto propio', types: ['Otro'], documentIds: [SEED_PDF_ID],
    });
    await mountPage();
    await act(() => $('#nav-resumen').click());
    await vi.waitFor(() => expect($('[aria-labelledby="next-appointment-title"]')).not.toBeNull());
    const card = $('[aria-labelledby="next-appointment-title"]');
    await act(() => card.querySelector('button')!.click());
    const form = $<HTMLFormElement>('#appointment-form');
    $<HTMLInputElement>('[name="date"]', form).value = '2099-11-20';
    $<HTMLInputElement>('[name="time"]', form).value = '10:30';
    await act(() => $<HTMLInputElement>('[value="study-association"]', form).click());
    await act(async () => {
        form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    await vi.waitFor(() => expect(card.querySelector('a[aria-label="Abrir PDF de Ecografía abdominal"]'))
        .not.toBeNull());
    expect(card.textContent).not.toContain('Sin archivo adjunto');
    expect((await driveAppointmentRepo.list())[0]?.studyIds).toEqual(['study-association']);
});

it('opens the explicitly chosen files and viewers from Próximo turno', async () => {
    addRemoteRaw('study-photo', {
        title: 'Receta fotografiada', reportName: 'receta.png', types: ['Otro'],
    }, 'image/png');
    addRemoteRaw('study-viewer', {
        title: 'Resonancia externa', types: ['Otro'], viewer: 'https://portal.example/viewer/456',
    });
    await mountPage();
    await act(() => $('#nav-resumen').click());
    const selector = '[aria-labelledby="next-appointment-title"]';
    await vi.waitFor(() => expect(document.querySelector(selector)).not.toBeNull());
    const card = $(selector);
    await act(() => card.querySelector('button')!.click());
    const form = $<HTMLFormElement>('#appointment-form');
    $<HTMLInputElement>('[name="date"]', form).value = '2099-11-20';
    $<HTMLInputElement>('[name="time"]', form).value = '10:30';
    $<HTMLSelectElement>('[name="timeZone"]', form).value = 'UTC';
    expect(form.querySelectorAll('input[name="studyId"]')).toHaveLength(4);
    expect(form.querySelectorAll('input[name="studyId"]:checked')).toHaveLength(0);
    await act(() => {
        $<HTMLInputElement>(`[value="${SEED_PDF_ID}"]`, form).click();
        $<HTMLInputElement>(`[value="${SEED_JSON_ID}"]`, form).click();
        $<HTMLInputElement>('[value="study-photo"]', form).click();
        $<HTMLInputElement>('[value="study-viewer"]', form).click();
    });
    await act(() => {
        const search = $<HTMLInputElement>('.appointment-study-picker input[type="search"]', form);
        search.value = 'fotografiada';
        search.dispatchEvent(new Event('input', {bubbles: true}));
    });
    expect(form.querySelectorAll('input[name="studyId"][type="checkbox"]')).toHaveLength(1);
    expect(new FormData(form).getAll('studyId')).toEqual(
        expect.arrayContaining([SEED_PDF_ID, SEED_JSON_ID, 'study-photo', 'study-viewer']),
    );
    await act(async () => {
        form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });

    await vi.waitFor(() => expect(card.querySelector('a[aria-label="Abrir PDF de Ecografía abdominal"]')?.getAttribute('href'))
        .toBe(`https://drive.google.com/file/d/${SEED_PDF_ID}/view`));
    expect(card.querySelector('a[aria-label="Abrir imagen de Receta fotografiada"]')?.getAttribute('href'))
        .toBe('https://drive.google.com/file/d/study-photo/view');
    expect(card.querySelector('a[aria-label="Abrir visor de Ecografía abdominal"]')?.getAttribute('href'))
        .toBe('https://portal.hospital.com/viewer/123');
    const viewer = 'a[aria-label="Abrir visor de Resonancia externa"]';
    expect(card.querySelector(viewer)?.getAttribute('href')).toBe('https://portal.example/viewer/456');
    expect(card.textContent).toContain('Análisis de sangre');
    expect(card.textContent).toContain('Sin archivo adjunto');
    expect(card.querySelector(`a[href*="/${SEED_JSON_ID}/"]`)).toBeNull();
    expect((await driveAppointmentRepo.list())[0]?.studyIds).toEqual(
        expect.arrayContaining([SEED_PDF_ID, SEED_JSON_ID, 'study-photo', 'study-viewer']),
    );

    await act(() => markSourceUnavailable('https://portal.example/viewer/456'));
    expect(card.querySelector(viewer)).toBeNull();
    expect(card.textContent).toContain('Visor no disponible');

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await act(() => {
        window.dispatchEvent(new Event('offline'));
    });
    expect(card.querySelector('a')).toBeNull();
    expect(card.textContent).toContain('Conectate para abrir el archivo');
    expect(card.textContent).toContain('Conectate para abrir el visor');

    await act(() => card.querySelector('button')!.click());
    expect($('#appointment-form').querySelectorAll('input[name="studyId"]:checked')).toHaveLength(4);
    await act(async () => {
        await driveAuth.signOut();
    });
    expect($<HTMLDialogElement>('#appointment-dialog').open).toBe(false);
    expect(document.querySelector('#appointment-form')).toBeNull();
});
