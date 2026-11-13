/**
 * Estado reactivo de la aplicación usando @preact/signals.
 *
 * Toda la lectura/escritura de estado pasa por señales. Los componentes
 * consumen las señales con `useSignal()` (o `useComputed()`) para que se
 * vuelvan a renderizar automáticamente cuando cambian.
 */
import { signal, computed } from '@preact/signals';
import type { Study, StudyDraft, Operation, OperationDraft, Portal, PortalDraft, ViewMode, Filters } from '@domain/models';
import type { OutboxEntry } from '@data/outbox';
import { filterStudies, type StudySortOrder } from '@domain/library';

// ------------------------------------------------------------------
// Estado primitivo
// ------------------------------------------------------------------

export const studies = signal<Study[]>([]);
export const operations = signal<Operation[]>([]);
export const portals = signal<Portal[]>([]);

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

export const pendingChanges = signal<OutboxEntry[]>([]);
export const syncMessage = signal('');
export const syncing = signal(false);
export const offline = signal(!navigator.onLine);
export const directoryWarning = signal(false);

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
      operationId: draft.operationId, syncStatus: entry.status, pendingAttachment: Boolean(entry.attachment),
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

export function setOffline(v: boolean): void {
  offline.value = v;
}

// ------------------------------------------------------------------
// Tipos re-exportados para comodidad de importación
// ------------------------------------------------------------------

export type { Study, StudyDraft, Operation, OperationDraft, Portal, PortalDraft, ViewMode, Filters };
