/**
 * Store para estudios y directorios (operaciones, portales, eventos, etc.)
 */
import {signal, computed} from '@preact/signals';
import type {
    Study,
    StudyDraft,
    Operation,
    OperationDraft,
    Portal,
    PortalDraft,
    MedicalEvent,
    Episode,
    Appointment,
    ViewMode,
    Filters
} from '@domain/models';
import {filterStudiesByQuery, sortStudies, type StudySortOrder} from '@domain/library';
import {normalize} from '@domain/utils';
import {pendingChanges} from './outboxStore';

export interface IntakeCandidate {
    id: string;
    name: string;
    mimeType: string;
    modifiedTime: string;
    size: number;
    status: 'new' | 'imported' | 'discarded' | 'pending';
}

// ------------------------------------------------------------------
// Estado primitivo - Estudios
// ------------------------------------------------------------------

export const studies = signal<Study[]>([]);
export const operations = signal<Operation[]>([]);
export const portals = signal<Portal[]>([]);
export const medicalEvents = signal<MedicalEvent[]>([]);
export const episodes = signal<Episode[]>([]);
export const appointments = signal<Appointment[]>([]);

export const view = signal<ViewMode>('resumen');
export const sortOrder = signal<StudySortOrder>('date-desc');
export const categoryTypes = signal<string[]>([]);
export const libraryQuery = signal('');
export const libraryPortal = signal('');
export const libraryOperation = signal<{id: string; name: string} | null>(null);

// Track unavailable source identifiers (driveFileIds, viewer URLs, documentIds)
export const unavailableSources = signal<Set<string>>(new Set());

// Intake asistido (post-MVP)
export const approvedFolderId = signal<string | null>(null);
export const intakeCandidates = signal<IntakeCandidate[]>([]);
export const intakeLoading = signal(false);
export const intakeError = signal<string | null>(null);

// ------------------------------------------------------------------
// Derivados
// ------------------------------------------------------------------

export const visibleStudies = computed<Study[]>(() => {
    const result = [...studies.value];
    const selectedTypes = categoryTypes.value;
    for (const entry of pendingChanges.value) {
        if (entry.kind !== 'save' || !entry.draft || entry.id === undefined) continue;
        const draft = entry.draft;
        const index = result.findIndex((study) => study.id === draft.driveFileId);
        const previous = index >= 0 ? result[index] : undefined;
        const keepAttachment = !draft.removeReport && !entry.attachment;
        const local: Study = {
            id: previous?.id ?? `pending-${entry.id}`,
            title: draft.title, date: draft.date, types: draft.types, doctor: draft.doctor,
            portal: draft.portal, viewer: draft.viewer, reportName: draft.reportName,
            hasPdf: Boolean(keepAttachment && previous?.hasPdf),
            attachmentMime: keepAttachment ? previous?.attachmentMime : undefined,
            driveFileId: previous?.driveFileId ?? '',
            driveModifiedTime: previous?.driveModifiedTime ?? '', revision: draft.revision ?? '',
            operationId: draft.operationId, documentIds: draft.documentIds ?? previous?.documentIds,
            syncStatus: entry.status, pendingAttachment: Boolean(entry.attachment),
        };
        if (index >= 0) result[index] = local;
        else result.push(local);
    }
    // Filter by selected category types
    if (selectedTypes.length > 0) {
        return result.filter((study) => study.types.some((type) => selectedTypes.includes(type)));
    }
    return result;
});

export const libraryHasFilters = computed(() => Boolean(libraryQuery.value.trim() || libraryPortal.value || libraryOperation.value || categoryTypes.value.length));
export const filteredStudies = computed(() => {
    const items = visibleStudies.value.filter(study =>
        (!libraryPortal.value || normalize(study.portal) === normalize(libraryPortal.value)) &&
        (!libraryOperation.value || study.operationId === libraryOperation.value.id)
    );
    return sortStudies(filterStudiesByQuery(items, libraryQuery.value), sortOrder.value);
});

export function resetLibraryFilters(): void {
    libraryQuery.value = '';
    libraryPortal.value = '';
    libraryOperation.value = null;
    categoryTypes.value = [];
    sortOrder.value = 'date-desc';
}

