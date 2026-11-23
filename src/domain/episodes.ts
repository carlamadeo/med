import type {SymptomObservation} from './models';
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
