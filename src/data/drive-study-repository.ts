import { isRecoverable } from './recovery-window';
import { DriveConflictError, type DriveClient, type DriveFileResponse } from './drive-api';
import { storage, type StudyRecord } from '@core/storage';
import { documentAssociationIds } from '@domain/document-compatibility';
import { validateStudyDraft } from '@domain/validation/study';
import type { Study, StudyDraft, StudyRepository, DriveFileMetadata } from '@domain/repository';
import { validateDocument } from './pdf-analysis';
import { listMedicalEvents } from './drive-medical-event-list';

export class DriveStudyRepository implements StudyRepository {
  constructor(private client: DriveClient) {}

  private async cacheOwner(): Promise<string> {
    return this.client.cacheOwner();
  }

  private studyToRecord(study: Study): StudyRecord {
    return {
      id: study.id,
      title: study.title,
      date: study.date,
      types: study.types,
      doctor: study.doctor,
      portal: study.portal,
      viewer: study.viewer,
      reportName: study.reportName,
      hasPdf: study.hasPdf,
      attachmentMime: study.attachmentMime,
      driveFileId: study.driveFileId,
      driveModifiedTime: study.driveModifiedTime,
      revision: study.revision,
      operationId: study.operationId,
      documentIds: study.documentIds,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private recordToStudy(record: StudyRecord): Study {
    return {
      id: record.id,
      title: record.title,
      date: record.date,
      types: record.types,
      doctor: record.doctor,
      portal: record.portal,
      viewer: record.viewer,
      reportName: record.reportName,
      hasPdf: record.hasPdf,
      attachmentMime: record.attachmentMime,
      driveFileId: record.driveFileId,
      driveModifiedTime: record.driveModifiedTime,
      revision: record.revision,
      operationId: record.operationId,
      documentIds: documentAssociationIds(record.documentIds, record.id),
    };
  }

  async list(options: { force?: boolean } = {}): Promise<Study[]> {
    const token = await this.client.getAccessToken();
    const owner = await this.cacheOwner();
    if (!options.force || !navigator.onLine) {
      const cached = await storage.readCompleteSessionStudies(owner);
      if (cached && (!navigator.onLine || Date.now() - cached.lastSync <= 24 * 60 * 60 * 1000)) {
        await this.client.assertSession(token);
        return cached.records.map(this.recordToStudy);
      }
    }

    const records = (await this.client.listFiles('estudio-v1', ENTRY_FIELDS, token)).map((file) => this.client.parseRecord(file));

    await this.client.assertSession(token);
    await storage.writeSessionStudies(owner, records.map(this.studyToRecord), true);
    await this.client.assertSession(token);
    return records;
  }

  private async fetchFile(id: string): Promise<Study> {
    const response = await this.client
      .request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS }))
      .then((r) => r.json() as Promise<DriveFileResponse>);
    return this.client.parseRecord(response);
  }

  async get(id: string): Promise<Study> {
    const owner = await this.cacheOwner();
    const cached = (await storage.readSessionStudies(owner))?.find((record) => record.id === id);
    if (cached) return this.recordToStudy(cached);
    return this.fetchFile(id);
  }

  async reserveId(): Promise<string> {
    return this.client.reserveId();
  }

  private async checkDocumentDependencies(existingId: string): Promise<void> {
    const events = await listMedicalEvents(this.client);
    if (events.some((event) => event.documentIds.includes(existingId))) throw new Error('Desvinculá el documento de los eventos antes de reemplazarlo o quitarlo.');
    const linkedStudies = await this.list({ force: true });
    if (linkedStudies.some((study) => study.id !== existingId && study.documentIds?.includes(existingId))) {
      throw new Error('Desvinculá el documento de los otros estudios antes de reemplazarlo o quitarlo.');
    }
  }

  async save(draft: StudyDraft): Promise<Study> {
    const validationErrors = validateStudyDraft(draft);
    if (validationErrors.length) throw new Error(validationErrors[0]);
    const token = await this.client.getAccessToken();
    const owner = await this.cacheOwner();
    const isUpdate = Boolean(draft.driveFileId);
    // On edit we must start from what Drive has now, not from what the form remembers.
    const existing = draft.driveFileId ? await this.fetchFile(draft.driveFileId) : null;
    if (existing && existing.revision !== draft.revision) throw new DriveConflictError();
    if ((existing?.hasPdf || existing?.attachmentMime) && (draft.file || draft.removeReport)) {
      await this.checkDocumentDependencies(existing.id);
    }
    const id = existing?.id ?? draft.id ?? (await this.client.reserveId());
    const documentIds = documentAssociationIds(draft.documentIds ?? existing?.documentIds, id);
    if (documentIds.length) {
      const available = await this.list({ force: true });
      if (documentIds.some((documentId) => !available.some((study) => study.id === documentId && (study.hasPdf || study.attachmentMime)))) {
        throw new Error('Un documento vinculado ya no está disponible en esta cuenta.');
      }
    }

    const keepDocument = Boolean(existing?.hasPdf || existing?.attachmentMime) && !draft.file && !draft.removeReport;
    const newMime = draft.file?.type.startsWith('image/') ? await validateDocument(draft.file) : draft.file ? 'application/pdf' : undefined;
    if (draft.file?.type.startsWith('image/') && newMime === 'application/pdf') throw new Error('Elegí una imagen JPEG o PNG válida.');
    const documentMime = newMime ?? (keepDocument ? existing?.attachmentMime ?? 'application/pdf' : undefined);
    const reportName = draft.file?.name ?? (keepDocument ? (existing?.reportName ?? '') : '');

    const payload: DriveFileMetadata = {
      id,
      title: draft.title,
      date: draft.date,
      types: draft.types,
      doctor: draft.doctor,
      portal: draft.portal,
      viewer: draft.viewer,
      reportName,
      operationId: draft.operationId ?? existing?.operationId ?? '',
      documentIds,
    };
    const description = JSON.stringify(payload);
    const extension = documentMime === 'image/jpeg' ? '.jpg' : documentMime === 'image/png' ? '.png' : documentMime === 'application/pdf' ? '.pdf' : '.json';
    const fileName = `${draft.date} ${draft.title}`.replace(/[\\/]/g, '-') + extension;

    let response: DriveFileResponse;
    // Same rule as the original: no new file and no PDF to drop means only the ficha changes.
    if (existing && !draft.file && !(draft.removeReport && (existing.hasPdf || existing.attachmentMime))) {
      // Leave the stored file (and its mimeType) untouched.
      await this.client.assertSession(token);
      response = await this.client
        .request(
          this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS }),
          this.client.jsonBody('PATCH', { name: fileName, description }), token
        )
        .then((r) => r.json() as Promise<DriveFileResponse>);
    } else {
      const media = draft.file ?? new Blob([description], { type: 'application/json' });
      const mediaType = draft.file ? documentMime! : 'application/json';
      const metadata: Record<string, unknown> = { name: fileName, description, mimeType: mediaType };
      if (!isUpdate) {
        metadata.id = id;
        metadata.parents = [await this.client.getFolderId()];
        metadata.appProperties = { misEstudios: 'estudio-v1' };
      }
      await this.client.assertSession(token);
      const path = isUpdate ? `files/${encodeURIComponent(id)}` : 'files';
      try {
        response = await this.client.upload(path, isUpdate ? 'PATCH' : 'POST', metadata, media, mediaType, undefined, token);
      } catch (error: unknown) {
        // A retried create may have already landed: accept it only if it is identical.
        if (isUpdate || (error as { status?: number }).status !== 409) throw error;
        response = await this.client
          .request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS }), {}, token)
          .then((r) => r.json() as Promise<DriveFileResponse>);
        if (response.description !== description) {
          throw new Error('La carga anterior ya se guardó. Actualizá la lista para revisarla.');
        }
        if (draft.file) {
          if (response.mimeType !== documentMime) throw new Error('La carga anterior es diferente. Actualizá la lista para revisarla.');
          const remoteFile = await this.getDocumentFile(id);
          const [localDigest, remoteDigest] = await Promise.all([
            draft.file.arrayBuffer().then((bytes) => crypto.subtle.digest('SHA-256', bytes)),
            remoteFile.arrayBuffer().then((bytes) => crypto.subtle.digest('SHA-256', bytes)),
          ]);
          if (!new Uint8Array(localDigest).every((byte, index) => byte === new Uint8Array(remoteDigest)[index])) {
            throw new Error('La carga anterior es diferente. Actualizá la lista para revisarla.');
          }
          await this.client.assertSession(token);
        }
      }
    }

    await this.client.assertSession(token);
    const saved = this.client.parseRecord(response);
    await storage.writeSessionStudies(owner, [this.studyToRecord(saved)]);
    return saved;
  }

  async delete(id: string, revision: string): Promise<void> {
    const token = await this.client.getAccessToken();
    const owner = await this.cacheOwner();
    if (await this.client.isAlreadyTrashed(id, 'estudio-v1')) {
      await this.client.assertSession(token);
      await storage.deleteSessionStudy(owner, id);
      return;
    }
    const existingFile = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS }), {}, token).then(r => r.json() as Promise<DriveFileResponse>);
    if (this.client.parseRecord(existingFile).revision !== revision) throw new DriveConflictError();
    const events = await listMedicalEvents(this.client);
    if (events.some((event) => event.studyIds.includes(id) || event.documentIds.includes(id))) {
      throw new Error('Desvinculá el estudio y su documento de los eventos antes de eliminarlo.');
    }
    const linkedStudies = await this.list({ force: true });
    if (linkedStudies.some((study) => study.id !== id && study.documentIds?.includes(id))) {
      throw new Error('Desvinculá el documento de los otros estudios antes de eliminarlo.');
    }
    await this.client.assertSession(token);
    await this.client.request(
      this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: 'id' }),
      this.client.jsonBody('PATCH', { trashed: true, appProperties: { ...existingFile.appProperties, misEstudios: 'estudio-v1', deletedAt: new Date().toISOString() } }), token
    );
    await storage.deleteSessionStudy(owner, id);
  }

  async listDeleted(): Promise<Array<{ id: string; title: string; date: string; deletedAt: string; revision: string; recoverable: boolean }>> {
    const token = await this.client.getAccessToken();
    const owner = await this.cacheOwner();
    const result: Array<{ id: string; title: string; date: string; deletedAt: string; revision: string; recoverable: boolean }> = [];
    if (!navigator.onLine) {
      const cached = await storage.readSessionDirectory<typeof result[number]>(owner, 'deletedStudiesCache');
      if (!cached) throw new Error('Conectate para consultar los estudios eliminados antes de recuperarlos sin conexión.');
      return cached.map(item => {
        return { ...item, recoverable: isRecoverable(item.deletedAt) };
      });
    }
    let pageToken = '';
    do {
      const response = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', 'files', {
        q: `trashed = true and appProperties has { key='misEstudios' and value='estudio-v1' }`,
        fields: `nextPageToken,files(${ENTRY_FIELDS})`, pageSize: '100',
        ...(pageToken ? { pageToken } : {}),
      }), {}, token).then(r => r.json() as Promise<DriveFileResponse>);
      for (const file of response.files ?? []) {
        if (!file.trashed || file.appProperties?.misEstudios !== 'estudio-v1') continue;
        const study = this.client.parseRecord({ ...file, trashed: false });
        const deletedAt = file.appProperties.deletedAt ?? '';
        result.push({ id: study.id, title: study.title, date: study.date, revision: study.revision, deletedAt, recoverable: isRecoverable(deletedAt) });
      }
      pageToken = response.nextPageToken ?? '';
    } while (pageToken);
    await this.client.assertSession(token);
    await storage.writeSessionDirectory(owner, 'deletedStudiesCache', result);
    return result;
  }

  async restore(id: string, revision: string): Promise<Study> {
    const ID_PATTERN = /^[\w-]+$/;
    if (!ID_PATTERN.test(id) || !revision) throw new Error('La ficha no tiene una revisión válida.');
    const token = await this.client.getAccessToken();
    const owner = await this.cacheOwner();
    const file = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS }), {}, token).then(r => r.json() as Promise<DriveFileResponse>);
    if (file.appProperties?.misEstudios !== 'estudio-v1') throw new DriveConflictError();
    if (!file.trashed && file.appProperties.restoredRevision === revision) {
      await this.client.assertSession(token);
      return this.client.parseRecord(file);
    }
    if (!file.trashed || file.version !== revision) throw new DriveConflictError();
    if (!isRecoverable(file.appProperties.deletedAt ?? '')) throw new Error('Este estudio ya no está disponible para recuperación desde la aplicación.');
    await this.client.assertSession(token);
    const restored = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(id)}`, { fields: ENTRY_FIELDS }), this.client.jsonBody('PATCH', { trashed: false, appProperties: { ...file.appProperties, deletedAt: undefined, restoredRevision: revision } }), token).then(r => r.json() as Promise<DriveFileResponse>);
    await this.client.assertSession(token);
    const study = this.client.parseRecord(restored);
    await storage.writeSessionStudies(owner, [this.studyToRecord(study)]);
    await storage.updateSessionDirectory<{ id: string }>(owner, 'deletedStudiesCache', (cached) => cached ? cached.filter(item => item.id !== id) : null);
    return study;
  }

  async getPdfFile(fileId: string): Promise<File> {
    const response = await this.client.request(
      this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(fileId)}`, { alt: 'media' })
    );
    const blob = await response.blob();
    return new File([blob], 'informe.pdf', { type: 'application/pdf' });
  }

  async getDocumentFile(fileId: string): Promise<File> {
    const response = await this.client.request(this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(fileId)}`, { alt: 'media' }));
    const blob = await response.blob();
    const type = blob.type.split(';')[0] ?? '';
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(type)) throw new Error('El archivo de Drive tiene un formato no compatible.');
    return new File([blob], type === 'image/png' ? 'informe.png' : type === 'image/jpeg' ? 'informe.jpg' : 'informe.pdf', { type });
  }
}

const ENTRY_FIELDS = 'id,description,version,modifiedTime,mimeType,trashed,appProperties';
