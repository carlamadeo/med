import type {Episode, SymptomObservation} from './models';
import {isValidDate} from './utils';

function observationDates(observations: readonly SymptomObservation[]): string[] {
    return observations.map(observation => observation.date).filter(isValidDate).sort();
}

export function episodeDuration(episode: Pick<Episode, 'observations' | 'endDate'>): number | null {
    const dates = observationDates(episode.observations);
    const [start] = dates;
    const end = isValidDate(episode.endDate) ? episode.endDate : dates.at(-1);
    if (!start || !end || end < start) return null;
    return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 + 1;
}

export function episodeStartDate(episode: Episode): string | null {
    const dates = observationDates(episode.observations);
    return dates[0] ?? null;
}

export function episodeEndDate(episode: Episode): string | null {
    const dates = observationDates(episode.observations);
    const lastObs = dates.at(-1);
    if (isValidDate(episode.endDate)) return episode.endDate;
    return lastObs ?? null;
}

export function peakTemperature(episode: Episode): number | null {
    const temps = episode.observations
        .map(o => o.temperature)
        .filter((t): t is number => t !== undefined && !Number.isNaN(t));
    return temps.length > 0 ? Math.max(...temps) : null;
}

export function symptomFrequency(episode: Episode): Map<string, {
    count: number;
    maxIntensity: number;
    descriptions: string[]
}> {
    const freq = new Map<string, { count: number; maxIntensity: number; descriptions: string[] }>();
    for (const obs of episode.observations) {
        for (const symptom of obs.symptoms) {
            const key = symptom.name.trim().toLowerCase();
            if (!key) continue;
            const existing = freq.get(key) ?? {count: 0, maxIntensity: 0, descriptions: []};
            existing.count += 1;
            if (symptom.intensity !== undefined) existing.maxIntensity = Math.max(existing.maxIntensity, symptom.intensity);
            if (symptom.description?.trim()) existing.descriptions.push(symptom.description.trim());
            freq.set(key, existing);
        }
    }
    return freq;
}

export function topSymptoms(episode: Episode, limit = 3): Array<{ name: string; count: number; maxIntensity: number }> {
    const freq = symptomFrequency(episode);
    return [...freq.entries()]
        .map(([name, data]) => ({name, count: data.count, maxIntensity: data.maxIntensity}))
        .sort((a, b) => b.count - a.count || b.maxIntensity - a.maxIntensity)
        .slice(0, limit);
}

export function observationCount(episode: Episode): number {
    return episode.observations.filter(o => o.date || o.text || o.temperature !== undefined || o.symptoms.length > 0).length;
}

export function medicationCount(episode: Episode): number {
    return episode.medications.filter(m => m.name.trim()).length;
}

export function severityIndicator(episode: Episode): 'low' | 'medium' | 'high' {
    const peak = peakTemperature(episode);
    const top = topSymptoms(episode, 1)[0];
    const hasHighFever = peak !== null && peak >= 39;
    const hasHighIntensitySymptom = top?.maxIntensity !== undefined && top.maxIntensity >= 4;
    const longDuration = (episodeDuration(episode) ?? 0) >= 7;
    const manyObservations = observationCount(episode) >= 5;

    let score = 0;
    if (hasHighFever) score += 2;
    if (hasHighIntensitySymptom) score += 2;
    if (longDuration) score += 1;
    if (manyObservations) score += 1;

    if (score >= 3) return 'high';
    if (score >= 1) return 'medium';
    return 'low';
}

export function episodeSummary(episode: Episode) {
    return {
        illness: episode.illness || 'Episodio de salud',
        duration: episodeDuration(episode),
        startDate: episodeStartDate(episode),
        endDate: episodeEndDate(episode),
        observationCount: observationCount(episode),
        medicationCount: medicationCount(episode),
        peakTemperature: peakTemperature(episode),
        topSymptoms: topSymptoms(episode, 3),
        severity: severityIndicator(episode),
        isClosed: episode.closed || Boolean(episode.endDate),
    };
}