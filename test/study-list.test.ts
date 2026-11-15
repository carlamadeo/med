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
    const rows = [...root.querySelectorAll<HTMLTableRowElement>('tbody tr')];
    expect([...root.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual([
        'Estudio', 'Fecha', 'Profesional', 'Institución', 'Estado', 'Acciones',
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

it('shows sync status for each study', async () => {
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
    expect(root.textContent).toContain('Sincronizado');
    expect(root.textContent).toContain('Pendiente');
    expect(root.textContent).toContain('Conflicto');
    expect(root.querySelector<HTMLButtonElement>('button[aria-label="Editar Synced"]')?.disabled).toBe(false);
    expect(root.querySelector<HTMLButtonElement>('button[aria-label="Editar Pending"]')?.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('button[aria-label="Eliminar Conflict"]')?.disabled).toBe(true);
});