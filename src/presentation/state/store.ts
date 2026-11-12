/**
 * Estado reactivo de la aplicación usando @preact/signals.
 *
 * Toda la lectura/escritura de estado pasa por señales. Los componentes
 * consumen las señales con `useSignal()` (o `useComputed()`) para que se
 * vuelvan a renderizar automáticamente cuando cambian.
 */
import { signal, computed, type Signal } from '@preact/signals';
import type { Study, StudyDraft, Operation, OperationDraft, Portal, PortalDraft, ViewMode, Filters } from '@domain/models';
import { normalize } from '@domain/utils';
import { compareStudies } from '@domain/library';

// ------------------------------------------------------------------
// Estado primitivo
// ------------------------------------------------------------------

export const studies = signal<Study[]>([]);
export const operations = signal<Operation[]>([]);
export const portals = signal<Portal[]>([]);

export const view = signal<ViewMode>('cronologia');
export const sortOrder = signal<'date-desc' | 'date-asc' | 'title' | 'type'>('date-desc');
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
export const analysisLoading = signal(false);
export const analysisProgress = signal({ page: 0, total: 0 });
export const error = signal<string | null>(null);
export const isSignedIn = signal(false);
export const editingStudy = signal<Study | null>(null);
export const isEditorOpen = signal(false);
export const deletingStudyId = signal<string | null>(null);
export const toasts = signal<{ id: string; message: string; type: 'info' | 'success' | 'error' }[]>([]);

// ------------------------------------------------------------------
// Derivados
// ------------------------------------------------------------------

export const filteredStudies: Signal<Study[]> = computed(() => {
  const { query, type, from, to, operationId, portal, onlyPdf, onlyViewer } = filters.value;

  if (from && to && from > to) return [];
  return studies.value.filter((s) => {
    if (query && ![s.title, s.doctor, s.portal, ...s.types].some((value) => normalize(value).includes(normalize(query)))) {
      return false;
    }
    if (type && !s.types.some((t) => normalize(t) === normalize(type))) {
      return false;
    }
    if (categoryTypes.value.length && !s.types.some((t) => categoryTypes.value.some((selected) => normalize(t) === normalize(selected)))) return false;
    if (from && s.date < from) return false;
    if (to && s.date > to) return false;
    if (operationId && s.operationId !== operationId) return false;
    if (portal && normalize(s.portal) !== normalize(portal)) return false;
    if (onlyPdf && !s.hasPdf) return false;
    if (onlyViewer && !s.viewer) return false;
    return true;
  }).sort((a, b) => {
    if (sortOrder.value === 'date-asc') return a.date.localeCompare(b.date) || compareStudies(a, b);
    if (sortOrder.value === 'title') return a.title.localeCompare(b.title, 'es') || compareStudies(a, b);
    if (sortOrder.value === 'type') return (a.types[0] ?? '').localeCompare(b.types[0] ?? '', 'es') || compareStudies(a, b);
    return compareStudies(a, b);
  });
});

// ------------------------------------------------------------------
// Acciones
// ------------------------------------------------------------------

export function setStudies(list: Study[]): void {
  studies.value = list;
}

export function addStudy(study: Study): void {
  studies.value = [study, ...studies.value];
}

export function updateStudy(updated: Study): void {
  studies.value = studies.value.map((s) => (s.id === updated.id ? updated : s));
}

export function deleteStudy(id: string): void {
  studies.value = studies.value.filter((s) => s.id !== id);
}

export function setOperations(list: Operation[]): void {
  operations.value = list;
}

export function setPortals(list: Portal[]): void {
  portals.value = list;
}

export function setView(v: ViewMode): void {
  view.value = v;
}

export function setFilters(partial: Partial<Filters>): void {
  filters.value = { ...filters.value, ...partial };
}

export function clearFilters(): void {
  categoryTypes.value = [];
  filters.value = { query: '', type: '', from: '', to: '', operationId: '', portal: '', onlyPdf: false, onlyViewer: false };
}

export function setLoading(v: boolean): void {
  loading.value = v;
}

export function setAnalysisLoading(v: boolean): void {
  analysisLoading.value = v;
}

export function setAnalysisProgress(page: number, total: number): void {
  analysisProgress.value = { page, total };
}

export function setError(msg: string | null): void {
  error.value = msg;
}

export function setIsSignedIn(v: boolean): void {
  isSignedIn.value = v;
}

export function setEditingStudy(study: Study | null): void {
  editingStudy.value = study;
  isEditorOpen.value = study !== null || study === null; // Open for both edit (study) and new (null)
}

export function setEditorOpen(v: boolean): void {
  isEditorOpen.value = v;
  if (!v) editingStudy.value = null;
}

export function setDeletingStudyId(id: string | null): void {
  deletingStudyId.value = id;
}

export function addToast(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
  const id = crypto.randomUUID();
  toasts.value = [...toasts.value, { id, message, type }];
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, 4000);
}

export function removeToast(id: string): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

// ------------------------------------------------------------------
// Tipos re-exportados para comodidad de importación
// ------------------------------------------------------------------

export type { Study, StudyDraft, Operation, OperationDraft, Portal, PortalDraft, ViewMode, Filters };
