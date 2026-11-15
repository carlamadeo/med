import {h, render} from 'preact';
import {act} from 'preact/test-utils';
import {afterEach, expect, it, vi} from 'vitest';
import {EditorDialog} from '@presentation/components/EditorDialog';
import {setEditingStudy, setEditorOpen, setStudies} from '@presentation/state/store';

it('submits a new study with its selected type', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const save = vi.fn().mockResolvedValue(undefined);
    await act(() => {
        render(h(EditorDialog, {
            onClose: () => {
            }, onSave: save, verifyOwner: async () => true, error: null, busy: false, availableTypes: ['Otro']
        }), root);
    });
    await act(() => setEditingStudy(null));
    const form = root.querySelector<HTMLFormElement>('form')!;
    const title = form.elements.namedItem('title') as HTMLInputElement;
    title.value = 'Estudio';
    title.dispatchEvent(new Event('input', {bubbles: true}));
    const date = form.elements.namedItem('date') as HTMLInputElement;
    date.value = '2024-01-01';
    date.dispatchEvent(new Event('input', {bubbles: true}));
    // Open combobox and select type
    const trigger = form.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    trigger.click();
    await act(async () => {});
    const option = root.querySelector<HTMLLIElement>('[role="option"]')!;
    option.click();
    await act(async () => {});
    await act(() => {
        form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({title: 'Estudio', date: '2024-01-01', types: ['Otro']}));
    render(null, root);
    root.remove();
});
afterEach(() => setEditorOpen(false));

it('submits an intake candidate as a new study with its selected file', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const save = vi.fn().mockResolvedValue(undefined);
    const file = new File(['PDF'], 'informe.pdf', {type: 'application/pdf'});
    await act(() => {
        render(h(EditorDialog, {
            onClose: () => {
            }, onSave: save, verifyOwner: async () => true, error: null, busy: false, availableTypes: ['Otro']
        }), root);
    });
    await act(() => setEditingStudy({
        id: 'pending-1',
        driveFileId: '',
        title: 'Informe',
        date: '2024-01-01',
        types: ['Otro'],
        doctor: '',
        portal: '',
        viewer: '',
        reportName: '',
        hasPdf: false,
        driveModifiedTime: '',
        revision: '',
        file
    } as Parameters<typeof setEditingStudy>[0]));
    await act(() => {
        root.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', {
            bubbles: true,
            cancelable: true
        }));
    });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({file, driveFileId: undefined}));
    render(null, root);
    root.remove();
});


it('shows other studies of the same type in date order while editing', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const base = {doctor: '', portal: '', viewer: '', reportName: '', hasPdf: false, driveModifiedTime: '', revision: '1'};
    const current = {...base, id: 'current', driveFileId: 'current', title: 'Actual', date: '2024-01-01', types: ['Laboratorio']};
    setStudies([current,
        {...base, id: 'old', driveFileId: 'old', title: 'Anterior', date: '2020-01-01', types: ['Laboratorio']},
        {...base, id: 'new', driveFileId: 'new', title: 'Reciente', date: '2023-01-01', types: ['Laboratorio']},
        {...base, id: 'other', driveFileId: 'other', title: 'Otro', date: '2022-01-01', types: ['Ecografía']},
    ]);
    await act(() => render(h(EditorDialog, {onClose: () => {}, onSave: async () => {}, verifyOwner: async () => true,
        error: null, busy: false, availableTypes: ['Laboratorio', 'Ecografía']}), root));
    await act(() => setEditingStudy(current));
    const related = root.querySelector('[aria-label="Estudios relacionados"]');
    expect(related?.textContent).toContain('Otros estudios de Laboratorio');
    expect(related?.textContent).toContain('2 estudios');
    expect([...related!.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
        expect.stringContaining('Reciente'), expect.stringContaining('Anterior'),
    ]);
    render(null, root);
    root.remove();
    setStudies([]);
    setEditingStudy(null);
});

it('rejects files larger than 20 MB immediately on drop or select', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await act(() => render(h(EditorDialog, {
        onClose: () => {}, onSave: async () => {}, verifyOwner: async () => true,
        error: null, busy: false, availableTypes: ['Laboratorio']
    }), root));
    await act(() => setEditingStudy(null));

    const dropzone = root.querySelector('.dropzone')!;
    const bigFile = new File(['x'.repeat(100)], 'enorme.pdf', {type: 'application/pdf'});
    Object.defineProperty(bigFile, 'size', {value: 21 * 1024 * 1024});

    const dropEvent = new Event('drop', {bubbles: true, cancelable: true}) as unknown as DragEvent;
    Object.defineProperty(dropEvent, 'dataTransfer', {
        value: {files: [bigFile]}
    });

    await act(async () => {
        dropzone.dispatchEvent(dropEvent as unknown as Event);
    });

    const detection = root.querySelector('#detection')!;
    expect(detection.textContent).toContain('El archivo supera el límite de 20 MB.');
    expect(root.querySelector('#selected-report')).toBeNull();

    render(null, root);
    root.remove();
});

it('handles drag and drop of valid files onto the dropzone', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await act(() => render(h(EditorDialog, {
        onClose: () => {}, onSave: async () => {}, verifyOwner: async () => true,
        error: null, busy: false, availableTypes: ['Laboratorio']
    }), root));
    await act(() => setEditingStudy(null));

    const dropzone = root.querySelector('.dropzone')!;
    const validFile = new File(['%PDF-1.4'], 'estudio.pdf', {type: 'application/pdf'});

    const dragEnterEvent = new Event('dragenter', {bubbles: true, cancelable: true});
    await act(() => {
        dropzone.dispatchEvent(dragEnterEvent);
    });
    expect(dropzone.classList.contains('is-dragover')).toBe(true);

    const dropEvent = new Event('drop', {bubbles: true, cancelable: true}) as unknown as DragEvent;
    Object.defineProperty(dropEvent, 'dataTransfer', {
        value: {files: [validFile]}
    });

    await act(async () => {
        dropzone.dispatchEvent(dropEvent as unknown as Event);
    });

    expect(dropzone.classList.contains('is-dragover')).toBe(false);
    expect(root.querySelector('#selected-report')).not.toBeNull();
    expect(root.querySelector('#selected-report')!.textContent).toContain('estudio.pdf');

    render(null, root);
    root.remove();
});
