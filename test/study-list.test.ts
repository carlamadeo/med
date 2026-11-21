import {h, render} from 'preact';
import {act} from 'preact/test-utils';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {StudyList} from '@presentation/components/StudyList';
import {setStudies, view, visibleStudies} from '@presentation/state/store';

const root = document.createElement('div');
beforeEach(() => {
    view.value = 'cronologia';
});
afterEach(() => {
    render(null, root);
    root.remove();
    setStudies([]);
    vi.restoreAllMocks();
});

it('limits mounted rows and lets keyboard users open a later page', async () => {
    const base = {date: '2024-01-01', types: ['Otro'], doctor: '', portal: '', viewer: '', reportName: '',
        hasPdf: false, driveModifiedTime: '', revision: '1'};
    const records = Array.from({length: 125}, (_, index) => ({
        ...base, id: String(index), driveFileId: String(index), title: `Informe ${index + 1}`,
    }));
    const draw = (studies: typeof records) => render(h(StudyList, {onEdit: () => {}, onDelete: () => {}, studies}), root);
    await act(() => draw(records));
    expect(root.querySelectorAll('.study-title')).toHaveLength(50);
    expect(root.textContent).toContain('1–50 de 125 estudios');
    const next = [...root.querySelectorAll('button')].find(button => button.textContent === 'Siguiente');
    expect(next).toBeDefined();
    await act(() => next?.click());
    expect(root.textContent).toContain('51–100 de 125 estudios');
    expect(root.querySelector('.study-title')?.textContent).toBe('Informe 51');
    await act(() => draw(records.slice(112)));
    expect(root.querySelectorAll('.study-title')).toHaveLength(13);
    expect(root.querySelector('.study-title')?.textContent).toBe('Informe 113');
});

it('shows loaded studies instead of remaining on the loading placeholder', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    setStudies([{
        id: 'one',
        title: 'Estudio visible',
        date: '2024-01-01',
        types: [],
        doctor: '',
        portal: '',
        viewer: '',
        reportName: '',
        hasPdf: false,
        driveFileId: 'one',
        driveModifiedTime: '',
        revision: '1'
    }]);
    await act(() => {
        render(h(StudyList, {
            onEdit: () => {
            }, onDelete: () => {
            },
            studies: visibleStudies.value
        }), root);
    });
    expect(root.textContent).toContain('Estudio visible');
});

