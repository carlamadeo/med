import {h, render} from 'preact';
import {act} from 'preact/test-utils';
import {afterEach, expect, it} from 'vitest';
import {StudyListContainer} from '@presentation/components/StudyListContainer';
import {categoryTypes, filteredStudies, setStudies, view, visibleStudies} from '@presentation/state/store';

const root = document.createElement('div');
afterEach(() => {
    render(null, root);
    categoryTypes.value = [];
    setStudies([]);
});

it('shows study type filters directly and filters the library', async () => {
    view.value = 'cronologia';
    const base = {
        date: '2024-01-01',
        doctor: '',
        portal: '',
        viewer: '',
        reportName: '',
        hasPdf: false,
        driveModifiedTime: '',
        revision: '1'
    };
    setStudies([
        {...base, id: '1', driveFileId: '1', title: 'Uno', types: ['Radiografía']},
        {...base, id: '2', driveFileId: '2', title: 'Dos', types: ['Análisis']},
        {...base, id: '3', driveFileId: '3', title: 'Tres', types: ['radiografia']},
    ]);
    await act(() => render(h(StudyListContainer, {
        onEdit: () => {
        }, onDelete: () => {
        }, onRetryLoad: () => {
        }, onAddStudy: () => {
        },
        onOpenCandidate: () => {
        }, typesReady: true, availableTypes: ['Radiografía', 'Análisis'],
        offline: false, directoryWarning: false, pendingChangesCount: 0,
    }), root));
    expect(root.querySelector('.library-views')).toBeNull();
    const trigger = root.querySelector<HTMLElement>('#categories [role="combobox"]')!;
    expect(trigger).not.toBeNull();
    await act(() => trigger.click());
    const option = (name: string) =>
        [...root.querySelectorAll<HTMLLIElement>('#categories [role="option"]')]
            .find((el) => el.querySelector('span')?.textContent === name);
    await act(() => option('Radiografía')?.click());
    expect(filteredStudies.value.map((study) => study.title)).toEqual(['Uno', 'Tres']);
    expect(visibleStudies.value.map((study) => study.title)).toEqual(['Uno', 'Dos', 'Tres']);
    expect(option('Radiografía')?.getAttribute('aria-selected')).toBe('true');
    expect(root.querySelector('.related-heading')?.textContent).toContain('Estudios de Radiografía');
    expect(root.querySelector('.related-heading')?.textContent).toContain('2 estudios');
    await act(() => option('Radiografía')?.click());
    expect(filteredStudies.value).toHaveLength(3);
});

