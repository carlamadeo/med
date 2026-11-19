import {http, HttpResponse} from 'msw';
import {beforeEach, expect, it} from 'vitest';
import {driveAuth, driveStudyRepo, DriveConflictError} from '@data';
import {readVerifiedStudyAttachment, StudyAttachmentFormatError} from '@data/verified-study-attachment';
import {fakeDriveFile, SEED_PDF_ID, touchRemote} from './fake-drive';
import {server} from './server';

const pdfBytes = '%PDF-prueba';
const endpoint = `https://www.googleapis.com/drive/v3/files/${SEED_PDF_ID}`;

beforeEach(async () => {
    await driveAuth.signOut();
    await driveAuth.signIn();
    fakeDriveFile(SEED_PDF_ID)!.content = pdfBytes;
});

it('preserves the verified bytes when the Drive revision and format match', async () => {
    const study = await driveStudyRepo.get(SEED_PDF_ID);
    const file = await readVerifiedStudyAttachment(study, await driveAuth.getAccessToken());
    expect(file.type).toBe('application/pdf');
    expect(await file.text()).toBe(pdfBytes);
});

it('rejects a response MIME different from the chosen attachment even if the signature is correct', async () => {
    const study = await driveStudyRepo.get(SEED_PDF_ID);
    server.use(http.get(endpoint, ({request}) => new URL(request.url).searchParams.has('alt')
        ? new HttpResponse(pdfBytes, {headers: {'Content-Type': 'image/png'}})
        : undefined));
    await expect(readVerifiedStudyAttachment(study, await driveAuth.getAccessToken()))
        .rejects.toBeInstanceOf(StudyAttachmentFormatError);
});

it('rejects the file if its Drive revision changes before the media request completes', async () => {
    const study = await driveStudyRepo.get(SEED_PDF_ID);
    server.use(http.get(endpoint, ({request}) => {
        if (!new URL(request.url).searchParams.has('alt')) return undefined;
        touchRemote(SEED_PDF_ID);
        return new HttpResponse(pdfBytes, {headers: {'Content-Type': 'application/pdf'}});
    }));
    await expect(readVerifiedStudyAttachment(study, await driveAuth.getAccessToken()))
        .rejects.toBeInstanceOf(DriveConflictError);
});
