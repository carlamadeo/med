import {describe, expect, it} from 'vitest';
import type {Episode} from '@domain/models';
import {
    episodeDuration,
    episodeStartDate,
    episodeEndDate,
    peakTemperature,
    symptomFrequency,
    topSymptoms,
    observationCount,
    medicationCount,
    severityIndicator,
    episodeSummary,
} from '@domain/episode-summary';

const baseEpisode: Episode = {
    id: '1',
    illness: 'Gripe',
    observations: [
        {date: '2024-01-10', text: 'Síntomas leves', temperature: 37.5, symptoms: [{name: 'fiebre', intensity: 2}, {name: 'dolor cabeza', intensity: 1}]},
        {date: '2024-01-11', text: 'Mejoría', temperature: 37.0, symptoms: [{name: 'fiebre', intensity: 1}]},
        {date: '2024-01-12', text: 'Bien', temperature: 36.5, symptoms: []},
    ],
    medications: [
        {name: 'Paracetamol', frequency: 'cada 8h', instructions: 'Tomar con comida'},
        {name: 'Ibuprofeno', frequency: 'cada 12h', instructions: ''},
    ],
    closed: true,
    endDate: '2024-01-12',
    revision: '1',
};

const openEpisode: Episode = {
    id: '2',
    illness: 'Lumbalgia',
    observations: [
        {date: '2024-02-01', text: 'Dolor fuerte', temperature: undefined, symptoms: [{name: 'dolor espalda', intensity: 5}, {name: 'rigidez', intensity: 3}]},
        {date: '2024-02-03', text: 'Mejor', temperature: undefined, symptoms: [{name: 'dolor espalda', intensity: 3}]},
    ],
    medications: [
        {name: 'Diclofenaco', frequency: 'cada 12h', instructions: 'Con comida'},
    ],
    closed: false,
    revision: '1',
};

const emptyEpisode: Episode = {
    id: '3',
    illness: '',
    observations: [],
    medications: [],
    revision: '1',
};

const highFeverEpisode: Episode = {
    id: '4',
    illness: 'Infección',
    observations: [
        {date: '2024-03-01', text: 'Fiebre alta', temperature: 39.5, symptoms: [{name: 'fiebre', intensity: 5}]},
        {date: '2024-03-02', text: 'Persiste', temperature: 39.2, symptoms: [{name: 'fiebre', intensity: 4}]},
        {date: '2024-03-03', text: 'Bajando', temperature: 38.0, symptoms: [{name: 'fiebre', intensity: 3}]},
        {date: '2024-03-04', text: 'Mejor', temperature: 37.0, symptoms: [{name: 'fiebre', intensity: 2}]},
        {date: '2024-03-05', text: 'Bien', temperature: 36.5, symptoms: []},
    ],
    medications: [],
    closed: true,
    endDate: '2024-03-05',
    revision: '1',
};

