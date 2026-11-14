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
import {filterStudies, type StudySortOrder} from '@domain/library';
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
export const filters = signal<Filters>({
    query: '',
    type: '',
    from: '',
    to: '',
    operationId: '',
    portal: '',
    onlyPdf: false,
    onlyViewer: false,
});

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
    for (const entry of pendingChanges.value) {
        if (entry.kind !== 'save' || !entry.draft || entry.id === undefined) continue;
        const draft = entry.draft;
        const index = result.findIndex((study) => study.id === draft.driveFileId);
        const previous = index >= 0 ? result[index] : undefined;
        const local: Study = {
            id: previous?.id ?? `pending-${entry.id}`,
            title: draft.title, date: draft.date, types: draft.types, doctor: draft.doctor,
            portal: draft.portal, viewer: draft.viewer, reportName: draft.reportName,
            hasPdf: Boolean(previous?.hasPdf && !draft.removeReport && !entry.attachment),
            driveFileId: previous?.driveFileId ?? '',
            driveModifiedTime: previous?.driveModifiedTime ?? '', revision: draft.revision ?? '',
            operationId: draft.operationId, documentIds: draft.documentIds ?? previous?.documentIds,
            syncStatus: entry.status, pendingAttachment: Boolean(entry.attachment),
        };
        if (index >= 0) result[index] = local;
        else result.push(local);
    }
    return result;
});

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

const listResult = computed(() =>
    filterStudies(visibleStudies.value, filters.value, categoryTypes.value, sortOrder.value),
);
export const filteredStudies = computed(() => listResult.value.matches);
export const hasFilters = computed(() => listResult.value.filtered);
export const invalidRange = computed(() => listResult.value.invalidRange);

// ------------------------------------------------------------------
// Acciones - Estudios
// ------------------------------------------------------------------

export function setStudies(list: Study[]): void {
    studies.value = list;
}

export function clearFilters(): void {
    categoryTypes.value = [];
    filters.value = {
        query: '',
        type: '',
        from: '',
        to: '',
        operationId: '',
        portal: '',
        onlyPdf: false,
        onlyViewer: false
    };
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
    Filters
};