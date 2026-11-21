import {render} from 'preact';
import {act} from 'preact/test-utils';
import {afterEach, expect, it, vi} from 'vitest';
import {driveAuth, driveDoctorRepo} from '@data';
import {Outbox} from '@data/outbox';
import {
    appointments,
    closeAppointmentEditor,
    directoriesReady,
    doctors,
    resetLibraryFilters,
    setStudies,
    studiesReady,
    view,
} from '@presentation/state/store';
import {fakeCalendarEvents, fakeCalendars} from './fake-calendar';
import {fakeDriveFile} from './fake-drive';
import {$, mountPage, typeInto} from './page';

const queue = new Outbox();

afterEach(async () => {
    const app = document.getElementById('app');
    if (app) render(null, app);
    for (const entry of await queue.list('account-one')) await queue.discard('account-one', entry.id!);
    doctors.value = [];
    appointments.value = [];
    setStudies([]);
    resetLibraryFilters();
    closeAppointmentEditor();
    view.value = 'cronologia';
    await driveAuth.signOut();
});

it('orders doctors by study count descending rather than alphabetically', async () => {
    await mountPage();
    await vi.waitFor(() => expect(studiesReady.value).toBe(true));

    const base = {
        date: '2026-01-01',
        portal: '',
        viewer: '',
        reportName: '',
        hasPdf: false,
        driveModifiedTime: '',
        revision: '1',
        types: ['Otro'],
    };
    await act(() => {
        setStudies([
            {...base, id: '1', driveFileId: '1', title: 'Estudio 1', doctor: 'Dr. Álvarez'},
            {...base, id: '2', driveFileId: '2', title: 'Estudio 2', doctor: 'Dra. Zeta'},
            {...base, id: '3', driveFileId: '3', title: 'Estudio 3', doctor: 'Dra. Zeta'},
            {...base, id: '4', driveFileId: '4', title: 'Estudio 4', doctor: 'Dra. Zeta'},
            {...base, id: '5', driveFileId: '5', title: 'Estudio 5', doctor: 'Dr. Medio'},
            {...base, id: '6', driveFileId: '6', title: 'Estudio 6', doctor: 'Dr. Medio'},
        ]);
    });

    await act(() => $<HTMLButtonElement>('#nav-medicos').click());
    const headings = [...document.querySelectorAll('#doctors-list h3')].map((el) => el.textContent);
    expect(headings).toEqual(['Dra. Zeta', 'Dr. Medio', 'Dr. Álvarez']);
});