describe('episode-summary', () => {
    describe('episodeDuration', () => {
        it('calculates duration from observations and endDate', () => {
            expect(episodeDuration(baseEpisode)).toBe(3);
        });

        it('calculates duration from observations when no endDate', () => {
            const ep = {...openEpisode, endDate: undefined};
            expect(episodeDuration(ep)).toBe(3);
        });

        it('returns null for empty observations', () => {
            expect(episodeDuration(emptyEpisode)).toBeNull();
        });

        it('returns null for invalid endDate before start', () => {
            const ep = {...baseEpisode, endDate: '2024-01-09'};
            expect(episodeDuration(ep)).toBeNull();
        });
    });

    describe('episodeStartDate', () => {
        it('returns first observation date', () => {
            expect(episodeStartDate(baseEpisode)).toBe('2024-01-10');
        });

        it('returns null for empty observations', () => {
            expect(episodeStartDate(emptyEpisode)).toBeNull();
        });
    });

    describe('episodeEndDate', () => {
        it('returns explicit endDate when set', () => {
            expect(episodeEndDate(baseEpisode)).toBe('2024-01-12');
        });

        it('returns last observation date when no endDate', () => {
            expect(episodeEndDate(openEpisode)).toBe('2024-02-03');
        });

        it('returns null for empty observations', () => {
            expect(episodeEndDate(emptyEpisode)).toBeNull();
        });
    });

    describe('peakTemperature', () => {
        it('returns highest temperature', () => {
            expect(peakTemperature(baseEpisode)).toBe(37.5);
        });

        it('returns null when no temperatures', () => {
            expect(peakTemperature(openEpisode)).toBeNull();
        });
    });

    describe('symptomFrequency', () => {
        it('counts occurrences and tracks max intensity', () => {
            const freq = symptomFrequency(baseEpisode);
            expect(freq.get('fiebre')).toEqual({count: 2, maxIntensity: 2, descriptions: []});
            expect(freq.get('dolor cabeza')).toEqual({count: 1, maxIntensity: 1, descriptions: []});
        });

        it('includes descriptions', () => {
            const ep: Episode = {
                ...baseEpisode,
                observations: [{date: '2024-01-10', text: '', temperature: undefined, symptoms: [{name: 'tos', intensity: 2, description: 'seca'}]}],
            };
            const freq = symptomFrequency(ep);
            expect(freq.get('tos')?.descriptions).toEqual(['seca']);
        });
    });

    describe('topSymptoms', () => {
        it('returns top symptoms by count then intensity', () => {
            const top = topSymptoms(baseEpisode, 2);
            expect(top).toHaveLength(2);
            expect(top[0]?.name).toBe('fiebre');
            expect(top[0]?.count).toBe(2);
            expect(top[1]?.name).toBe('dolor cabeza');
        });

        it('respects limit', () => {
            expect(topSymptoms(baseEpisode, 1)).toHaveLength(1);
        });
    });

    describe('observationCount', () => {
        it('counts observations with data', () => {
            expect(observationCount(baseEpisode)).toBe(3);
        });

        it('ignores empty observations', () => {
            const ep: Episode = {
                ...baseEpisode,
                observations: [
                    {date: '2024-01-10', text: 'a', temperature: undefined, symptoms: []},
                    {date: '', text: '', temperature: undefined, symptoms: []},
                ],
            };
            expect(observationCount(ep)).toBe(1);
        });
    });

    describe('medicationCount', () => {
        it('counts medications with name', () => {
            expect(medicationCount(baseEpisode)).toBe(2);
        });

        it('ignores empty medication names', () => {
            const ep: Episode = {...baseEpisode, medications: [{name: '', frequency: '', instructions: ''}]};
            expect(medicationCount(ep)).toBe(0);
        });
    });

    describe('severityIndicator', () => {
        it('returns high for high fever', () => {
            expect(severityIndicator(highFeverEpisode)).toBe('high');
        });

        it('returns high for high intensity symptom', () => {
            // openEpisode has intensity 5 symptom but only 2 observations, score = 2 -> medium
            // Need high intensity + something else for high
            const ep: Episode = {
                ...openEpisode,
                observations: [
                    ...openEpisode.observations,
                    {date: '2024-02-04', text: 'x', temperature: undefined, symptoms: []},
                    {date: '2024-02-05', text: 'x', temperature: undefined, symptoms: []},
                    {date: '2024-02-06', text: 'x', temperature: undefined, symptoms: []},
                ],
            };
            expect(severityIndicator(ep)).toBe('high');
        });

        it('returns medium for long duration', () => {
            const ep: Episode = {
                ...baseEpisode,
                observations: Array.from({length: 7}, (_, i) => ({date: `2024-01-${String(10 + i).padStart(2, '0')}`, text: '', temperature: undefined, symptoms: []})),
            };
            expect(severityIndicator(ep)).toBe('medium');
        });

        it('returns medium for many observations', () => {
            const ep: Episode = {
                ...baseEpisode,
                observations: Array.from({length: 5}, (_, i) => ({date: `2024-01-${String(10 + i).padStart(2, '0')}`, text: 'x', temperature: undefined, symptoms: []})),
            };
            expect(severityIndicator(ep)).toBe('medium');
        });

        it('returns low for mild episode', () => {
            const ep: Episode = {
                ...baseEpisode,
                observations: [{date: '2024-01-10', text: 'leve', temperature: 37.0, symptoms: [{name: 'molestia', intensity: 1}]}],
            };
            expect(severityIndicator(ep)).toBe('low');
        });
    });

    describe('episodeSummary', () => {
        it('returns complete summary', () => {
            const summary = episodeSummary(baseEpisode);
            expect(summary.illness).toBe('Gripe');
            expect(summary.duration).toBe(3);
            expect(summary.startDate).toBe('2024-01-10');
            expect(summary.endDate).toBe('2024-01-12');
            expect(summary.observationCount).toBe(3);
            expect(summary.medicationCount).toBe(2);
            expect(summary.peakTemperature).toBe(37.5);
            expect(summary.topSymptoms).toHaveLength(2);
            expect(summary.severity).toBe('low');
            expect(summary.isClosed).toBe(true);
        });

        it('handles missing illness', () => {
            const summary = episodeSummary({...baseEpisode, illness: ''});
            expect(summary.illness).toBe('Episodio de salud');
        });
    });
});