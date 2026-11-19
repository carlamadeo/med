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

it('shows the study date and names its PDF, image and viewer icon links', async () => {
    const base = {date: '2024-01-01', types: [], doctor: '', portal: '', viewer: '', reportName: '', driveModifiedTime: '', revision: '1'};
    setStudies([
        {...base, id: 'pdf', driveFileId: 'report', title: 'Informe', hasPdf: true, viewer: 'https://example.com/visor'},
        {...base, id: 'image', driveFileId: 'photo', title: 'Orden', hasPdf: false, attachmentMime: 'image/png'},
    ]);
    await act(() => render(h(StudyList, {
        onEdit: () => {}, onDelete: () => {}, studies: visibleStudies.value,
    }), root));

    expect(root.querySelector('time')?.dateTime).toBe('2024-01-01');
    const links = [...root.querySelectorAll('tbody a')];
    expect(links.map((link) => [link.getAttribute('aria-label'), link.getAttribute('href')])).toEqual([
        ['Abrir PDF de Informe', 'https://drive.google.com/file/d/report/view'],
        ['Abrir visor de Informe', 'https://example.com/visor'],
        ['Abrir imagen de Orden', 'https://drive.google.com/file/d/photo/view'],
    ]);
    expect(links.every((link) => !link.textContent?.trim() && link.querySelector('svg'))).toBe(true);
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
    expect(root.querySelector<HTMLButtonElement>('button[aria-label="Editar Synced"]')?.disabled).toBe(false);
    expect(root.querySelector<HTMLButtonElement>('button[aria-label="Editar Pending"]')?.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('button[aria-label="Eliminar Conflict"]')?.disabled).toBe(true);
});

it('offers a named print action for each study', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    setStudies([{id: 'one', driveFileId: 'one', title: 'Informe', date: '2024-01-01', types: [],
        doctor: '', portal: '', viewer: '', reportName: '', hasPdf: false, driveModifiedTime: '', revision: '1'}]);
    await act(() => render(h(StudyList, {onEdit: () => {}, onDelete: () => {}, studies: visibleStudies.value}), root));
    await act(() => root.querySelector<HTMLButtonElement>('button[aria-label="Imprimir Informe"]')?.click());
    expect(print).not.toHaveBeenCalled();
    const dialog = root.querySelector<HTMLDialogElement>('dialog[open]');
    expect(dialog?.textContent).toContain('Informe');
    expect(dialog?.textContent).toContain('archivos adjuntos');
    await act(() => [...(dialog?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.trim() === 'Imprimir')?.click());
    expect(print).toHaveBeenCalledOnce();
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
