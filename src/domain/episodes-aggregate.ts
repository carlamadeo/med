import type {Episode} from './models';
import {isValidDate} from './utils';
import {
    episodeDuration,
    episodeStartDate,
    episodeEndDate,
    symptomFrequency,
    severityIndicator
} from './episode-summary';

export type Period = 'year' | '12months' | 'all';

export interface EpisodesAggregate {
    totalEpisodes: number;
    totalDaysIll: number;
    avgDuration: number;
    illnessBreakdown: IllnessStat[];
    monthlyFrequency: MonthlyStat[];
    topSymptoms: SymptomStat[];
    topMedications: MedicationStat[];
    severityDistribution: { low: number; medium: number; high: number };
    longestEpisode: LongestEpisode | null;
    mostFrequentIllness: string | null;
    avgEpisodesPerYear: number;
}

export interface IllnessStat {
    illness: string;
    count: number;
    totalDays: number;
    avgDuration: number;
    lastDate: string;
    severity: 'low' | 'medium' | 'high';
}

export interface MonthlyStat {
    month: string;
    count: number;
    days: number;
}

export interface SymptomStat {
    name: string;
    totalCount: number;
    avgIntensity: number;
    episodesAffected: number;
}

export interface MedicationStat {
    name: string;
    count: number;
}

export interface LongestEpisode {
    illness: string;
    days: number;
    start: string;
    end: string;
}

export function filterEpisodesByPeriod(episodes: readonly Episode[], period: Period): Episode[] {
    if (period === 'all') return [...episodes];
    const now = new Date();
    let cutoff: Date;
    if (period === 'year') {
        cutoff = new Date(now.getFullYear(), 0, 1);
    } else {
        cutoff = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    }
    return episodes.filter(ep => {
        const start = episodeStartDate(ep);
        return start && new Date(start) >= cutoff;
    });
}

function computeMonthlyFrequency(episodes: readonly Episode[], months: number): MonthlyStat[] {
    const now = new Date();
    const result: MonthlyStat[] = [];
    for (let i = months - 1; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        let count = 0;
        let days = 0;
        for (const ep of episodes) {
            for (const obs of ep.observations) {
                if (obs.date.startsWith(monthKey)) {
                    count++;
                    days++;
                    break;
                }
            }
        }
        result.push({month: monthKey, count, days});
    }
    return result;
}

