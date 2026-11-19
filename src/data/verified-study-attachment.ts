import {CONFIG} from '@core/config';
import type {Study} from '@domain/models';
import {driveClient, driveStudyRepo} from './index';
import {DriveConflictError, type DriveFileResponse} from './drive-api';
import {validateDocument} from './pdf-analysis';

export class StudyAttachmentFormatError extends Error {
    constructor() {
        super('El archivo de Drive no coincide con el formato del informe.');
    }
}

/** Verify that the media belongs to the study revision the user chose. */
export async function readVerifiedStudyAttachment(study: Study, token: string): Promise<File> {
    const fileId = study.driveFileId;
    const mime = study.attachmentMime ?? 'application/pdf';
    const url = driveClient.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(fileId)}`, {
        fields: 'id,version,mimeType,trashed,appProperties',
    });
    const confirmRevision = async () => {
        const response = await driveClient.request(url, {}, token);
        const file = await response.json() as DriveFileResponse;
        if (!study.revision || file.id !== fileId || file.trashed || file.version !== study.revision ||
            file.mimeType !== mime || file.appProperties?.misEstudios !== CONFIG.DRIVE_APP_PROPERTIES.STUDY) {
            throw new DriveConflictError();
        }
    };

    await confirmRevision();
    const file = await driveStudyRepo.getDocumentFile(fileId, token);
    await confirmRevision();
    // Check the header independently of the HTTP MIME. The upload size limit does not apply to historical reads.
    const signature = await validateDocument(file.slice(0, 8)).catch(() => null);
    if (file.type !== mime || signature !== mime) throw new StudyAttachmentFormatError();
    return file;
}
