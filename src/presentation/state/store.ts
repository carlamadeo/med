/**
 * Estado reactivo de la aplicación usando @preact/signals.
 *
 * Toda la lectura/escritura de estado pasa por señales. Los componentes
 * consumen las señales con `useSignal()` (o `useComputed()`) para que se
 * vuelvan a renderizar automáticamente cuando cambian.
 */
import { signal, computed, type Signal } from '@preact/signals';
import type { Study, StudyDraft, Operation, OperationDraft, Portal, PortalDraft, ViewMode, Filters } from '@domain/models';
import type { OutboxEntry } from '@data/outbox';
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
export const loadSequence = { current: 0 };

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

export const hasFilters = computed(() => Boolean(
  categoryTypes.value.length ||
  filters.value.query ||
  filters.value.type ||
  filters.value.from ||
  filters.value.to ||
  filters.value.operationId ||
  filters.value.portal ||
  filters.value.onlyPdf ||
  filters.value.onlyViewer
));

export const invalidRange = computed(() =>
  Boolean(filters.value.from && filters.value.to && filters.value.from > filters.value.to)
);

// ------------------------------------------------------------------
// Acciones
// ------------------------------------------------------------------

export function setStudies(list: Study[]): void {
  studies.value = list;
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

export function setPendingChanges(list: OutboxEntry[]): void {
  pendingChanges.value = list;
}

export function setOffline(v: boolean): void {
  offline.value = v;
}

export function setDirectoryWarning(v: boolean): void {
  directoryWarning.value = v;
}

// ------------------------------------------------------------------
// Tipos re-exportados para comodidad de importación
// ------------------------------------------------------------------

export type { Study, StudyDraft, Operation, OperationDraft, Portal, PortalDraft, ViewMode, Filters };
