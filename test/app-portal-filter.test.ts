import {act} from 'preact/test-utils';
import {expect, it, vi} from 'vitest';
import {categoryTypes, portals, setStudies, studiesReady, view} from '@presentation/state/store';
import {$, mountPage} from './page';

it('opens the selected portal studies and allows clearing the filter', async () => {
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
                title: 'Estudio del portal',
                date: '2020-01-01',
                portal: 'CLÍNICA NORTE'
            },
            {
                ...base,
                id: 'two',
                driveFileId: 'two',
                title: 'Estudio de otro portal',
                date: '2020-01-02',
                portal: 'Otra clínica'
            },
        ]);
        portals.value = [{
            id: 'portal',
            name: 'Clinica Norte',
            displayName: 'Portal Norte',
            url: '',
            notes: '',
            revision: '1'
        }];
        categoryTypes.value = ['Mamografía'];
        view.value = 'portales';
    });
    await act(() => {
        [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Ver estudios'))!.click();
    });
    await vi.waitFor(() => expect($('#library-title').textContent).toContain('Estudios guardados'));
    expect(document.body.textContent).toContain('Estudio del portal');
    expect(document.body.textContent).not.toContain('Estudio de otro portal');
    expect(document.body.textContent).toContain('Clinica Norte');
    await act(() => {
        [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Quitar filtro'))!.click();
    });
    expect(document.body.textContent).toContain('Estudio de otro portal');
});
