import {storage} from '@core/storage';
import type {DriveClient, DriveFileResponse} from './drive-api';
import type {IntakeCandidate} from '@domain/repository';

export class DriveIntakeRepository {
    constructor(private client: DriveClient) {
    }

    private parseCandidate(file: DriveFileResponse): IntakeCandidate {
        return {
            id: file.id,
            name: file.description ? JSON.parse(file.description).title || file.name : file.name,
            mimeType: file.mimeType,
            modifiedTime: file.modifiedTime ?? '',
            size: 0, // Drive doesn't return size in list, would need separate call
            status: 'new',
        };
    }

    async listCandidates(folderId: string): Promise<IntakeCandidate[]> {
        const owner = await this.client.cacheOwner();
        const candidates: IntakeCandidate[] = [];
        let pageToken = '';
        const query = `'${folderId}' in parents and mimeType = 'application/pdf' and trashed = false`;
        do {
            const response = await this.client.request(
                this.client.url('https://www.googleapis.com/drive/v3/', 'files', {
                    q: query,
                    spaces: 'drive',
                    pageSize: '100',
                    fields: `nextPageToken,files(${ENTRY_FIELDS},size)`,
                    ...(pageToken ? {pageToken} : {}),
                })
            ).then((r) => r.json() as Promise<DriveFileResponse>);

            const files = (response.files ?? []).filter(f => f.mimeType === 'application/pdf');
            candidates.push(...files.map((f) => this.parseCandidate(f)));
            pageToken = response.nextPageToken ?? '';
        } while (pageToken);

        // Load status from local storage (imported/discarded/pending)
        const stored = await storage.readSessionDirectory<IntakeCandidate>(owner, 'intakeCandidatesStatus');
        if (stored) {
            const statusMap = new Map(stored.map(c => [c.id, c.status]));
            candidates.forEach(c => {
                if (statusMap.has(c.id)) c.status = statusMap.get(c.id)!;
            });
        }
        return candidates;
    }

    async getPdfFile(fileId: string): Promise<File> {
        const response = await this.client.request(
            this.client.url('https://www.googleapis.com/drive/v3/', `files/${encodeURIComponent(fileId)}`, {alt: 'media'})
        );
        const blob = await response.blob();
        return new File([blob], 'informe.pdf', {type: 'application/pdf'});
    }
}

const ENTRY_FIELDS = 'id,description,version,modifiedTime,mimeType,trashed,appProperties';