it('creates, edits, and deletes a doctor with specialty and default address while keeping studies', async () => {
    await mountPage();
    await vi.waitFor(() => expect(studiesReady.value).toBe(true));
    await act(() => $<HTMLButtonElement>('#nav-medicos').click());

    // Open new doctor dialog
    const addBtn = [...document.querySelectorAll<HTMLButtonElement>('.portals-head-actions button')].find((b) =>
        b.textContent?.includes('Agregar médico'),
    )!;
    await act(() => addBtn.click());
    expect($<HTMLDialogElement>('#doctor-dialog').open).toBe(true);

    await act(() => {
        typeInto('#doctor-name', 'Dra. Ana Pérez');
        typeInto('#doctor-specialty', 'Cardiología');
        const firstAddr = document.querySelector<HTMLInputElement>('input[aria-label="Dirección 1"]')!;
        firstAddr.value = 'Av. Santa Fe 1234';
        firstAddr.dispatchEvent(new Event('input', {bubbles: true}));
    });

    const addAddressBtn = [...document.querySelectorAll<HTMLButtonElement>('#doctor-form button')].find(
        (b) => b.textContent?.trim() === 'Agregar dirección',
    )!;
    await act(() => addAddressBtn.click());

    await act(() => {
        const secondAddr = document.querySelector<HTMLInputElement>('input[aria-label="Dirección 2"]')!;
        secondAddr.value = 'Av. Cabildo 456';
        secondAddr.dispatchEvent(new Event('input', {bubbles: true}));
        const radios = document.querySelectorAll<HTMLInputElement>('input[name="defaultAddressUid"]');
        radios[1]!.checked = true;
        radios[1]!.dispatchEvent(new Event('change', {bubbles: true}));
    });

    await act(async () => {
        $<HTMLFormElement>('#doctor-form').requestSubmit();
    });
    await vi.waitFor(() => expect($<HTMLDialogElement>('#doctor-dialog').open).toBe(false));

    const savedList = await driveDoctorRepo.list();
    const perez = savedList.find((d) => d.name === 'Dra. Ana Pérez');
    expect(perez).toMatchObject({
        name: 'Dra. Ana Pérez',
        specialty: 'Cardiología',
        addresses: ['Av. Santa Fe 1234', 'Av. Cabildo 456'],
        defaultAddress: 'Av. Cabildo 456',
    });

    const card = [...document.querySelectorAll('#doctors-list > li')].find((li) =>
        li.textContent?.includes('Dra. Ana Pérez'),
    )!;
    expect(card.textContent).toContain('Cardiología');
    const addrItems = [...card.querySelectorAll('.doctor-address-item')];
    expect(addrItems).toHaveLength(2);
    expect(addrItems[0]?.textContent).toContain('Av. Cabildo 456');
    expect(addrItems[0]?.textContent).toContain('Predeterminada');
    expect(addrItems[1]?.textContent).toContain('Av. Santa Fe 1234');

    // Attempt creating duplicate doctor name
    await act(() => addBtn.click());
    await act(() => {
        typeInto('#doctor-name', 'dra. ana perez');
    });
    await act(async () => {
        $<HTMLFormElement>('#doctor-form').requestSubmit();
    });
    expect(document.querySelector('#doctor-form [role="alert"]')?.textContent).toContain('Ya existe otro médico');
    await act(() => {
        [...document.querySelectorAll<HTMLButtonElement>('#doctor-form button')]
            .find((b) => b.textContent?.trim() === 'Cancelar')!
            .click();
    });

    // Delete saved doctor profile while study remains in library
    const deleteBtn = card.querySelector<HTMLButtonElement>('button[aria-label="Eliminar ficha de Dra. Ana Pérez"]')!;
    await act(() => deleteBtn.click());
    const confirmBtn = [...document.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find(
        (b) => b.textContent?.trim() === 'Eliminar ficha',
    )!;
    await act(async () => {
        confirmBtn.click();
    });
    await vi.waitFor(async () => expect((await driveDoctorRepo.list()).some((d) => d.name === 'Dra. Ana Pérez')).toBe(false));
    // Dra. Ana Pérez still appears in directory via her seed study, without saved profile addresses
    await vi.waitFor(() => {
        const remainingCard = [...document.querySelectorAll('#doctors-list > li')].find((li) =>
            li.textContent?.includes('Dra. Ana Pérez'),
        );
        expect(remainingCard?.querySelectorAll('.doctor-address-item')).toHaveLength(0);
    });
});

it('preloads specialty and addresses (default first) when selecting a doctor in an appointment', async () => {
    await mountPage();
    await vi.waitFor(() => expect(directoriesReady.value).toBe(true));

    const docOne = await driveDoctorRepo.save({
        name: 'Dra. Lucía Gómez',
        specialty: 'Neurología',
        addresses: ['Sede Norte 111', 'Sede Central 222'],
        defaultAddress: 'Sede Central 222',
    });
    const docTwo = await driveDoctorRepo.save({
        name: 'Dr. Marcos Silva',
        specialty: 'Dermatología',
        addresses: ['Consultorio Sur 333'],
        defaultAddress: 'Consultorio Sur 333',
    });
    await act(() => {
        doctors.value = [docOne, docTwo];
    });

    act(() => $<HTMLButtonElement>('#nav-turnos').click());
    act(() => $<HTMLButtonElement>('.appointments-head button').click());

    const profInput = $<HTMLInputElement>('#appointment-professional');
    await act(() => {
        profInput.focus();
    });
    expect(document.querySelector('#appointment-professionals')).not.toBeNull();
    const optionGomez = [...document.querySelectorAll<HTMLButtonElement>('#appointment-professionals button')].find((b) =>
        b.textContent?.includes('Dra. Lucía Gómez'),
    )!;
    expect(optionGomez).toBeDefined();

    await act(() => optionGomez.click());
    expect($<HTMLInputElement>('#appointment-specialty').value).toBe('Neurología');
    expect($<HTMLInputElement>('#appointment-location').value).toBe('Sede Central 222');

    const addrButtons = [...document.querySelectorAll<HTMLButtonElement>('.appointment-address-option')];
    expect(addrButtons).toHaveLength(2);
    expect(addrButtons[0]?.textContent).toContain('Sede Central 222');
    expect(addrButtons[0]?.textContent).toContain('Predeterminada');
    expect(addrButtons[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(addrButtons[1]?.textContent).toContain('Sede Norte 111');
    expect(addrButtons[1]?.getAttribute('aria-pressed')).toBe('false');

    // Switch to another doctor while fields are auto-populated
    await act(() => {
        typeInto('#appointment-professional', 'Dr. Marcos Silva');
    });
    expect($<HTMLInputElement>('#appointment-specialty').value).toBe('Dermatología');
    expect($<HTMLInputElement>('#appointment-location').value).toBe('Consultorio Sur 333');

    // Manual edits are preserved when switching back
    await act(() => {
        typeInto('#appointment-location', 'Dirección manual 999');
        typeInto('#appointment-professional', 'Dra. Lucía Gómez');
    });
    expect($<HTMLInputElement>('#appointment-location').value).toBe('Dirección manual 999');
    expect($<HTMLInputElement>('#appointment-specialty').value).toBe('Neurología');

    // Selecting a preloaded address updates location and saves to Drive/Calendar
    const sedeNorteBtn = [...document.querySelectorAll<HTMLButtonElement>('.appointment-address-option')].find((b) =>
        b.textContent?.includes('Sede Norte 111'),
    )!;
    await act(() => sedeNorteBtn.click());
    expect($<HTMLInputElement>('#appointment-location').value).toBe('Sede Norte 111');

    const form = $<HTMLFormElement>('#appointment-form');
    (form.elements.namedItem('date') as HTMLInputElement).value = '2026-12-01';
    (form.elements.namedItem('time') as HTMLInputElement).value = '09:30';
    await act(async () => {
        form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    await vi.waitFor(() => expect($<HTMLDialogElement>('#appointment-dialog').open).toBe(false));
    expect($('.appointments').textContent).toContain('Sede Norte 111');
    const cal = fakeCalendars()[0]!;
    expect(fakeCalendarEvents(cal.id)[0]).toMatchObject({
        summary: 'Dra. Lucía Gómez',
        location: 'Sede Norte 111',
    });
});

it('queues a doctor offline and syncs to Drive after reconnecting', async () => {
    Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: {request: async (_name: string, callback: () => Promise<void>) => callback()},
    });
    await mountPage();
    await vi.waitFor(() => expect(directoriesReady.value).toBe(true));
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    await act(() => $<HTMLButtonElement>('#nav-medicos').click());
    const addBtn = [...document.querySelectorAll<HTMLButtonElement>('.portals-head-actions button')].find((b) =>
        b.textContent?.includes('Agregar médico'),
    )!;
    await act(() => addBtn.click());
    await act(() => {
        typeInto('#doctor-name', 'Dr. Offline Sync');
        typeInto('#doctor-specialty', 'Clínica médica');
        const addr = document.querySelector<HTMLInputElement>('input[aria-label="Dirección 1"]')!;
        addr.value = 'Av. Corrientes 800';
        addr.dispatchEvent(new Event('input', {bubbles: true}));
    });
    await act(async () => {
        $<HTMLFormElement>('#doctor-form').requestSubmit();
    });
    await vi.waitFor(() =>
        expect(document.querySelector('#pending-changes')?.textContent).toContain('Dr. Offline Sync'),
    );
    expect(document.querySelector('#doctors-list')?.textContent).toContain('Pendiente de sincronización');

    online.mockReturnValue(true);
    act(() => {
        window.dispatchEvent(new Event('online'));
    });
    await vi.waitFor(async () => expect(await queue.list('account-one')).toHaveLength(0));
    expect(fakeDriveFile('generated-1')?.appProperties.misEstudios).toBe('medico-v1');
});