export function computeEpisodesAggregate(episodes: readonly Episode[], period: Period = '12months'): EpisodesAggregate {
    const filtered = filterEpisodesByPeriod(episodes, period);

    if (filtered.length === 0) {
        return emptyAggregate();
    }

    const totalEpisodes = filtered.length;
    let totalDaysIll = 0;
    let totalDuration = 0;
    const illnessMap = new Map<string, {
        count: number;
        totalDays: number;
        durations: number[];
        lastDate: string;
        severities: ('low' | 'medium' | 'high')[]
    }>();
    const symptomMap = new Map<string, {
        totalCount: number;
        intensitySum: number;
        intensityCount: number;
        episodes: Set<string>
    }>();
    const medicationMap = new Map<string, number>();
    let severityLow = 0, severityMedium = 0, severityHigh = 0;
    let longestEpisode: LongestEpisode | null = null;
    let maxDuration = 0;

    for (const ep of filtered) {
        const dur = episodeDuration(ep);
        const sev = severityIndicator(ep);
        const start = episodeStartDate(ep);
        const end = episodeEndDate(ep);

        if (dur !== null) {
            totalDaysIll += dur;
            totalDuration += dur;
            if (dur > maxDuration && start && end) {
                maxDuration = dur;
                longestEpisode = {illness: ep.illness || 'Episodio de salud', days: dur, start, end};
            }
        }

        if (sev === 'low') severityLow++;
        else if (sev === 'medium') severityMedium++;
        else severityHigh++;

        const illnessKey = ep.illness.trim() || 'Sin diagnóstico';
        const existing = illnessMap.get(illnessKey) ?? {
            count: 0,
            totalDays: 0,
            durations: [],
            lastDate: '',
            severities: []
        };
        existing.count++;
        if (dur !== null) {
            existing.totalDays += dur;
            existing.durations.push(dur);
        }
        if (end && (!existing.lastDate || end > existing.lastDate)) {
            existing.lastDate = end;
        }
        existing.severities.push(sev);
        illnessMap.set(illnessKey, existing);

        const freq = symptomFrequency(ep);
        for (const [name, data] of freq) {
            const existingSym = symptomMap.get(name) ?? {
                totalCount: 0,
                intensitySum: 0,
                intensityCount: 0,
                episodes: new Set<string>()
            };
            existingSym.totalCount += data.count;
            if (data.maxIntensity > 0) {
                existingSym.intensitySum += data.maxIntensity;
                existingSym.intensityCount++;
            }
            existingSym.episodes.add(ep.id);
            symptomMap.set(name, existingSym);
        }

        for (const med of ep.medications) {
            const name = med.name.trim();
            if (name) {
                medicationMap.set(name, (medicationMap.get(name) ?? 0) + 1);
            }
        }
    }

    const illnessBreakdown: IllnessStat[] = [...illnessMap.entries()]
        .map(([illness, data]) => {
            const highCount = data.severities.filter(s => s === 'high').length;
            const mediumCount = data.severities.filter(s => s === 'medium').length;
            let severity: 'low' | 'medium' | 'high' = 'low';
            if (highCount > 0) severity = 'high';
            else if (mediumCount > 0) severity = 'medium';
            return {
                illness,
                count: data.count,
                totalDays: data.totalDays,
                avgDuration: data.durations.length > 0 ? data.durations.reduce((a, b) => a + b, 0) / data.durations.length : 0,
                lastDate: data.lastDate,
                severity,
            };
        })
        .sort((a, b) => b.count - a.count || b.totalDays - a.totalDays);

    const monthlyFrequency = computeMonthlyFrequency(filtered, period === 'year' ? 12 : period === '12months' ? 12 : 24);

    const topSymptomsStat: SymptomStat[] = [...symptomMap.entries()]
        .map(([name, data]) => ({
            name,
            totalCount: data.totalCount,
            avgIntensity: data.intensityCount > 0 ? data.intensitySum / data.intensityCount : 0,
            episodesAffected: data.episodes.size,
        }))
        .sort((a, b) => b.totalCount - a.totalCount || b.avgIntensity - a.avgIntensity)
        .slice(0, 10);

    const topMedications: MedicationStat[] = [...medicationMap.entries()]
        .map(([name, count]) => ({name, count}))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

    const mostFrequentIllness = illnessBreakdown[0]?.illness ?? null;

    const yearsSpan = period === 'all' && filtered.length > 0 ?
        (() => {
            const dates = filtered.flatMap(ep => ep.observations.map(o => o.date).filter(isValidDate));
            if (dates.length === 0) return 1;
            const min = Math.min(...dates.map(d => new Date(d).getFullYear()));
            const max = Math.max(...dates.map(d => new Date(d).getFullYear()));
            return max - min + 1;
        })() : 1;

    return {
        totalEpisodes,
        totalDaysIll,
        avgDuration: totalEpisodes > 0 ? totalDuration / totalEpisodes : 0,
        illnessBreakdown,
        monthlyFrequency,
        topSymptoms: topSymptomsStat,
        topMedications,
        severityDistribution: {low: severityLow, medium: severityMedium, high: severityHigh},
        longestEpisode,
        mostFrequentIllness,
        avgEpisodesPerYear: yearsSpan > 0 ? totalEpisodes / yearsSpan : 0,
    };
}

function emptyAggregate(): EpisodesAggregate {
    return {
        totalEpisodes: 0,
        totalDaysIll: 0,
        avgDuration: 0,
        illnessBreakdown: [],
        monthlyFrequency: [],
        topSymptoms: [],
        topMedications: [],
        severityDistribution: {low: 0, medium: 0, high: 0},
        longestEpisode: null,
        mostFrequentIllness: null,
        avgEpisodesPerYear: 0,
    };
}

export function formatMonth(monthKey: string): string {
    const parts = monthKey.split('-');
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const date = new Date(year, month - 1);
    return date.toLocaleDateString('es-ES', {month: 'short', year: '2-digit'});
}

export function shortMonth(monthKey: string): string {
    const parts = monthKey.split('-');
    const month = Number(parts[1]);
    const date = new Date(2000, month - 1);
    return date.toLocaleDateString('es-ES', {month: 'short'});
}