import {openDB, type DBSchema} from 'idb';
import type {StudyDraft} from '@domain/models';

export interface ImportRow {
    key: string;
    file: File;
    draft: StudyDraft;
    selected: boolean;
    status: 'waiting' | 'reading' | 'ready' | 'error' | 'saved' | 'uncertain';
    message: string;
    hash?: string;
    submitted?: StudyDraft;
    duplicateConfirmed: string;
}

type DraftFields = Omit<StudyDraft, 'file'>;
type SavedRow = Omit<ImportRow, 'file' | 'draft' | 'submitted'> & {
    blob?: Blob;
    bytes?: ArrayBuffer;
    mime?: string;
    name: string;
    lastModified: number;
    draft: DraftFields;
    submitted?: DraftFields;
};

export interface ImportedPdf {
    hash: string;
    studyId: string;
    revision: string;
}

interface ImportDB extends DBSchema {
    batches: {key: string; value: {revision: string; rows: SavedRow[]}};
    hashes: {key: string; value: ImportedPdf[]};
}

function openImportDB() {
    return openDB<ImportDB>('mis-estudios-study-import', 1, {
        upgrade(db) {
            db.createObjectStore('batches');
            db.createObjectStore('hashes');
        },
    });
}

function fieldsOf({file: _file, ...fields}: StudyDraft): DraftFields {
    return fields;
}

async function serialize({file, draft, submitted, ...row}: ImportRow): Promise<SavedRow> {
    return {
        ...row,
        // Persist the bytes, independently of the file picker's temporary file reference.
        bytes: await file.arrayBuffer(),
        mime: file.type,
        name: file.name,
        lastModified: file.lastModified,
        draft: fieldsOf(draft),
        submitted: submitted ? fieldsOf(submitted) : undefined,
    };
}

export async function readImportBatch(owner: string): Promise<{
    revision: string | null;
    rows: ImportRow[];
    hashes: ImportedPdf[];
}> {
    const db = await openImportDB();
    try {
        const tx = db.transaction(['batches', 'hashes'], 'readonly');
        const [batch, hashes] = await Promise.all([tx.objectStore('batches').get(owner), tx.objectStore('hashes').get(owner)]);
        await tx.done;
        const rows = batch?.rows.map(({blob, bytes, mime, name, lastModified, draft, submitted, ...row}) => {
            const contents = bytes ?? blob;
            if (!contents) throw new Error('El borrador no contiene los datos del PDF.');
            const file = new File([contents], name, {type: mime ?? blob?.type, lastModified});
            return {...row, file, draft: {...draft, file}, submitted: submitted ? {...submitted, file} : undefined};
        }) ?? [];
        return {revision: batch?.revision ?? null, rows, hashes: hashes ?? []};
    } finally {
        db.close();
    }
}

export async function replaceImportBatch(
    owner: string,
    previousRevision: string | null,
    rows: ImportRow[],
    imported?: ImportedPdf,
): Promise<{revision: string | null; hashes: ImportedPdf[]}> {
    const pending: SavedRow[] = [];
    for (const row of rows) {
        if (row.status !== 'saved') pending.push(await serialize(row));
    }
    const db = await openImportDB();
    try {
        const tx = db.transaction(['batches', 'hashes'], 'readwrite');
        // The request can reject separately when the transaction aborts.
        void tx.done.catch(() => {});
        const batches = tx.objectStore('batches');
        const hashesStore = tx.objectStore('hashes');
        const batch = await batches.get(owner);
        if ((batch?.revision ?? null) !== previousRevision) {
            await tx.done;
            throw new Error('El borrador cambió en otra pestaña. Cerrá este diálogo y volvé a abrirlo.');
        }
        const revision = pending.length ? crypto.randomUUID() : null;
        if (revision) await batches.put({revision, rows: pending}, owner);
        else await batches.delete(owner);
        const hashes = (await hashesStore.get(owner)) ?? [];
        if (imported) {
            // A Study ID can only be a match for its last known revision.
            const next = hashes.filter(item => item.studyId !== imported.studyId);
            next.push(imported);
            await hashesStore.put(next, owner);
            await tx.done;
            return {revision, hashes: next};
        }
        await tx.done;
        return {revision, hashes};
    } finally {
        db.close();
    }
}

export async function clearImportHashes(owner: string): Promise<void> {
    const db = await openImportDB();
    try {
        await db.delete('hashes', owner);
    } finally {
        db.close();
    }
}
