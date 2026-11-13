/**
 * Estado reactivo de la aplicación usando @preact/signals.
 *
 * Toda la lectura/escritura de estado pasa por señales. Los componentes
 * consumen las señales con `useSignal()` (o `useComputed()`) para que se
 * vuelvan a renderizar automáticamente cuando cambian.
 */
import { signal, computed } from '@preact/signals';
import type { Study, StudyDraft, Operation, OperationDraft, Portal, PortalDraft, MedicalEvent, ViewMode, Filters } from '@domain/models';
import type { OutboxEntry } from '@data/outbox';
import { filterStudies, type StudySortOrder } from '@domain/library';

// ------------------------------------------------------------------
// Estado primitivo
// ------------------------------------------------------------------

export const studies = signal<Study[]>([]);
export const operations = signal<Operation[]>([]);
export const portals = signal<Portal[]>([]);
export const medicalEvents = signal<MedicalEvent[]>([]);

export const view = signal<ViewMode>('cronologia');
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

export const loading = signal(false);
export const error = signal<string | null>(null);
export const isSignedIn = signal(false);
export const editingStudy = signal<Study | null>(null);
export const isEditorOpen = signal(false);
export const deletingStudyId = signal<string | null>(null);

export const sharingStudyId = signal<string | null>(null);
export const shareSelection = signal<{ includePdf: boolean; includeViewer: boolean; filename: string } | null>(null);

export const exporting = signal(false);
export const exportScope = signal<'all' | 'filtered'>('all');
export const exportError = signal<string | null>(null);

export const recoveringStudyId = signal<string | null>(null);
export const recoveryError = signal<string | null>(null);

export const pendingChanges = signal<OutboxEntry[]>([]);
export const syncMessage = signal('');
export const syncing = signal(false);
export const offline = signal(!navigator.onLine);
export const directoryWarning = signal(false);

// Track unavailable source identifiers (driveFileIds, viewer URLs, documentIds)
export const unavailableSources = signal<Set<string>>(new Set());

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
    const local: MedicalEvent = { ...draft, id: draft.id ?? `pending-${entry.id}`, revision: draft.revision ?? '', syncStatus: entry.status };
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
// Acciones
// ------------------------------------------------------------------

export function setStudies(list: Study[]): void {
  studies.value = list;
}

export function clearFilters(): void {
  categoryTypes.value = [];
  filters.value = { query: '', type: '', from: '', to: '', operationId: '', portal: '', onlyPdf: false, onlyViewer: false };
}

export function setLoading(v: boolean): void {
  loading.value = v;
}

export function setError(msg: string | null): void {
  error.value = msg;
}

export function setIsSignedIn(v: boolean): void {
  isSignedIn.value = v;
}

export function setEditingStudy(study: Study | null): void {
  editingStudy.value = study;
  isEditorOpen.value = true; // Open for both edit (study) and new (null)
}

export function setEditorOpen(v: boolean): void {
  isEditorOpen.value = v;
  if (!v) editingStudy.value = null;
}

export function setDeletingStudyId(id: string | null): void {
  deletingStudyId.value = id;
}

export function setSharingStudyId(id: string | null): void {
  sharingStudyId.value = id;
  if (!id) {
    shareSelection.value = null;
  }
}

export function setShareSelection(selection: { includePdf: boolean; includeViewer: boolean; filename: string } | null): void {
  shareSelection.value = selection;
}

export function setOffline(v: boolean): void {
  offline.value = v;
}

export function markSourceUnavailable(sourceId: string): void {
  const current = new Set(unavailableSources.value);
  current.add(sourceId);
  unavailableSources.value = current;
}

export function markSourceAvailable(sourceId: string): void {
  const current = new Set(unavailableSources.value);
  current.delete(sourceId);
  unavailableSources.value = current;
}

export function isSourceUnavailable(sourceId: string): boolean {
  return unavailableSources.value.has(sourceId);
}

export function setExporting(v: boolean): void {
  exporting.value = v;
}

export function setExportScope(scope: 'all' | 'filtered'): void {
  exportScope.value = scope;
}

export function setExportError(msg: string | null): void {
  exportError.value = msg;
}

export function setRecoveringStudyId(id: string | null): void {
  recoveringStudyId.value = id;
  if (!id) {
    recoveryError.value = null;
  }
}

export function setRecoveryError(msg: string | null): void {
  recoveryError.value = msg;
}

// ------------------------------------------------------------------
// Tipos re-exportados para comodidad de importación
// ------------------------------------------------------------------

export type { Study, StudyDraft, Operation, OperationDraft, Portal, PortalDraft, ViewMode, Filters };
