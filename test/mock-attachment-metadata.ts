import {vi} from 'vitest';
import {driveClient} from '@data';
import {studies} from '@presentation/state/store';

export function mockAttachmentMetadata() {
    return vi.spyOn(driveClient, 'request').mockImplementation(async (url) => {
        const id = new URL(url).pathname.split('/').pop();
        const study = studies.peek().find(item => item.driveFileId === id);
        if (!study) throw new Error('Missing attachment fixture');
        return Response.json({
            id, version: study.revision, trashed: false,
            mimeType: study.attachmentMime ?? 'application/pdf',
            appProperties: {misEstudios: 'estudio-v1'},
        });
    });
}
