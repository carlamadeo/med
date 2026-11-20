import type {Episode, SymptomObservation} from './models';
import {isValidDate} from './utils';

function observationDates(observations: readonly SymptomObservation[]): string[] {
    return observations.map(observation => observation.date).filter(isValidDate).sort();
}

export function episodeEndDateError(endDate: string | undefined, observations: readonly SymptomObservation[]): string | undefined {
    if (endDate === undefined) return;
    if (!isValidDate(endDate)) return 'Ingresá una fecha de finalización válida.';
    const [start] = observationDates(observations);
    if (start && endDate < start) return 'La fecha de finalización no puede ser anterior al inicio del episodio.';
}

export function episodeDuration(episode: Pick<Episode, 'observations' | 'endDate'>): number | null {
    const dates = observationDates(episode.observations);
    const [start] = dates;
    const end = isValidDate(episode.endDate) ? episode.endDate : dates.at(-1);
    if (!start || !end || end < start) return null;
    return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 + 1;
}
