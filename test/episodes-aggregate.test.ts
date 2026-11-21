import {describe, expect, it} from 'vitest';
import type {Episode} from '@domain/models';
import {computeEpisodesAggregate, formatMonth, shortMonth, filterEpisodesByPeriod} from '@domain/episodes-aggregate';

function makeEpisode(overrides: Partial<Episode> = {}): Episode {
    const now = new Date();
    const baseDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return {
        id: '1',
        illness: 'Gripe',
        observations: [
            {date: `${baseDate}-10`, text: 'Síntomas', temperature: 38.0, symptoms: [{name: 'fiebre', intensity: 3}, {name: 'tos', intensity: 2}]},
            {date: `${baseDate}-11`, text: 'Mejor', temperature: 37.5, symptoms: [{name: 'fiebre', intensity: 2}]},
        ],
        medications: [{name: 'Paracetamol', frequency: 'cada 8h', instructions: ''}],
        closed: true,
        endDate: `${baseDate}-11`,
        revision: '1',
        ...overrides,
    };
}




describe('episodes-aggregate', () => {
    const now = new Date();
    const baseDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prevMonth = `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`;
    
    const episodes = [
        makeEpisode({id: '1', illness: 'Gripe', observations: [
            {date: `${baseDate}-10`, text: '', temperature: 38.0, symptoms: [{name: 'fiebre', intensity: 3}]},
            {date: `${baseDate}-11`, text: '', temperature: 37.5, symptoms: [{name: 'fiebre', intensity: 2}]},
        ]}),
        makeEpisode({id: '2', illness: 'Gripe', observations: [
            {date: `${prevMonth}-01`, text: '', temperature: 39.0, symptoms: [{name: 'fiebre', intensity: 4}, {name: 'dolor cuerpo', intensity: 3}]},
        ], closed: true, endDate: `${prevMonth}-01`}),
        makeEpisode({id: '3', illness: 'Otitis', observations: [
            {date: `${baseDate}-10`, text: '', temperature: 38.5, symptoms: [{name: 'dolor oido', intensity: 5}]},
            {date: `${baseDate}-11`, text: '', temperature: 38.0, symptoms: [{name: 'dolor oido', intensity: 4}]},
            {date: `${baseDate}-12`, text: '', temperature: 37.0, symptoms: [{name: 'dolor oido', intensity: 2}]},
        ], medications: [{name: 'Amoxicilina', frequency: 'cada 8h', instructions: ''}]}),
        makeEpisode({id: '4', illness: 'Lumbalgia', observations: [
            {date: `${baseDate}-01`, text: '', temperature: undefined, symptoms: [{name: 'dolor espalda', intensity: 5}]},
        ]}),
    ];

    describe('computeEpisodesAggregate', () => {
        it('computes basic aggregates for all time', () => {
            const agg = computeEpisodesAggregate(episodes, 'all');
            expect(agg.totalEpisodes).toBe(4);
            expect(agg.totalDaysIll).toBeGreaterThan(0);
            expect(agg.avgDuration).toBeGreaterThan(0);
            expect(agg.illnessBreakdown.length).toBeGreaterThan(0);
            expect(agg.monthlyFrequency.length).toBeGreaterThan(0);
            expect(agg.topSymptoms.length).toBeGreaterThan(0);
            expect(agg.topMedications.length).toBeGreaterThan(0);
        });

        it('computes aggregates for year period', () => {
            const agg = computeEpisodesAggregate(episodes, 'year');
            expect(agg.totalEpisodes).toBeLessThanOrEqual(4);
        });

        it('computes aggregates for 12months period', () => {
            const agg = computeEpisodesAggregate(episodes, '12months');
            expect(agg.totalEpisodes).toBeLessThanOrEqual(4);
        });

        it('returns empty aggregate for empty episodes', () => {
            const agg = computeEpisodesAggregate([], 'all');
            expect(agg.totalEpisodes).toBe(0);
            expect(agg.totalDaysIll).toBe(0);
            expect(agg.illnessBreakdown).toHaveLength(0);
        });

        it('sorts illness breakdown by count then totalDays', () => {
            const agg = computeEpisodesAggregate(episodes, 'all');
            expect(agg.illnessBreakdown[0]?.illness).toBe('Gripe');
            expect(agg.illnessBreakdown[0]?.count).toBe(2);
        });

        it('includes severity in illness breakdown', () => {
            const agg = computeEpisodesAggregate(episodes, 'all');
            const gripe = agg.illnessBreakdown.find(i => i.illness === 'Gripe');
            expect(gripe?.severity).toMatch(/^(low|medium|high)$/);
        });

        it('computes monthly frequency for 12 months in 12months period', () => {
            const agg = computeEpisodesAggregate(episodes, '12months');
            expect(agg.monthlyFrequency).toHaveLength(12);
        });

        it('computes top symptoms with avg intensity', () => {
            const agg = computeEpisodesAggregate(episodes, 'all');
            const fiebre = agg.topSymptoms.find(s => s.name === 'fiebre');
            expect(fiebre).toBeDefined();
            expect(fiebre?.totalCount).toBeGreaterThan(0);
            expect(fiebre?.avgIntensity).toBeGreaterThan(0);
        });

        it('computes top medications', () => {
            const agg = computeEpisodesAggregate(episodes, 'all');
            const paracetamol = agg.topMedications.find(m => m.name === 'Paracetamol');
            expect(paracetamol).toBeDefined();
            expect(paracetamol?.count).toBeGreaterThan(0);
        });

        it('computes severity distribution', () => {
            const agg = computeEpisodesAggregate(episodes, 'all');
            const total = agg.severityDistribution.low + agg.severityDistribution.medium + agg.severityDistribution.high;
            expect(total).toBe(4);
        });

        it('finds longest episode', () => {
            const agg = computeEpisodesAggregate(episodes, 'all');
            expect(agg.longestEpisode).not.toBeNull();
            expect(agg.longestEpisode?.days).toBeGreaterThan(0);
        });

        it('finds most frequent illness', () => {
            const agg = computeEpisodesAggregate(episodes, 'all');
            expect(agg.mostFrequentIllness).toBe('Gripe');
        });
    });

    describe('filterEpisodesByPeriod', () => {
        it('returns all episodes for all period', () => {
            const filtered = filterEpisodesByPeriod(episodes, 'all');
            expect(filtered).toHaveLength(4);
        });

        it('filters by year', () => {
            const filtered = filterEpisodesByPeriod(episodes, 'year');
            expect(filtered.length).toBeLessThanOrEqual(4);
        });

        it('filters by 12months', () => {
            const filtered = filterEpisodesByPeriod(episodes, '12months');
            expect(filtered.length).toBeLessThanOrEqual(4);
        });
    });

    describe('formatMonth', () => {
        it('formats month key to short month year', () => {
            expect(formatMonth('2024-01')).toMatch(/^ene/);
            expect(formatMonth('2024-12')).toMatch(/^dic/);
        });
    });

    describe('shortMonth', () => {
        it('returns short month name', () => {
            expect(shortMonth('2024-01')).toMatch(/^ene/);
            expect(shortMonth('2024-06')).toMatch(/^jun/);
        });
    });
});