import {act} from 'preact/test-utils';
import {afterEach, expect, it, vi} from 'vitest';
import JSZip from 'jszip';
import {driveAppointmentRepo, driveAuth, driveStudyRepo} from '@data';
import {appointments, directoriesReady, markSourceUnavailable} from '@presentation/state/store';
import {$, mountPage} from './page';
import {SEED_JSON_ID, SEED_PDF_ID, addRemoteRaw, fakeDriveFile} from './fake-drive';

afterEach(() => vi.unstubAllGlobals());

async function openConsultation(studyIds: string[]) {
    await mountPage();
    await vi.waitFor(() => expect(directoriesReady.value).toBe(true));
    const appointment = await driveAppointmentRepo.save({
        date: '2099-11-20', time: '10:30', timeZone: 'UTC', professional: 'Profesional externo',
        status: 'scheduled', reminderMinutes: null, cost: null, coverage: null, notes: 'Nota privada',
        studyIds,
    });
    await act(() => {
        appointments.value = [appointment];
        $('#nav-turnos').click();
    });
    const card = $('.appointment-card');
    const prepare = () => [...card.querySelectorAll('button')].find(button => button.textContent === 'Preparar consulta');
    await vi.waitFor(() => expect(prepare()).toBeDefined());
    await act(() => prepare()!.click());
    return $<HTMLDialogElement>('dialog[open][aria-label="Preparar consulta"]');
}

function captureDownload() {
    const download = vi.fn<(blob: Blob) => string>().mockReturnValue('blob:consulta');
    vi.stubGlobal('URL', Object.assign(class extends URL {}, {createObjectURL: download, revokeObjectURL: vi.fn()}));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    return download;
}

function consultationButton(dialog: HTMLDialogElement, label: string) {
    const button = [...dialog.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
    expect(button).toBeDefined();
    return button!;
}

function mockNativeShare(supported: boolean) {
    const share = vi.fn<(data: ShareData) => Promise<void>>().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', new Proxy(navigator, {
        get(target, property) {
            if (property === 'share') return share;
            if (property === 'canShare') return () => supported;
            return Reflect.get(target, property, target);
        },
    }));
    return share;
}

it('shares the selected reports as separate attachments and only sends explicitly selected viewer links', async () => {
    fakeDriveFile(SEED_PDF_ID)!.content = '%PDF-ecografia';
    addRemoteRaw('study-report', {
        title: 'Segundo informe', types: ['Otro'], viewer: 'https://portal.example/segundo',
    }, 'image/png');
    const png = '\x89PNG\r\n\x1a\n';
    fakeDriveFile('study-report')!.content = png;
    const share = mockNativeShare(true);
    const dialog = await openConsultation([SEED_PDF_ID, 'study-report']);
    await act(() => dialog.querySelectorAll<HTMLInputElement>('[data-source="viewer"]')[1]!.click());
    await act(() => consultationButton(dialog, 'Preparar para compartir').click());
    await vi.waitFor(() => expect(consultationButton(dialog, 'Compartir archivos').disabled).toBe(false));
    expect(share).not.toHaveBeenCalled();
    await act(() => consultationButton(dialog, 'Compartir archivos').click());

    await vi.waitFor(() => expect(share).toHaveBeenCalledOnce());
    const payload = share.mock.calls[0]![0];
    expect(payload.text).toBe('https://portal.example/segundo');
    expect(payload.files?.map(file => [file.name, file.type])).toEqual([
        ['archivo-1.pdf', 'application/pdf'], ['archivo-2.png', 'image/png'],
    ]);
    expect(await payload.files![0]!.text()).toBe('%PDF-ecografia');
    expect(Buffer.from(await payload.files![1]!.arrayBuffer()).toString('latin1')).toBe(png);
});

it('lets the user download a standalone attachment when the browser rejects native sharing', async () => {
    fakeDriveFile(SEED_PDF_ID)!.content = '%PDF-ecografia';
    const share = mockNativeShare(false);
    const dialog = await openConsultation([SEED_PDF_ID]);
    const download = captureDownload();
    await act(() => consultationButton(dialog, 'Preparar para compartir').click());
    await vi.waitFor(() => expect(consultationButton(dialog, 'Descargar archivo-1.pdf').disabled).toBe(false));
    await act(() => consultationButton(dialog, 'Descargar archivo-1.pdf').click());

    expect(share).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
    const file = download.mock.calls[0]![0];
    expect(file.type).toBe('application/pdf');
    expect(await file.text()).toBe('%PDF-ecografia');
});

