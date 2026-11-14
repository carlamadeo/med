import {describe, expect, it} from 'vitest';
import {filterStudies, portalNames} from '@domain/library';
import type {Filters, Study} from '@domain/models';

function study(id: string, over: Partial<Study> = {}): Study {
    return {
        id,
        title: `Estudio ${id}`,
        date: '2024-01-01',
        types: ['Otro'],
        doctor: '',
        portal: '',
        viewer: '',
        reportName: '',
        hasPdf: false,
        driveFileId: id,
        driveModifiedTime: '',
        revision: '1',
        ...over,
    };
}

const none: Filters = {
    query: '',
    type: '',
    from: '',
    to: '',
    operationId: '',
    portal: '',
    onlyPdf: false,
    onlyViewer: false
};

describe('filterStudies', () => {
    const all = [
        study('a', {
            title: 'Ecografía abdominal',
            date: '2024-01-15',
            types: ['Ecografía'],
            doctor: 'Dra. Ana Pérez',
            portal: 'Hospital Central'
        }),
        study('b', {title: 'Mamografía', date: '2024-03-10', types: ['Mamografía', 'Ecografía'], portal: 'LabCorp'}),
        study('c', {
            title: 'Análisis de sangre',
            date: '2023-12-01',
            types: ['Análisis de laboratorio'],
            doctor: 'Dr. Juan López'
        }),
    ];

    it('returns everything, newest first, when nothing is filtered', () => {
        const result = filterStudies(all, none);

        expect(result.matches.map((s) => s.id)).toEqual(['b', 'a', 'c']);
        expect(result.filtered).toBe(false);
        expect(result.invalidRange).toBe(false);
    });

    it('orders studies of the same day alphabetically (es-AR), not by insertion', () => {
        const sameDay = [study('z', {title: 'Zeta', date: '2024-05-05'}), study('n', {
            title: 'Ñandú',
            date: '2024-05-05'
        }), study('a', {title: 'Álamo', date: '2024-05-05'})];

        expect(filterStudies(sameDay, none).matches.map((s) => s.title)).toEqual(['Álamo', 'Ñandú', 'Zeta']);
    });

    it('does not reorder or mutate the input', () => {
        const input = [...all];
        filterStudies(input, none);
        expect(input.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    });

    it('searches title, doctor, portal and types ignoring accents, case and surrounding spaces', () => {
        const ids = (query: string) => filterStudies(all, {...none, query}).matches.map((s) => s.id);

        expect(ids('ECOGRAFIA')).toEqual(['b', 'a']);
        expect(ids('  perez ')).toEqual(['a']);
        expect(ids('labcorp')).toEqual(['b']);
        expect(ids('lopez')).toEqual(['c']);
        expect(ids('no existe')).toEqual([]);
    });

    it('finds a study by its PDF filename', () => {
        const records = [study('a', {reportName: 'Análisis-Marzo.pdf'}), study('b')];
        expect(filterStudies(records, {...none, query: 'analisis-marzo'}).matches.map(item => item.id)).toEqual(['a']);
    });

    it('filters by exact study type, including studies that have several', () => {
        expect(filterStudies(all, {...none, type: 'ecografia'}).matches.map((s) => s.id)).toEqual(['b', 'a']);
        expect(filterStudies(all, {...none, type: 'PAP'}).matches).toEqual([]);
    });

    it('filters by an inclusive date range', () => {
        const ids = (from: string, to: string) => filterStudies(all, {...none, from, to}).matches.map((s) => s.id);

        expect(ids('2024-01-15', '2024-03-10')).toEqual(['b', 'a']);
        expect(ids('2024-01-16', '')).toEqual(['b']);
        expect(ids('', '2023-12-01')).toEqual(['c']);
    });

    it('combines search, type and date filters', () => {
        const result = filterStudies(all, {...none, query: 'eco', type: 'Ecografía', from: '2024-03-11'});
        expect(result.matches.map((s) => s.id)).toEqual([]);
        expect(filterStudies(all, {
            ...none,
            query: 'mamo',
            type: 'Ecografía',
            from: '2024-02-01'
        }).matches.map((s) => s.id)).toEqual(['b']);
    });

    it.each([
        [{operationId: 'op-1'}, ['b', 'a']],
        [{portal: 'CLINICA SUR'}, ['a']],
        [{onlyPdf: true}, ['c', 'a']],
        [{onlyViewer: true}, ['b']],
    ] as const)('filters by %o', (filters, expectedIds) => {
        const studies = [
            study('a', {date: '2024-01-01', operationId: 'op-1', portal: 'Clínica Sur', hasPdf: true}),
            study('b', {date: '2024-02-01', operationId: 'op-1', viewer: 'https://example.test/view'}),
            study('c', {date: '2024-03-01', operationId: 'op-2', hasPdf: true}),
        ];

        const result = filterStudies(studies, {...none, ...filters});

        expect(result.matches.map((study) => study.id)).toEqual(expectedIds);
        expect(result.filtered).toBe(true);
    });

    it('matches any selected category alongside the other filters', () => {
        const categories = ['MAMOGRAFIA', 'analisis de laboratorio'];
        const result = filterStudies(all, none, categories);
        const withDate = filterStudies(all, {...none, from: '2024-01-01'}, categories);

        expect(result.matches.map((study) => study.id)).toEqual(['b', 'c']);
        expect(result.filtered).toBe(true);
        expect(withDate.matches.map((study) => study.id)).toEqual(['b']);
    });

    it.each([
        ['date-asc', ['c', 'a', 'b']],
        ['title', ['b', 'a', 'c']],
        ['type', ['a', 'c', 'b']],
    ] as const)('sorts the results by %s', (order, expectedIds) => {
        const studies = [
            study('a', {date: '2024-02-01', title: 'Biopsia', types: []}),
            study('b', {date: '2024-03-01', title: 'Análisis', types: ['Mamografía']}),
            study('c', {date: '2024-01-01', title: 'Consulta', types: ['Ecografía']}),
        ];

        expect(filterStudies(studies, none, [], order).matches.map((study) => study.id)).toEqual(expectedIds);
    });

    it('flags a reversed range and matches nothing', () => {
        const result = filterStudies(all, {...none, from: '2024-06-01', to: '2024-01-01'});

        expect(result.invalidRange).toBe(true);
        expect(result.matches).toEqual([]);
        expect(result.filtered).toBe(true);
    });

    it('counts a search as an active filter only when it contains searchable text', () => {
        expect(filterStudies(all, {...none, query: '   '}).filtered).toBe(false);
        expect(filterStudies(all, {...none, query: 'a'}).filtered).toBe(true);
    });
});

describe('portalNames', () => {
    it('lists each institution once, ignoring case, accents and repeated spaces', () => {
        const names = portalNames([
            study('1', {portal: 'Hospital  Central'}),
            study('2', {portal: 'hospital central'}),
            study('3', {portal: 'Clínica Sur'}),
            study('4', {portal: '  '}),
            study('5', {portal: ''}),
        ]);

        expect(names).toEqual(['Clínica Sur', 'Hospital Central']);
    });

    it('keeps the first spelling it sees and sorts with Spanish rules', () => {
        expect(portalNames([study('1', {portal: 'Ñuñoa'}), study('2', {portal: 'Nacional'}), study('3', {portal: 'Álvarez'})])).toEqual([
            'Álvarez',
            'Nacional',
            'Ñuñoa',
        ]);
    });

    it('is empty when no study names an institution', () => {
        expect(portalNames([study('1')])).toEqual([]);
    });
});
