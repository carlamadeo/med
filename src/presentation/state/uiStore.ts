/**
 * Store para estado de UI (modales, dialogs, loading, error, offline, etc.)
 */
import {signal} from '@preact/signals';
import type {Appointment, Study} from '@domain/models';

// ------------------------------------------------------------------
// Estado primitivo - UI
// ------------------------------------------------------------------

export const loading = signal(false);
export const studiesReady = signal(false);
export const studyLoadSkipped = signal(0);
export const directoriesReady = signal(false);
export const error = signal<string | null>(null);
export const editingStudy = signal<Study | null>(null);
export const isEditorOpen = signal(false);
export const deletingStudyId = signal<string | null>(null);

export const sharingStudyId = signal<string | null>(null);
export const sharingStudyIds = signal<string[]>([]);
export const shareSelection = signal<{
    includeAttachment: boolean;
    includeViewer: boolean;
    filename: string
} | null>(null);

export const exporting = signal(false);
export const exportError = signal<string | null>(null);

export const recoveringStudyId = signal<string | null>(null);
export const recoveryError = signal<string | null>(null);
type AppointmentEditor =
    | { mode: 'appointment'; appointment: Appointment | null }
    | { mode: 'consultation'; appointment: Appointment };

export const appointmentEditor = signal<AppointmentEditor | null>(null);
export const isFolderPickerOpen = signal(false);

export const offline = signal(!navigator.onLine);
export const directoryWarning = signal(false);
export const directoryFailures = signal<string[]>([]);

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
    sharingStudyIds.value = id ? [id] : [];
    if (!id) {
        shareSelection.value = null;
    }
}

export function setSharingStudyIds(ids: readonly string[]): void {
    const unique = [...new Set(ids.filter(Boolean))];
    sharingStudyIds.value = unique;
    sharingStudyId.value = unique[0] ?? null;
    if (unique.length !== 1) {
        shareSelection.value = null;
    }
}

export function setShareSelection(selection: {
    includeAttachment: boolean;
    includeViewer: boolean;
    filename: string
} | null): void {
    shareSelection.value = selection;
}

export function setOffline(v: boolean): void {
    offline.value = v;
}

export function setExporting(v: boolean): void {
    exporting.value = v;
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

export function setEditingAppointment(appointment: Appointment | null): void {
    appointmentEditor.value = {mode: 'appointment', appointment};
}

export function setEditingConsultation(appointment: Appointment): void {
    appointmentEditor.value = {mode: 'consultation', appointment};
}

export function closeAppointmentEditor(): void {
    appointmentEditor.value = null;
}

export function setFolderPickerOpen(open: boolean): void {
    isFolderPickerOpen.value = open;
}