it('renders studies in a table with correct columns', async () => {
    const base = {
        date: '2024-01-01',
        types: ['Otro'],
        doctor: 'Dr. Test',
        portal: 'Hospital Test',
        viewer: '',
        reportName: '',
        hasPdf: true,
        driveModifiedTime: '',
        revision: '1'
    };
    setStudies([{...base, id: 'one', driveFileId: 'one', title: 'Uno'}, {
        ...base,
        id: 'two',
        driveFileId: 'two',
        title: 'Dos'
    }]);
    await act(() => {
        render(h(StudyList, {
            onEdit: () => {
            }, onDelete: () => {
            },
            studies: visibleStudies.value
        }), root);
    });
    const rows = [...root.querySelectorAll<HTMLTableRowElement>('tbody tr:not(.year-divider-row)')];
    expect([...root.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual([
        'Estudio', 'Fecha', 'Profesional', 'Institución', 'Acciones',
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Uno');
    expect(rows[0]?.textContent).toContain('Dr. Test');
    expect(rows[0]?.textContent).toContain('Hospital Test');
    expect(rows[1]?.textContent).toContain('Dos');
});

it('shows empty state when no studies', async () => {
    setStudies([]);
    await act(() => {
        render(h(StudyList, {
            onEdit: () => {
            }, onDelete: () => {
            },
            studies: visibleStudies.value
        }), root);
    });
    expect(root.textContent).toContain('No hay estudios para mostrar');
});

it('shows the four print states independently of attachment or viewer availability', async () => {
    const base = {date: '2024-01-01', types: [], doctor: '', portal: '', viewer: '', reportName: '', driveModifiedTime: '', revision: '1'};
    setStudies([
        {...base, id: 'pdf', driveFileId: 'report', title: 'Informe', hasPdf: true, viewer: 'https://example.com/visor',
            printed: {report: true, image: true}},
        {...base, id: 'image', driveFileId: 'photo', title: 'Orden', hasPdf: false, attachmentMime: 'image/png',
            printed: {report: true, image: false}},
        {...base, id: 'paper', driveFileId: 'paper', title: 'Copia', hasPdf: false, printed: {report: false, image: true}},
        {...base, id: 'legacy', driveFileId: 'legacy', title: 'Ficha anterior', hasPdf: false},
    ]);
    await act(() => render(h(StudyList, {
        onEdit: () => {}, onDelete: () => {}, studies: visibleStudies.value,
    }), root));

    expect(root.querySelector('time')?.dateTime).toBe('2024-01-01');
    const links = [...root.querySelectorAll('tbody a')];
    expect(links.map((link) => [link.getAttribute('aria-label'), link.getAttribute('href')])).toEqual([
        ['Abrir informe de Informe. Informe impreso.', 'https://drive.google.com/file/d/report/view'],
        ['Abrir visor de Informe. Imagen impresa.', 'https://example.com/visor'],
        ['Abrir informe de Orden. Informe impreso.', 'https://drive.google.com/file/d/photo/view'],
    ]);
    expect(links.map(link => link.querySelector('svg use')?.getAttribute('href'))).toEqual(['#i-file', '#i-image', '#i-file']);
    const states = [...root.querySelectorAll('tbody tr:not(.year-divider-row)')].map(row =>
        [...row.querySelectorAll('.study-source')].map(source => source.getAttribute('data-printed')),
    );
    expect(states).toEqual([['true', 'true'], ['true', 'false'], ['false', 'true'], ['false', 'false']]);
    expect(root.querySelector('[role="img"][aria-label="Imagen impresa. Sin enlace al visor."]')).not.toBeNull();
    expect(root.querySelector<HTMLButtonElement>('button[aria-label="Compartir Orden"]')?.disabled).toBe(false);
});

it('keeps unsynced studies protected without a status column', async () => {
    const base = {
        date: '2024-01-01',
        types: ['Otro'],
        doctor: '',
        portal: '',
        viewer: '',
        reportName: '',
        hasPdf: false,
        driveModifiedTime: '',
        revision: '1'
    };
    setStudies([
        {...base, id: 'one', driveFileId: 'one', title: 'Synced', syncStatus: undefined},
        {...base, id: 'two', driveFileId: 'two', title: 'Pending', syncStatus: 'pending'},
        {...base, id: 'three', driveFileId: 'three', title: 'Conflict', syncStatus: 'conflict'},
    ]);
    await act(() => {
        render(h(StudyList, {
            onEdit: () => {
            }, onDelete: () => {
            },
            studies: visibleStudies.value
        }), root);
    });
    expect(root.textContent).toContain('Pendiente de sincronización');
    expect(root.textContent).toContain('Requiere revisión');
    for (const [title, pending] of [['Synced', false], ['Pending', true], ['Conflict', true]] as const) {
        await act(() => root.querySelector<HTMLButtonElement>(`button[aria-label="Ver detalle de ${title}"]`)!.click());
        const dialog = root.querySelector('dialog[open]')!;
        const action = (label: string) => [...dialog.querySelectorAll('button')].find(button => button.textContent === label);
        expect(action('Editar')?.disabled).toBe(pending);
        expect(action('Eliminar')?.disabled).toBe(pending);
        await act(() => dialog.querySelector<HTMLButtonElement>('[aria-label="Cerrar"]')!.click());
    }
});

it('opens details from the row and routes edit and delete through the existing handlers', async () => {
    setStudies([{id: 'one', driveFileId: 'one', title: 'Informe', date: '2024-01-01', types: [],
        doctor: 'Dra. Núñez', portal: '', viewer: 'https://example.com/visor', reportName: '', hasPdf: false,
        driveModifiedTime: '', revision: '1'}]);
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    await act(() => render(h(StudyList, {onEdit, onDelete, studies: visibleStudies.value}), root));
    await act(() => root.querySelector<HTMLInputElement>('tbody input')!.click());
    expect(root.querySelector('dialog[open]')).toBeNull();
    await act(() => root.querySelector('time')!.parentElement!.click());
    expect(root.querySelector('dialog[open]')?.textContent).toContain('Dra. Núñez');
    const clickAction = (label: string) => act(() => [...root.querySelectorAll<HTMLButtonElement>('dialog[open] button')]
        .find(button => button.textContent === label)!.click());
    await clickAction('Editar');
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({id: 'one'}));
    expect(root.querySelector('dialog[open]')).toBeNull();
    await act(() => root.querySelector<HTMLButtonElement>('.study-title')!.click());
    await clickAction('Eliminar');
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({id: 'one'}));
});

it('groups linked studies under their own heading in the detail dialog', async () => {
    const base = {date: '2024-01-01', types: [], doctor: '', portal: '', viewer: '', reportName: '',
        hasPdf: true, driveModifiedTime: '', revision: '1'};
    setStudies([
        {...base, id: 'main', driveFileId: 'main', title: 'Control anual', documentIds: ['related']},
        {...base, id: 'related', driveFileId: 'report', title: 'Hemograma'},
    ]);
    await act(() => render(h(StudyList, {onEdit: () => {}, onDelete: () => {}, studies: visibleStudies.value}), root));
    const openDetails = (title: string) => act(() => root.querySelector<HTMLButtonElement>(
        `button[aria-label="Ver detalle de ${title}"]`,
    )!.click());
    const relatedSection = () => [...root.querySelectorAll('dialog[open] section')]
        .find(section => section.querySelector('h3')?.textContent === 'Estudios relacionados');

    await openDetails('Control anual');
    const link = relatedSection()?.querySelector('a');
    expect(link?.textContent).toBe('Hemograma');
    expect(link?.href).toBe('https://drive.google.com/file/d/report/view');
    await act(() => root.querySelector<HTMLButtonElement>('dialog[open] [aria-label="Cerrar"]')!.click());

    await openDetails('Hemograma');
    expect(relatedSection()).toBeUndefined();
});

it('shows a +N badge when a study has more than two types', async () => {
    setStudies([{
        id: 'multi',
        driveFileId: 'multi',
        title: 'Control anual',
        date: '2024-01-01',
        types: ['Laboratorio', 'Ecografía', 'Radiografía', 'Otro'],
        doctor: '',
        portal: '',
        viewer: '',
        reportName: '',
        hasPdf: false,
        driveModifiedTime: '',
        revision: '1',
    }]);
    await act(() => render(h(StudyList, {onEdit: () => {}, onDelete: () => {}, studies: visibleStudies.value}), root));
    const badges = [...root.querySelectorAll('.type-badge')];
    expect(badges.map((badge) => badge.textContent)).toEqual(['Laboratorio', 'Ecografía', '+2']);
    expect(badges[2]?.getAttribute('title')).toBe('Radiografía, Otro');
});

it('renders a year divider row between studies from different years when sorted by date', async () => {
    const base = {types: ['Otro'], doctor: '', portal: '', viewer: '', reportName: '', hasPdf: false, driveModifiedTime: '', revision: '1'};
    setStudies([
        {...base, id: '1', driveFileId: '1', title: 'Estudio 2025', date: '2025-05-01'},
        {...base, id: '2', driveFileId: '2', title: 'Estudio 2024 B', date: '2024-08-10'},
        {...base, id: '3', driveFileId: '3', title: 'Estudio 2024 A', date: '2024-01-15'},
        {...base, id: '4', driveFileId: '4', title: 'Estudio 2023', date: '2023-11-20'},
    ]);
    await act(() => render(h(StudyList, {
        onEdit: () => {}, onDelete: () => {}, sortOrder: 'date-desc', studies: visibleStudies.value,
    }), root));

    const dividers = [...root.querySelectorAll('.year-divider-row')].map((row) => row.textContent?.trim());
    expect(dividers).toEqual(['2025', '2024', '2023']);

    // When sorted by title, year dividers are not shown
    await act(() => render(h(StudyList, {
        onEdit: () => {}, onDelete: () => {}, sortOrder: 'title', studies: visibleStudies.value,
    }), root));
    expect(root.querySelectorAll('.year-divider-row')).toHaveLength(0);
});

it('allows selecting multiple shareable studies while keeping single-study share available', async () => {
    const base = {
        date: '2024-01-01',
        types: ['Otro'],
        doctor: '',
        portal: '',
        reportName: '',
        driveModifiedTime: '',
        revision: '1',
    };
    setStudies([
        {...base, id: 'one', driveFileId: 'one', title: 'Estudio PDF', hasPdf: true, viewer: ''},
        {...base, id: 'two', driveFileId: 'two', title: 'Estudio Visor', hasPdf: false, viewer: 'https://example.org/v'},
        {...base, id: 'three', driveFileId: 'three', title: 'Sin fuentes', hasPdf: false, viewer: ''},
        {...base, id: 'four', driveFileId: 'four', title: 'Pendiente', hasPdf: true, viewer: '', syncStatus: 'pending'},
    ]);
    const onShare = vi.fn();
    const onShareMultiple = vi.fn();
    document.body.append(root);

    await act(() => render(h(StudyList, {
        onEdit: () => {},
        onDelete: () => {},
        onShare,
        onShareMultiple,
        studies: visibleStudies.value,
    }), root));

    const checkbox = (title: string) =>
        root.querySelector<HTMLInputElement>(`input[aria-label="Seleccionar ${title} para compartir"]`)!;

    expect(root.querySelector('.library-selection-bar')).toBeNull();
    expect(checkbox('Estudio PDF').disabled).toBe(false);
    expect(checkbox('Estudio Visor').disabled).toBe(false);
    expect(checkbox('Sin fuentes').disabled).toBe(true);
    expect(checkbox('Pendiente').disabled).toBe(true);

    await act(() => checkbox('Estudio PDF').click());
    expect(root.querySelector('.library-selection-count')?.textContent).toContain('1 estudio seleccionado');

    const selectAll = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Seleccionar todos')!;
    await act(() => selectAll.click());
    expect(root.querySelector('.library-selection-count')?.textContent).toContain('2 estudios seleccionados');

    await act(() => root.querySelector<HTMLButtonElement>('#share-selected-studies')!.click());
    expect(onShareMultiple).toHaveBeenCalledOnce();
    expect(onShareMultiple.mock.calls[0]![0].map((s: { id: string }) => s.id)).toEqual(['one', 'two']);

    await act(() => root.querySelector<HTMLButtonElement>('button[aria-label="Compartir Estudio PDF"]')!.click());
    expect(onShare).toHaveBeenCalledOnce();
    expect(onShare.mock.calls[0]![0].id).toBe('one');

    const clearSelection = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Limpiar selección')!;
    await act(() => clearSelection.click());
    expect(root.querySelector('.library-selection-bar')).toBeNull();
});
