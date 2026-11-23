import {act} from 'preact/test-utils';
import {expect, it, vi} from 'vitest';
import {categoryTypes, libraryPortal, operations, setStudies, studiesReady, view} from '@presentation/state/store';
import {$, mountPage} from './page';

it('opens only the studies linked to the selected operation', async () => {
    await mountPage();
    await vi.waitFor(() => expect(studiesReady.value).toBe(true));
    const base = {
        doctor: '',
        viewer: '',
        reportName: '',
        hasPdf: false,
        driveModifiedTime: '',
        revision: '1',
        types: ['Otro']
    };
    await act(() => {
        setStudies([
            {
                ...base,
                id: 'one',
                driveFileId: 'one',
                title: 'Estudio vinculado',
                date: '2020-01-01',
                portal: 'Otro',
                operationId: 'op'
            },
            {...base, id: 'two', driveFileId: 'two', title: 'Estudio ajeno', date: '2020-01-02', portal: 'Clínica'},
        ]);
        operations.value = [{id: 'op', name: 'Operación QA', color: '', studyIds: [], revision: '1'}];
        categoryTypes.value = ['Mamografía'];
        libraryPortal.value = 'Clínica';
        view.value = 'operaciones';
    });
    await act(() => {
        [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Ver estudios'))!.click();
    });
    expect($('#library-title').textContent).toContain('Estudios guardados');
    expect(document.body.textContent).toContain('Estudio vinculado');
    expect(document.body.textContent).not.toContain('Estudio ajeno');
    expect(document.body.textContent).toContain('Operación QA');
    await act(() => {
        [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Quitar filtro'))!.click();
    });
    expect(document.body.textContent).toContain('Estudio ajeno');
});
