/**
 * Store para estado de UI (modales, dialogs, loading, error, offline, etc.)
 */
import { signal } from '@preact/signals';
import type { Study } from '@domain/models';

// ------------------------------------------------------------------
// Estado primitivo - UI
// ------------------------------------------------------------------

export const loading = signal(false);
export const error = signal<string | null>(null);
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

export const offline = signal(!navigator.onLine);
export const directoryWarning = signal(false);

// ------------------------------------------------------------------
// Acciones - UI
// ------------------------------------------------------------------

export function setLoading(v: boolean): void {
  loading.value = v;
}

export function setError(msg: string | null): void {
  error.value = msg;
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