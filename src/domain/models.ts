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
  driveFileId: string;
  driveModifiedTime: string;
  /** Drive `version` seen when this study was loaded; used to detect concurrent edits. */
  revision: string;
  operationId?: string;
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

export type ViewMode = 'cronologia' | 'categoria' | 'portales' | 'operaciones';

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

export interface AnalysisResult {
  text: string[];
  scannedPages: number[];
  signaturePages: number[];
  suggested: Partial<StudyDraft>;
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
