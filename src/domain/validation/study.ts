import {isValidStudyDate, viewerURL} from '../utils';
import type {StudyDraft} from '../repository';

export function validateStudyDraft(draft: StudyDraft): string[] {
    const errors: string[] = [];
    if (!draft.title?.trim()) errors.push('Ingresá un nombre para el estudio.');
    if (!isValidStudyDate(draft.date)) errors.push('Ingresá una fecha válida que no sea futura.');
    if (!draft.types?.length) errors.push('Elegí al menos un tipo de estudio.');
    try {
        viewerURL(draft.viewer);
    } catch {
        errors.push('Pegá un enlace al visor que empiece con https:// o http://.');
    }
    return errors;
}