export const visibleOperations = computed<Operation[]>(() => {
    const result = [...operations.value];
    for (const entry of pendingChanges.value) {
        if (entry.kind !== 'operation-save' || !entry.operationDraft || entry.id === undefined) continue;
        const draft = entry.operationDraft;
        const index = result.findIndex((operation) => operation.id === draft.id);
        const previous = index >= 0 ? result[index] : undefined;
        const local: Operation = {
            id: previous?.id ?? `pending-${entry.id}`, name: draft.name, studyIds: previous?.studyIds ?? [],
            color: draft.color ?? '', date: draft.date, surgeon: draft.surgeon, institution: draft.institution,
            type: draft.type, notes: draft.notes, revision: draft.revision, syncStatus: entry.status,
        };
        if (index >= 0) result[index] = local;
        else result.push(local);
    }
    return result;
});

export const visibleMedicalEvents = computed<MedicalEvent[]>(() => {
    const result = [...medicalEvents.value];
    for (const entry of pendingChanges.value) {
        if (entry.kind !== 'event-save' || !entry.eventDraft || entry.id === undefined) continue;
        const draft = entry.eventDraft;
        const index = result.findIndex((event) => event.id === draft.id);
        const local: MedicalEvent = {
            ...draft,
            id: draft.id ?? `pending-${entry.id}`,
            revision: draft.revision ?? '',
            syncStatus: entry.status
        };
        if (index >= 0) result[index] = local;
        else result.push(local);
    }
    return result;
});

export const visibleEpisodes = computed<Episode[]>(() => {
    const result = [...episodes.value];
    for (const entry of pendingChanges.value) {
        if (entry.kind === 'episode-delete' && entry.episodeId) {
            const index = result.findIndex((episode) => episode.id === entry.episodeId);
            const episode = result[index];
            if (episode) result[index] = {...episode, syncStatus: entry.status};
            continue;
        }
        if (entry.kind !== 'episode-save' || !entry.episodeDraft || entry.id === undefined) continue;
        const draft = entry.episodeDraft;
        const index = result.findIndex((episode) => episode.id === draft.id);
        const local: Episode = {
            id: draft.id ?? `pending-${entry.id}`,
            illness: draft.illness,
            observations: draft.observations ?? [],
            medications: draft.medications ?? [],
            closed: draft.closed === true,
            revision: draft.revision ?? '',
            syncStatus: entry.status,
        };
        if (index >= 0) result[index] = local;
        else result.push(local);
    }
    return result;
});

export const visibleAppointments = computed<Appointment[]>(() => {
    const result = [...appointments.value];
    for (const entry of pendingChanges.value) {
        if (entry.kind !== 'appointment-save' || !entry.appointmentDraft || entry.id === undefined) continue;
        const draft = entry.appointmentDraft;
        const index = result.findIndex(item => item.id === draft.id);
        const local: Appointment = {
            ...draft,
            id: draft.id ?? `pending-${entry.id}`,
            revision: draft.revision ?? '',
            syncStatus: entry.status
        };
        if (index >= 0) result[index] = local;
        else result.push(local);
    }
    return result;
});

// ------------------------------------------------------------------
// Acciones - Estudios
// ------------------------------------------------------------------

export function setStudies(list: Study[]): void {
    studies.value = list;
}

export function markSourceUnavailable(sourceId: string): void {
    const current = new Set(unavailableSources.value);
    current.add(sourceId);
    unavailableSources.value = current;
}

export function isSourceUnavailable(sourceId: string): boolean {
    return unavailableSources.value.has(sourceId);
}

export function setApprovedFolderId(id: string | null): void {
    approvedFolderId.value = id;
}

export function setIntakeCandidates(candidates: IntakeCandidate[]): void {
    intakeCandidates.value = candidates;
}

export function setIntakeLoading(v: boolean): void {
    intakeLoading.value = v;
}

export function setIntakeError(msg: string | null): void {
    intakeError.value = msg;
}

export function updateCandidateStatus(id: string, status: IntakeCandidate['status']): void {
    const current = intakeCandidates.value.map(c => c.id === id ? {...c, status} : c);
    intakeCandidates.value = current;
}

// ------------------------------------------------------------------
// Tipos re-exportados para comodidad de importación
// ------------------------------------------------------------------

export type {
    Study,
    StudyDraft,
    Operation,
    OperationDraft,
    Portal,
    PortalDraft,
    MedicalEvent,
    Episode,
    Appointment,
    ViewMode,
    Filters,
    StudySortOrder
};
