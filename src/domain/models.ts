export interface Study {
    id: string;
    title: string;
    date: string;
    types: string[];
    doctor: string;
    portal: string;
    viewer: string;
    reportName: string;
    hasPdf: boolean;
    attachmentMime?: 'image/jpeg' | 'image/png';
    driveFileId: string;
    driveModifiedTime: string;
    /** Drive `version` seen when this study was loaded; used to detect concurrent edits. */
    revision: string;
    operationId?: string;
    documentIds?: string[];
    syncStatus?: 'pending' | 'conflict' | 'failed';
    pendingAttachment?: boolean;
}

export interface StudyDraft {
    title: string;
    date: string;
    types: string[];
    doctor: string;
    portal: string;
    viewer: string;
    reportName: string;
    /** New PDF to attach (replaces the current one when editing). */
    file?: File;
    /** When editing without a new `file`, drop the PDF currently attached. */
    removeReport?: boolean;
    driveFileId?: string;
    /** Id reserved with `reserveId()` for a new study; reusing it on retry makes a repeated creation idempotent. */
    id?: string;
    /** Required when editing (`driveFileId` set): the `Study.revision` the form was opened with. */
    revision?: string;
    operationId?: string;
    documentIds?: string[];
}

export interface MedicalEvent {
    id: string;
    kind: 'consultation' | 'prescription';
    date: string;
    doctor: string;
    notes: string;
    studyIds: string[];
    documentIds: string[];
    revision: string;
    syncStatus?: 'pending' | 'conflict' | 'failed';
}

export interface MedicalEventDraft extends Omit<MedicalEvent, 'id' | 'revision' | 'syncStatus'> {
    id?: string;
    createId?: string;
    revision?: string;
}

export interface Operation {
    id: string;
    name: string;
    studyIds: string[];
    color: string;
    date?: string;
    surgeon?: string;
    institution?: string;
    type?: string;
    notes?: string;
    revision?: string;
    syncStatus?: 'pending' | 'conflict' | 'failed';
}

export interface OperationDraft {
    name: string;
    color?: string;
    id?: string;
    createId?: string;
    date?: string;
    surgeon?: string;
    institution?: string;
    type?: string;
    notes?: string;
    revision?: string;
}

export interface Portal {
    id?: string;
    name: string;
    displayName: string;
    url: string;
    notes?: string;
    revision?: string;
}

export interface PortalDraft {
    id?: string;
    createId?: string;
    name: string;
    displayName: string;
    url: string;
    notes?: string;
    revision?: string;
}

export type ViewMode =
    'resumen'
    | 'cronologia'
    | 'categoria'
    | 'portales'
    | 'operaciones'
    | 'eventos'
    | 'episodios'
    | 'turnos'
    | 'intake';

export interface Filters {
    query: string;
    type: string;
    from: string;
    to: string;
    operationId: string;
    portal: string;
    onlyPdf: boolean;
    onlyViewer: boolean;
}

export interface SymptomObservation {
    date: string;
    text: string;
    temperature?: number;
    symptoms: SymptomEntry[];
}

export interface SymptomEntry {
    name: string;
    intensity?: number;
    description?: string;
}

export interface Medication {
    name: string;
    frequency?: string;
    instructions?: string;
}

export interface Episode {
    id: string;
    illness: string;
    observations: SymptomObservation[];
    medications: Medication[];
    closed?: boolean;
    revision: string;
    syncStatus?: 'pending' | 'conflict' | 'failed';
}

export interface EpisodeDraft {
    illness: string;
    observations?: SymptomObservation[];
    medications?: Medication[];
    closed?: boolean;
    id?: string;
    createId?: string;
    revision?: string;
}

export interface AppointmentDraft {
    date: string;
    time: string;
    timeZone: string;
    professional: string;
    notes: string;
    status: 'scheduled' | 'completed' | 'cancelled' | 'absent';
    cost: number | null;
    coverage: 'all' | 'partial' | 'none' | null;
    reminderMinutes?: 15 | 60 | 1440 | null;
    id?: string;
    createId?: string;
    revision?: string;
}

export interface Appointment extends AppointmentDraft {
    id: string;
    revision: string;
    syncStatus?: 'pending' | 'conflict' | 'failed';
}

export interface DriveFile {
    id: string;
    name: string;
    mimeType: string;
    description?: string;
    modifiedTime: string;
    appProperties?: Record<string, string>;
    parents?: string[];
}
