import {act} from 'preact/test-utils';
import {beforeAll, expect, it, vi} from 'vitest';
import {categoryTypes, portals, setStudies, studiesReady} from '@presentation/state/store';
import {$, mountPage, typeInto} from './page';

beforeAll(async () => {
    await mountPage();
    await vi.waitFor(() => expect(studiesReady.value).toBe(true));
});

it('opens a doctor’s studies by name and clears the filter when leaving the library', async () => {
    const base = {
        date: '2020-01-01', portal: '', viewer: '', reportName: '', hasPdf: false,
        driveModifiedTime: '', revision: '1', types: ['Otro'],
    };
    await act(() => {
        setStudies([
            {...base, id: 'one', driveFileId: 'one', title: 'Ecografía', doctor: 'Dra. Ana López'},
            {...base, id: 'two', driveFileId: 'two', title: 'Radiografía', doctor: ' DRA. ANA  LOPEZ '},
            {
                ...base,
                id: 'other',
                driveFileId: 'other',
                title: 'Informe para Dra. Ana López',
                doctor: 'Dr. Juan Pérez'
            },
            {...base, id: 'unnamed', driveFileId: 'unnamed', title: 'Hemograma', doctor: ' '},
        ]);
        categoryTypes.value = ['Mamografía'];
    });
    expect(document.querySelector('#nav-medicos')).not.toBeNull();
    await act(() => $<HTMLButtonElement>('#nav-medicos').click());
    expect(document.querySelectorAll('#doctors-list .portal-card')).toHaveLength(2);
    await act(() => typeInto('#doctor-search', 'ana lopez'));
    expect(document.querySelectorAll('#doctors-list .portal-card')).toHaveLength(1);
    expect($('#doctors-list').textContent).toContain('2 estudios');
    await act(() => $<HTMLButtonElement>('#doctors-list button').click());
    const studyTitles = () => [...document.querySelectorAll('.study-title')].map(title => title.textContent);
    expect(studyTitles()).toEqual(['Ecografía', 'Radiografía']);
    expect($('.active-filter-pill').textContent).toContain('Dra. Ana López');
    await act(() => $<HTMLButtonElement>('.active-filter-pill button').click());
    expect(studyTitles()).toHaveLength(4);

    await act(() => $('#nav-medicos').click());
    await act(() => $('#doctors-list button').click());
    expect(studyTitles()).toEqual(['Ecografía', 'Radiografía']);
    await act(() => $('#nav-portales').click());
    await act(() => $('#nav-cronologia').click());
    expect(studyTitles()).toHaveLength(4);
    expect(document.querySelector('.active-filter-pill')).toBeNull();
});

it('clears the portal filter when leaving the library', async () => {
    await act(() => {
        portals.value = [{
            id: 'clinic',
            name: 'Clínica Sur',
            displayName: 'Clínica Sur',
            url: '',
            notes: '',
            revision: '1'
        }];
        const base = {
            date: '2020-01-01', viewer: '', reportName: '', hasPdf: false, doctor: '',
            driveModifiedTime: '', revision: '1', types: ['Otro'],
        };
        setStudies([
            {...base, id: 'clinic-study', driveFileId: 'clinic-study', title: 'Ecografía', portal: 'Clínica Sur'},
            {...base, id: 'other-study', driveFileId: 'other-study', title: 'Hemograma', portal: ''},
        ]);
    });
    await act(() => $('#nav-portales').click());
    await act(() => $('#portals-list button').click());
    expect($('.active-filter-pill').textContent).toContain('Clínica Sur');
    expect([...document.querySelectorAll('.study-title')].map(title => title.textContent)).toEqual(['Ecografía']);

    await act(() => $('#nav-resumen').click());
    await act(() => $('#nav-cronologia').click());
    expect(document.querySelectorAll('.study-title')).toHaveLength(2);
    expect(document.querySelector('.active-filter-pill')).toBeNull();
});
