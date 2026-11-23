import {h, render} from 'preact';
import {act} from 'preact/test-utils';
import {afterEach, expect, it, vi} from 'vitest';
import {EditorDialog} from '@presentation/components/EditorDialog';
import {portals, setEditingStudy, setEditorOpen, setStudies} from '@presentation/state/store';

it('submits a new study with its selected type and specialty', async () => {
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
    await act(async () => {
    });
    const option = root.querySelector<HTMLLIElement>('[role="option"]')!;
    option.click();
    await act(async () => {
    });
    const specialty = form.elements.namedItem('specialty') as HTMLInputElement;
    expect(specialty).toBeInstanceOf(HTMLInputElement);
    await act(() => specialty.focus());
    const specialtyOption = [...root.querySelectorAll<HTMLButtonElement>('#study-specialty-options button')]
        .find(button => button.textContent === 'Endocrinología');
    expect(specialtyOption).toBeDefined();
    await act(() => specialtyOption!.click());
    await act(() => {
        form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Estudio',
        date: '2024-01-01',
        types: ['Otro'],
        specialty: 'Endocrinología'
    }));
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
    const base = {
        doctor: '',
        portal: '',
        viewer: '',
        reportName: '',
        hasPdf: false,
        driveModifiedTime: '',
        revision: '1'
    };
    const current = {
        ...base,
        id: 'current',
        driveFileId: 'current',
        title: 'Actual',
        date: '2024-01-01',
        types: ['Laboratorio']
    };
    setStudies([current,
        {...base, id: 'old', driveFileId: 'old', title: 'Anterior', date: '2020-01-01', types: ['Laboratorio']},
        {...base, id: 'new', driveFileId: 'new', title: 'Reciente', date: '2023-01-01', types: ['Laboratorio']},
        {...base, id: 'other', driveFileId: 'other', title: 'Otro', date: '2022-01-01', types: ['Ecografía']},
    ]);
    await act(() => render(h(EditorDialog, {
        onClose: () => {
        }, onSave: async () => {
        }, verifyOwner: async () => true,
        error: null, busy: false, availableTypes: ['Laboratorio', 'Ecografía']
    }), root));
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
        onClose: () => {
        }, onSave: async () => {
        }, verifyOwner: async () => true,
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
        onClose: () => {
        }, onSave: async () => {
        }, verifyOwner: async () => true,
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

it('closes the portal dropdown after selecting an institution', async () => {
    portals.value = [{
        id: 'p1',
        name: 'hospital central',
        displayName: 'Hospital Central',
        url: 'https://hospital.example',
        revision: '1'
    }];
    const root = document.createElement('div');
    document.body.append(root);
    await act(() => render(h(EditorDialog, {
        onClose: () => {
        }, onSave: async () => {
        }, verifyOwner: async () => true,
        error: null, busy: false, availableTypes: ['Laboratorio']
    }), root));
    await act(() => {
        setEditingStudy(null);
        setEditorOpen(true);
    });

    const input = root.querySelector<HTMLInputElement>('input[name="portal"]')!;
    await act(() => {
        input.dispatchEvent(new FocusEvent('focus', {bubbles: true}));
    });
    const option = root.querySelector<HTMLButtonElement>('#portal-options .portal-autocomplete-item');
    expect(option?.textContent).toBe('Hospital Central');

    await act(() => {
        option!.click();
    });

    expect(input.value).toBe('Hospital Central');
    expect(root.querySelector('#portal-options')).toBeNull();

    portals.value = [];
    setEditorOpen(false);
    render(null, root);
    root.remove();
});

it('suggests previously saved doctors and closes the dropdown on selection', async () => {
    setStudies([{
        id: 's1',
        driveFileId: 'f1',
        title: 'Estudio previo',
        date: '2024-01-01',
        doctor: 'Dra. Ana Pérez',
        portal: '',
        types: ['Laboratorio'],
        viewer: '',
        reportName: '',
        hasPdf: false,
        driveModifiedTime: '',
        revision: '1',
    }]);
    const root = document.createElement('div');
    document.body.append(root);
    await act(() => render(h(EditorDialog, {
        onClose: () => {
        }, onSave: async () => {
        }, verifyOwner: async () => true,
        error: null, busy: false, availableTypes: ['Laboratorio']
    }), root));
    await act(() => {
        setEditingStudy(null);
        setEditorOpen(true);
    });

    const input = root.querySelector<HTMLInputElement>('input[name="doctor"]')!;
    await act(() => {
        input.dispatchEvent(new FocusEvent('focus', {bubbles: true}));
    });
    const option = root.querySelector<HTMLButtonElement>('#doctor-options .portal-autocomplete-item');
    expect(option?.textContent).toBe('Dra. Ana Pérez');

    await act(() => {
        option!.click();
    });

    expect(input.value).toBe('Dra. Ana Pérez');
    expect(root.querySelector('#doctor-options')).toBeNull();

    setStudies([]);
    setEditorOpen(false);
    render(null, root);
    root.remove();
});

it('allows creating and selecting a custom study type', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const root = document.createElement('div');
    document.body.append(root);
    await act(() => render(h(EditorDialog, {
        onClose: () => {
        }, onSave: save, verifyOwner: async () => true,
        error: null, busy: false, availableTypes: ['Laboratorio']
    }), root));
    await act(() => {
        setEditingStudy(null);
        setEditorOpen(true);
    });

    const trigger = root.querySelector<HTMLElement>('#study-types [role="combobox"]')!;
    await act(() => trigger.click());

    const searchInput = root.querySelector<HTMLInputElement>('.combobox-search')!;
    await act(() => {
        searchInput.value = 'Polisomnografía';
        searchInput.dispatchEvent(new Event('input', {bubbles: true}));
    });

    const createOption = root.querySelector<HTMLLIElement>('.combobox-create');
    expect(createOption?.textContent).toContain('+ Agregar «Polisomnografía»');

    await act(() => createOption!.click());

    const tags = [...root.querySelectorAll('.combobox-tag')].map((tag) => tag.textContent?.trim());
    expect(tags).toContain('Polisomnografía');

    setEditorOpen(false);
    render(null, root);
    root.remove();
});
