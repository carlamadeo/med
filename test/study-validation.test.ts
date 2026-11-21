import {afterEach, describe, expect, it, vi} from 'vitest';
import {validateStudyDraft} from '@domain/validation/study';
import type {StudyDraft} from '@domain/repository';
import {isValidDate, isValidStudyDate, normalize, todayLocal, viewerURL} from '@domain/utils';

const draft: StudyDraft = {
    title: 'Estudio de prueba',
    date: '2026-01-01',
    types: ['Ecografía'],
    doctor: '',
    portal: '',
    viewer: '',
    reportName: '',
};

it('rejects study dates in the future', () => {
    expect(validateStudyDraft({...draft, date: '2999-01-01'})).toContain(
        'Ingresá una fecha válida que no sea futura.'
    );
});

afterEach(() => vi.useRealTimers());

describe('study validation utilities', () => {
    it('normalizes accents, case and whitespace', () => {
        expect(normalize('  ÉCO-GRAFÍa  ')).toBe('eco-grafia');
    });

    it('accepts only real dates at or after 1900', () => {
        expect(isValidDate('2024-02-29')).toBe(true);
        expect(isValidDate('2023-02-29')).toBe(false);
        expect(isValidDate('1899-12-31')).toBe(false);
        expect(isValidDate('24/03/2024')).toBe(false);
        expect(isValidDate(20240324)).toBe(false);
    });

    it('rejects future study dates', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-03-18T12:00:00'));
        expect(isValidStudyDate(todayLocal())).toBe(true);
        expect(isValidStudyDate('2099-01-01')).toBe(false);
    });

    it('requires plain HTTP(S) viewer links without credentials', () => {
        expect(viewerURL('')).toBe('');
        expect(viewerURL('https://example.com/visor')).toBe('https://example.com/visor');
        expect(() => viewerURL('javascript:alert(1)')).toThrow();
        expect(() => viewerURL('https://usuario@example.com')).toThrow();
    });

    it('reports all invalid fields in a study draft', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-03-18T12:00:00'));
        expect(validateStudyDraft({
            ...draft,
            title: ' ',
            date: '2099-01-01',
            types: [],
            viewer: 'javascript:alert(1)',
        })).toEqual([
            'Ingresá un nombre para el estudio.',
            'Ingresá una fecha válida que no sea futura.',
            'Elegí al menos un tipo de estudio.',
            'Pegá un enlace al visor que empiece con https:// o http://.',
        ]);
    });
});