it('downloads one copy of each selected report and only explicitly selected viewer links', async () => {
    const bytes = '%PDF-consulta';
    fakeDriveFile(SEED_PDF_ID)!.content = bytes;
    addRemoteRaw('study-association', {
        title: 'Control sin adjunto propio', types: ['Otro'], documentIds: [SEED_PDF_ID],
        viewer: 'https://portal.example/consulta',
    });
    const dialog = await openConsultation([SEED_PDF_ID, 'study-association']);
    expect(document.querySelectorAll(`.appointment-card a[href*="/${SEED_PDF_ID}/"]`)).toHaveLength(1);
    expect(dialog.querySelectorAll('input[type="checkbox"][data-source="attachment"]')).toHaveLength(1);
    const viewers = [...dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-source="viewer"]')];
    expect(viewers).toHaveLength(2);
    expect(viewers.every(viewer => !viewer.checked)).toBe(true);
    expect(dialog.textContent).not.toContain('Análisis de sangre');
    await act(() => viewers[1]!.click());
    const download = captureDownload();
    await act(() => {
        dialog.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
    const zip = await JSZip.loadAsync(await download.mock.calls[0]![0].arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(['archivo-1.pdf', 'enlaces.txt']);
    expect(await zip.file('archivo-1.pdf')?.async('string')).toBe(bytes);
    expect(await zip.file('enlaces.txt')?.async('string')).toBe('https://portal.example/consulta\n');
});

it('discards a package still being prepared when the account signs out', async () => {
    const dialog = await openConsultation([SEED_PDF_ID]);
    const download = captureDownload();
    const attachment = Promise.withResolvers<File>();
    const read = vi.spyOn(driveStudyRepo, 'getDocumentFile').mockReturnValue(attachment.promise);
    await act(() => {
        dialog.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    await act(async () => { await driveAuth.signOut(); });
    await act(() => attachment.resolve(new File(['%PDF-consulta'], 'consulta.pdf', {type: 'application/pdf'})));
    expect(dialog.open).toBe(false);
    expect(download).not.toHaveBeenCalled();
});

it('offers the associated attachment when the selected study has no direct attachment', async () => {
    addRemoteRaw('study-association', {
        title: 'Control sin adjunto propio', types: ['Otro'], documentIds: [SEED_PDF_ID],
    });
    await mountPage();
    await vi.waitFor(() => expect(directoriesReady.value).toBe(true));
    await act(() => $('#nav-turnos').click());
    await act(() => $('.appointments-head button').click());
    const form = $<HTMLFormElement>('#appointment-form');
    $<HTMLInputElement>('[name="date"]', form).value = '2099-11-20';
    $<HTMLInputElement>('[name="time"]', form).value = '10:30';
    await act(() => $<HTMLInputElement>('[value="study-association"]', form).click());
    await act(async () => {
        form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    await vi.waitFor(() => expect(document.querySelector('.appointment-card a[aria-label="Abrir PDF de Ecografía abdominal"]'))
        .not.toBeNull());
    expect($('.appointment-card').textContent).not.toContain('Sin archivo adjunto');
    expect((await driveAppointmentRepo.list())[0]?.studyIds).toEqual(['study-association']);
});

it('shows the next appointment as read-only in Resumen and opens its files and viewers in Turnos', async () => {
    addRemoteRaw('study-photo', {
        title: 'Receta fotografiada', reportName: 'receta.png', types: ['Otro'],
    }, 'image/png');
    addRemoteRaw('study-viewer', {
        title: 'Resonancia externa', types: ['Otro'], viewer: 'https://portal.example/viewer/456',
    });
    await mountPage();
    await vi.waitFor(() => expect(directoriesReady.value).toBe(true));
    await act(() => $('#nav-turnos').click());
    await act(() => $('.appointments-head button').click());
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

    await vi.waitFor(() => expect(document.querySelector('.appointment-card a[aria-label="Abrir PDF de Ecografía abdominal"]')?.getAttribute('href'))
        .toBe(`https://drive.google.com/file/d/${SEED_PDF_ID}/view`));
    await act(() => $('#nav-resumen').click());
    const nextAppointment = $('[aria-labelledby="next-appointment-title"]');
    expect(nextAppointment.textContent).toContain('10:30');
    expect(nextAppointment.querySelector('button, a[href], input, select, summary, [tabindex]')).toBeNull();

    await act(() => $('#nav-turnos').click());
    const card = $('.appointment-card');
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

    await act(() => [...card.querySelectorAll('button')].find(button => button.textContent === 'Editar turno')!.click());
    expect($('#appointment-form').querySelectorAll('input[name="studyId"]:checked')).toHaveLength(4);
    await act(async () => {
        await driveAuth.signOut();
    });
    expect($<HTMLDialogElement>('#appointment-dialog').open).toBe(false);
    expect(document.querySelector('#appointment-form')).toBeNull();
});
