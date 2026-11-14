import {expect, it} from 'vitest';
import {validateStudyDraft} from '@domain/validation/study';
import type {StudyDraft} from '@domain/repository';

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
