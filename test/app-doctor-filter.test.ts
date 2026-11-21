import {act} from 'preact/test-utils';
import {expect, it, vi} from 'vitest';
import {categoryTypes, setStudies, studiesReady} from '@presentation/state/store';
import {$, mountPage, typeInto} from './page';

it('opens a doctor’s studies by name from the directory', async () => {
    await mountPage();
    await vi.waitFor(() => expect(studiesReady.value).toBe(true));
    const base = {
        date: '2020-01-01', portal: '', viewer: '', reportName: '', hasPdf: false,
        driveModifiedTime: '', revision: '1', types: ['Otro'],
    };
    await act(() => {
        setStudies([
            {...base, id: 'one', driveFileId: 'one', title: 'Ecografía', doctor: 'Dra. Ana López'},
            {...base, id: 'two', driveFileId: 'two', title: 'Radiografía', doctor: ' DRA. ANA  LOPEZ '},
            {...base, id: 'other', driveFileId: 'other', title: 'Informe para Dra. Ana López', doctor: 'Dr. Juan Pérez'},
            {...base, id: 'unnamed', driveFileId: 'unnamed', title: 'Hemograma', doctor: ' '},
        ]);
        categoryTypes.value = ['Mamografía'];
    });
    expect(document.querySelector('#nav-medicos')).not.toBeNull();
    await act(() => $<HTMLButtonElement>('#nav-medicos').click());
    expect(document.querySelectorAll('#doctors-list > li')).toHaveLength(2);
    await act(() => typeInto('#doctor-search', 'ana lopez'));
    expect(document.querySelectorAll('#doctors-list > li')).toHaveLength(1);
    expect($('#doctors-list').textContent).toContain('2 estudios');
    await act(() => $<HTMLButtonElement>('#doctors-list button').click());
    const studyTitles = () => [...document.querySelectorAll('.study-title')].map(title => title.textContent);
    expect(studyTitles()).toEqual(['Ecografía', 'Radiografía']);
    expect($('.active-filter-pill').textContent).toContain('Dra. Ana López');
    await act(() => $<HTMLButtonElement>('.active-filter-pill button').click());
    expect(studyTitles()).toHaveLength(4);
});
