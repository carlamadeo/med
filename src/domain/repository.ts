import type { Study, StudyDraft, Operation, OperationDraft, Portal, PortalDraft, DriveFile, MedicalEvent, MedicalEventDraft } from './models';

export type { Study, StudyDraft, Operation, OperationDraft, Portal, PortalDraft, DriveFile };

export interface MedicalEventRepository {
  list(): Promise<MedicalEvent[]>;
  save(draft: MedicalEventDraft): Promise<MedicalEvent>;
}

export interface StudyRepository {
  /** Served from the local cache while fresh; `force` always asks Drive. */
  list(options?: { force?: boolean }): Promise<Study[]>;
  get(id: string): Promise<Study>;
  /** Reserves the id of a study before it is created, so a retried save cannot duplicate it. */
  reserveId(): Promise<string>;
  /** Rejects with a conflict error when `draft.revision` is not Drive's current one. */
  save(draft: StudyDraft): Promise<Study>;
  /** Rejects with a conflict error when `revision` is not Drive's current one. */
  delete(id: string, revision: string): Promise<void>;
  getPdfFile(fileId: string): Promise<File>;
  watchChanges?(): AsyncIterable<StudyChange>;
}

export interface OperationRepository {
  list(): Promise<Operation[]>;
  get(id: string): Promise<Operation>;
  save(draft: OperationDraft): Promise<Operation>;
  delete(id: string): Promise<void>;
}

export interface PortalRepository {
  list(): Promise<Portal[]>;
  get(name: string): Promise<Portal | undefined>;
  save(draft: PortalDraft): Promise<Portal>;
  delete(name: string): Promise<void>;
}

export interface AuthRepository {
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  getAccessToken(): Promise<string>;
  isSignedIn(): boolean;
  onAuthChange(callback: (signedIn: boolean) => void): () => void;
}

export type StudyChange =
  | { type: 'added'; study: Study }
  | { type: 'updated'; study: Study }
  | { type: 'deleted'; id: string };

export interface DriveFileMetadata {
  id: string;
  title: string;
  date: string;
  types: string[];
  /** Legacy single-type field written by older versions; read-only, never written back. */
  type?: string;
  doctor: string;
  portal: string;
  viewer: string;
  reportName: string;
  operationId?: string;
  documentIds?: string[];
}