it('combines accent-insensitive study search with multiple selected types', async () => {
    view.value = 'cronologia';
    const base = {date: '2024-01-01', viewer: '', reportName: '', hasPdf: false, driveModifiedTime: '', revision: '1'};
    setStudies([
        {
            ...base,
            id: '1',
            driveFileId: '1',
            title: 'Radiografía de tórax',
            doctor: 'Dra. Núñez',
            portal: 'Clínica Sur',
            types: ['Radiografía']
        },
        {
            ...base,
            id: '2',
            driveFileId: '2',
            title: 'Hemograma',
            doctor: 'Dr. Méndez',
            portal: 'Clínica Sur',
            types: ['Análisis']
        },
        {
            ...base,
            id: '3',
            driveFileId: '3',
            title: 'Ecografía renal',
            doctor: 'Dra. Núñez',
            portal: 'Clínica Sur',
            types: ['Ecografía']
        },
    ]);
    await act(() => render(h(StudyListContainer, {
        onEdit: () => {
        }, onDelete: () => {
        }, onRetryLoad: () => {
        }, onAddStudy: () => {
        },
        onOpenCandidate: () => {
        }, typesReady: true, availableTypes: ['Radiografía', 'Análisis', 'Ecografía'],
        offline: false, directoryWarning: false, pendingChangesCount: 0,
    }), root));

    const search = root.querySelector<HTMLInputElement>('input[type="search"][aria-label="Buscar estudios"]');
    expect(search).not.toBeNull();
    const searchFor = (query: string) => act(() => {
        if (!search) throw new Error('Missing search input');
        search.value = query;
        search.dispatchEvent(new Event('input', {bubbles: true}));
    });
    const button = (label: string) => [...root.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
    const titles = () => [...root.querySelectorAll('.study-title')].map((title) => title.textContent);

    await searchFor('  TORAX ');
    expect(titles()).toEqual(['Radiografía de tórax']);
    await searchFor('NUNEZ');
    expect(titles()).toEqual(['Radiografía de tórax', 'Ecografía renal']);
    await act(() => root.querySelector<HTMLElement>('#categories [role="combobox"]')?.click());
    const typeOption = (name: string) =>
        [...root.querySelectorAll<HTMLLIElement>('#categories [role="option"]')]
            .find((el) => el.querySelector('span')?.textContent === name);
    await act(() => typeOption('Radiografía')?.click());
    await act(() => typeOption('Análisis')?.click());
    expect(titles()).toEqual(['Radiografía de tórax']);

    await searchFor('clinica sur');
    expect(titles()).toEqual(['Radiografía de tórax', 'Hemograma']);
    await searchFor('sin coincidencia');
    expect(root.querySelector('[role="status"]')?.textContent).toContain('No hay resultados');
    expect(root.textContent).not.toContain('Tu archivo empieza acá');

    await act(() => button('Limpiar filtros')?.click());
    expect(search?.value).toBe('');
    expect(titles()).toHaveLength(3);
    expect(categoryTypes.value).toEqual([]);
    await act(() => setStudies([]));
    expect(root.textContent).toContain('Tu archivo empieza acá');
});

it('shows studies with and without printed copies in the same library search', async () => {
    view.value = 'cronologia';
    const base = {
        date: '2024-01-01', types: ['Otro'], doctor: '', portal: '', viewer: '', reportName: '',
        hasPdf: false, driveModifiedTime: '', revision: '1', driveFileId: ''
    };
    setStudies([
        {...base, id: '1', title: 'Radiografía de rodilla', printed: {report: true, image: false}},
        {...base, id: '2', title: 'Radiografía de tórax'},
        {...base, id: '3', title: 'Ecografía abdominal', printed: {report: false, image: true}},
    ]);
    await act(() => render(h(StudyListContainer, {
        onEdit: () => {
        }, onDelete: () => {
        }, onRetryLoad: () => {
        }, onAddStudy: () => {
        },
        onOpenCandidate: () => {
        }, typesReady: true, availableTypes: ['Otro'],
        offline: false, directoryWarning: false, pendingChangesCount: 0,
    }), root));

    expect(root.textContent).not.toContain('Solo impresos');
    expect(filteredStudies.value).toHaveLength(3);
    const search = root.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(() => {
        search.value = 'radiografía';
        search.dispatchEvent(new Event('input', {bubbles: true}));
    });
    expect([...root.querySelectorAll('.study-title')].map(title => title.textContent))
        .toEqual(['Radiografía de rodilla', 'Radiografía de tórax']);
    await act(() => {
        search.value = '';
        search.dispatchEvent(new Event('input', {bubbles: true}));
    });
});

it('allows changing sort order by clicking table headers in the study list', async () => {
    view.value = 'cronologia';
    const base = {
        driveFileId: 'drive-id',
        viewer: '',
        reportName: '',
        hasPdf: false,
        driveModifiedTime: '',
        revision: '1'
    };
    setStudies([
        {
            ...base,
            id: '1',
            date: '2024-01-01',
            title: 'Radiografía',
            doctor: 'Dr. Zorrilla',
            portal: 'Centro B',
            types: ['Radiografía']
        },
        {
            ...base,
            id: '2',
            date: '2024-03-01',
            title: 'Análisis',
            doctor: 'Dr. Álvarez',
            portal: 'Centro C',
            types: ['Análisis']
        },
        {
            ...base,
            id: '3',
            date: '2023-01-01',
            title: 'Ecografía',
            doctor: 'Dr. Méndez',
            portal: 'Centro A',
            types: ['Ecografía']
        },
    ]);
    await act(() => render(h(StudyListContainer, {
        onEdit: () => {
        }, onDelete: () => {
        }, onRetryLoad: () => {
        }, onAddStudy: () => {
        },
        onOpenCandidate: () => {
        }, typesReady: true, availableTypes: ['Radiografía', 'Análisis', 'Ecografía'],
        offline: false, directoryWarning: false, pendingChangesCount: 0,
    }), root));

    expect(root.querySelector('#library-sort')).toBeNull();
    const titles = () => [...root.querySelectorAll('.study-title')].map((t) => t.textContent);
    const headerButton = (name: string) =>
        [...root.querySelectorAll<HTMLButtonElement>('thead th button')].find((b) => b.textContent?.trim() === name)!;

    // Default: date-desc
    expect(titles()).toEqual(['Análisis', 'Radiografía', 'Ecografía']);
    expect(headerButton('Fecha').closest('th')?.getAttribute('aria-sort')).toBe('descending');

    // Toggle Fecha to date-asc
    await act(() => headerButton('Fecha').click());
    expect(titles()).toEqual(['Ecografía', 'Radiografía', 'Análisis']);
    expect(headerButton('Fecha').closest('th')?.getAttribute('aria-sort')).toBe('ascending');

    // Sort by Estudio (A-Z) and toggle to Z-A
    await act(() => headerButton('Estudio').click());
    expect(titles()).toEqual(['Análisis', 'Ecografía', 'Radiografía']);
    await act(() => headerButton('Estudio').click());
    expect(titles()).toEqual(['Radiografía', 'Ecografía', 'Análisis']);

    // Sort by Profesional (A-Z)
    await act(() => headerButton('Profesional').click());
    expect(titles()).toEqual(['Análisis', 'Ecografía', 'Radiografía']);

    // Sort by Institución (A-Z)
    await act(() => headerButton('Institución').click());
    expect(titles()).toEqual(['Ecografía', 'Radiografía', 'Análisis']);
});
