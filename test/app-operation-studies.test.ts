import {act} from 'preact/test-utils';
import {expect, it, vi} from 'vitest';
import {driveOperationRepo, driveStudyRepo} from '@data';
import {directoriesReady, operations, studies} from '@presentation/state/store';
import {addRemoteRaw, fakeDriveFile} from './fake-drive';
import {$, mountPage, typeInto} from './page';

function detailButton(label: string) {
    const button = [...document.querySelectorAll<HTMLButtonElement>('#operation-detail button')]
        .find(item => item.textContent?.trim() === label);
    expect(button).toBeDefined();
    return button!;
}

it('muestra solo los estudios vinculados y permite buscar, paginar y cambiar sus vínculos', async () => {
    await mountPage();
    await vi.waitFor(() => expect(directoriesReady.value).toBe(true));
    const operation = await driveOperationRepo.save({name: 'Operación de prueba', date: '2024-03-16'});
    const other = await driveOperationRepo.save({name: 'Otra ficha de prueba', date: '2024-01-16'});
    for (let index = 0; index < 12; index++) {
        addRemoteRaw(`lab-${index}`, {title: `Control de laboratorio ${index}`, types: ['Análisis']});
    }
    addRemoteRaw('linked-study', {title: 'Informe vinculado', types: ['Otro'], operationId: operation.id});
    addRemoteRaw('different-operation', {title: 'Control preoperatorio', types: ['Analisis'], operationId: other.id});
    const archive = await driveStudyRepo.list({force: true});

    await act(() => {
        operations.value = [operation, other];
        studies.value = archive;
        $('#nav-operaciones').click();
    });
    await act(() => $('.operation-card [data-detail]').click());
    expect($('#operation-detail').textContent).toContain('Informe vinculado');
    expect($('#operation-detail').textContent).not.toContain('Control de laboratorio');

    await act(() => detailButton('Gestionar estudios').click());
    const options = () => [...document.querySelectorAll<HTMLInputElement>(
        '#operation-study-picker input[type="checkbox"]',
    )];
    expect(options()).toHaveLength(8);
    const firstPage = options().map(input => input.dataset.studyId);
    await act(() => detailButton('Siguiente').click());
    expect(options().some(input => firstPage.includes(input.dataset.studyId))).toBe(false);

    const type = $<HTMLSelectElement>('#operation-study-type');
    await act(() => {
        type.value = 'Análisis';
        type.dispatchEvent(new Event('change', {bubbles: true}));
        typeInto('#operation-study-search', 'preoperatorio');
    });
    expect(options().map(input => input.dataset.studyId)).toEqual(['different-operation']);
    expect(options()[0]!.closest('li')?.textContent).toContain('Otra operación');
    await act(() => options()[0]!.click());
    await vi.waitFor(() => expect(
        JSON.parse(fakeDriveFile('different-operation')!.description).operationId,
    ).toBe(operation.id));
    await vi.waitFor(() => expect(options()[0]?.disabled).toBe(false));
    expect(options()[0]!.checked).toBe(true);

    await act(() => detailButton('Ver vinculados').click());
    expect($('#operation-detail').textContent).toContain('Control preoperatorio');
    expect($('#operation-detail').textContent).not.toContain('Control de laboratorio');

    await act(() => detailButton('Gestionar estudios').click());
    await act(() => typeInto('#operation-study-search', 'preoperatorio'));
    expect(options()[0]!.checked).toBe(true);
    await act(() => options()[0]!.click());
    await vi.waitFor(() => expect(
        JSON.parse(fakeDriveFile('different-operation')!.description).operationId ?? '',
    ).toBe(''));
    await act(() => detailButton('Ver vinculados').click());
    expect($('#operation-detail').textContent).not.toContain('Control preoperatorio');
});
