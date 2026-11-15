import {h, render} from 'preact';
import {act} from 'preact/test-utils';
import {afterEach, expect, it} from 'vitest';
import {StudyListContainer} from '@presentation/components/StudyListContainer';
import {categoryTypes, setStudies, view, visibleStudies} from '@presentation/state/store';

const root = document.createElement('div');
afterEach(() => {
    render(null, root);
    categoryTypes.value = [];
    setStudies([]);
});

it('shows study type filters directly and filters the library', async () => {
    view.value = 'cronologia';
    const base = {date: '2024-01-01', doctor: '', portal: '', viewer: '', reportName: '', hasPdf: false, driveModifiedTime: '', revision: '1'};
    setStudies([
        {...base, id: '1', driveFileId: '1', title: 'Uno', types: ['Radiografía']},
        {...base, id: '2', driveFileId: '2', title: 'Dos', types: ['Análisis']},
    ]);
    await act(() => render(h(StudyListContainer, {
        onEdit: () => {}, onDelete: () => {}, onRetryLoad: () => {}, onAddStudy: () => {},
        onOpenCandidate: () => {}, typesReady: true, availableTypes: ['Radiografía', 'Análisis'],
        offline: false, directoryWarning: false, pendingChangesCount: 0,
    }), root));
    expect(root.querySelector('.view-nav')).toBeNull();
    const filter = [...root.querySelectorAll('button')].find((button) => button.textContent === 'Radiografía');
    expect(filter).toBeDefined();
    await act(() => filter?.click());
    expect(visibleStudies.value.map((study) => study.title)).toEqual(['Uno']);
    expect(filter?.getAttribute('aria-pressed')).toBe('true');
    await act(() => filter?.click());
    expect(visibleStudies.value).toHaveLength(2);
});

it('combines accent-insensitive study search with multiple selected types', async () => {
    view.value = 'cronologia';
    const base = {date: '2024-01-01', viewer: '', reportName: '', hasPdf: false, driveModifiedTime: '', revision: '1'};
    setStudies([
        {...base, id: '1', driveFileId: '1', title: 'Radiografía de tórax', doctor: 'Dra. Núñez', portal: 'Clínica Sur', types: ['Radiografía']},
        {...base, id: '2', driveFileId: '2', title: 'Hemograma', doctor: 'Dr. Méndez', portal: 'Clínica Sur', types: ['Análisis']},
        {...base, id: '3', driveFileId: '3', title: 'Ecografía renal', doctor: 'Dra. Núñez', portal: 'Clínica Sur', types: ['Ecografía']},
    ]);
    await act(() => render(h(StudyListContainer, {
        onEdit: () => {}, onDelete: () => {}, onRetryLoad: () => {}, onAddStudy: () => {},
        onOpenCandidate: () => {}, typesReady: true, availableTypes: ['Radiografía', 'Análisis', 'Ecografía'],
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
    await act(() => button('Radiografía')?.click());
    await act(() => button('Análisis')?.click());
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
