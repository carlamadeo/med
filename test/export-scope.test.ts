import {describe, expect, it} from 'vitest';
import {selectExportSnapshot, type ExportSnapshot} from '@domain/export-scope';

const snapshot: ExportSnapshot = {
    studies: [
        {
            id: 's1',
            driveFileId: 's1',
            title: 'Laboratorio',
            date: '2026-10-01',
            types: ['Laboratorio'],
            doctor: 'Dra. Gómez',
            portal: 'Clínica Central',
            viewer: 'https://viewer.example/1',
            reportName: 'lab.pdf',
            hasPdf: true,
            driveModifiedTime: '2026-10-01T10:00:00Z',
            revision: '1',
            operationId: 'op1',
            documentIds: ['s1', 's2'],
        },
        {
            id: 's2',
            driveFileId: 's2',
            title: 'Radiografía sin adjunto',
            date: '2026-10-02',
            types: ['Radiografía'],
            doctor: 'Dr. Pérez',
            portal: 'Hospital Norte',
            viewer: '',
            reportName: '',
            hasPdf: false,
            driveModifiedTime: '2026-10-02T10:00:00Z',
            revision: '1',
            operationId: 'op2',
            documentIds: [],
        },
    ],
    operations: [
        {
            id: 'op1',
            name: 'Control',
            date: '2026-10-01',
            type: 'Consulta',
            color: '',
            studyIds: ['s1', 's2'],
            revision: '1',
        },
        {
            id: 'op2',
            name: 'Cirugía',
            date: '2026-10-02',
            type: 'Cirugía',
            color: '',
            studyIds: ['s2'],
            revision: '1',
        },
    ],
    portals: [
        {
            id: 'p1',
            name: 'clinica central',
            displayName: 'Clínica Central',
            url: 'https://portal.example/central',
            notes: '',
            revision: '1',
        },
        {
            id: 'p2',
            name: 'Hospital Norte',
            displayName: 'Hospital Norte',
            url: 'https://portal.example/norte',
            notes: '',
            revision: '1',
        },
    ],
    medicalEvents: [
        {
            id: 'ev1',
            kind: 'consultation',
            date: '2026-10-03',
            doctor: 'Dra. Gómez',
            notes: 'Control',
            studyIds: ['s1', 's2'],
            documentIds: ['s1', 's2'],
            revision: '1',
        },
        {
            id: 'ev2',
            kind: 'prescription',
            date: '2026-10-04',
            doctor: 'Dr. Pérez',
            notes: 'Solo estudio ajeno',
            studyIds: [],
            documentIds: ['s2'],
            revision: '1',
        },
    ],
    episodes: [
        {
            id: 'ep1',
            illness: 'Episodio',
            observations: [],
            medications: [],
            revision: '1',
        },
    ],
    appointments: [
        {
            id: 'ap1',
            date: '2026-10-10',
            time: '10:00',
            timeZone: 'America/Argentina/Buenos_Aires',
            professional: 'Dra. Gómez',
            notes: '',
            status: 'scheduled',
            cost: null,
            coverage: null,
            reminderMinutes: null,
            studyIds: ['s1', 's2'],
            revision: '1',
        },
        {
            id: 'ap2',
            date: '2026-10-11',
            time: '11:00',
            timeZone: 'America/Argentina/Buenos_Aires',
            professional: 'Dr. Pérez',
            notes: '',
            status: 'scheduled',
            cost: null,
            coverage: null,
            reminderMinutes: null,
            studyIds: ['s2'],
            revision: '1',
        },
    ],
};

describe('selectExportSnapshot', () => {
    it('returns the full snapshot unchanged when scope is all', () => {
        const result = selectExportSnapshot(snapshot, 'all', new Set(['s1']));
        expect(result).toBe(snapshot);
        expect(result.episodes).toHaveLength(1);
    });

    it('projects only selected studies and directly linked entities when scope is filtered', () => {
        const result = selectExportSnapshot(snapshot, 'filtered', new Set(['s1']));

        expect(result.studies.map(study => study.id)).toEqual(['s1']);
        expect(result.studies[0]?.documentIds).toEqual(['s1']);

        expect(result.operations.map(op => op.id)).toEqual(['op1']);
        expect(result.operations[0]?.studyIds).toEqual(['s1']);

        expect(result.portals.map(portal => portal.id)).toEqual(['p1']);

        expect(result.medicalEvents.map(event => event.id)).toEqual(['ev1']);
        expect(result.medicalEvents[0]?.studyIds).toEqual(['s1']);
        expect(result.medicalEvents[0]?.documentIds).toEqual(['s1']);

        expect(result.appointments.map(appointment => appointment.id)).toEqual(['ap1']);
        expect(result.appointments[0]?.studyIds).toEqual(['s1']);

        expect(result.episodes).toEqual([]);
    });

    it('returns empty collections when filtered selection has zero matches', () => {
        const result = selectExportSnapshot(snapshot, 'filtered', new Set());

        expect(result.studies).toEqual([]);
        expect(result.operations).toEqual([]);
        expect(result.portals).toEqual([]);
        expect(result.medicalEvents).toEqual([]);
        expect(result.appointments).toEqual([]);
        expect(result.episodes).toEqual([]);
    });
});
