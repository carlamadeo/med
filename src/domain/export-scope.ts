import type {
    Appointment,
    Episode,
    MedicalEvent,
    Operation,
    Portal,
    Study,
} from './models';
import {normalize} from './utils';

export type ExportScope = 'all' | 'filtered';

export interface ExportSnapshot {
    studies: Study[];
    operations: Operation[];
    portals: Portal[];
    medicalEvents: MedicalEvent[];
    episodes: Episode[];
    appointments: Appointment[];
}

/**
 * Projects a full archive snapshot onto the selected export scope.
 * Full exports preserve every record; filtered exports keep only the selected
 * studies and entities directly linked to them (excluding episodes).
 */
export function selectExportSnapshot(
    snapshot: ExportSnapshot,
    scope: ExportScope,
    selectedStudyIds: ReadonlySet<string>,
): ExportSnapshot {
    if (scope === 'all') {
        return snapshot;
    }

    const selectedStudies = snapshot.studies.filter(study => selectedStudyIds.has(study.id));
    const attachmentIds = new Set(
        selectedStudies.filter(study => study.hasPdf || study.attachmentMime).map(study => study.id),
    );
    const operationIds = new Set(selectedStudies.map(study => study.operationId).filter(Boolean));
    const institutions = new Set(selectedStudies.map(study => normalize(study.portal)).filter(Boolean));

    const restrictStudies = (values: string[] | undefined) =>
        values?.filter(id => selectedStudyIds.has(id));
    const restrictDocuments = (values: string[] | undefined) =>
        values?.filter(id => attachmentIds.has(id));

    return {
        studies: selectedStudies.map(study => ({
            ...study,
            documentIds: restrictDocuments(study.documentIds),
        })),
        operations: snapshot.operations
            .filter(operation => operationIds.has(operation.id))
            .map(operation => ({
                ...operation,
                studyIds: selectedStudies
                    .filter(study => study.operationId === operation.id)
                    .map(study => study.id),
            })),
        portals: snapshot.portals.filter(portal => institutions.has(normalize(portal.name))),
        medicalEvents: snapshot.medicalEvents
            .filter(
                event =>
                    event.studyIds.some(id => selectedStudyIds.has(id)) ||
                    event.documentIds.some(id => attachmentIds.has(id)),
            )
            .map(event => ({
                ...event,
                studyIds: restrictStudies(event.studyIds) ?? [],
                documentIds: restrictDocuments(event.documentIds) ?? [],
            })),
        episodes: [],
        appointments: snapshot.appointments
            .filter(appointment => appointment.studyIds?.some(id => selectedStudyIds.has(id)))
            .map(appointment => ({
                ...appointment,
                studyIds: restrictStudies(appointment.studyIds),
            })),
    };
}
