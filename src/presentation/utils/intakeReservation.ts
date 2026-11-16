import type {StudyDraft} from '@domain/models';

function key(owner: string, sourceId: string): string {
    return `mis-estudios:intake-reservation:${encodeURIComponent(owner)}:${encodeURIComponent(sourceId)}`;
}

export function hasIntakeReservation(owner: string, sourceId: string): boolean {
    return localStorage.getItem(key(owner, sourceId)) !== null;
}

export function readIntakeReservationId(owner: string, sourceId: string): string | null {
    try {
        const value = JSON.parse(localStorage.getItem(key(owner, sourceId)) ?? 'null') as {id?: unknown} | null;
        return typeof value?.id === 'string' ? value.id : null;
    } catch {
        return null;
    }
}

export function readIntakeDraft(owner: string, sourceId: string): Omit<StudyDraft, 'file' | 'id'> | null {
    const value = localStorage.getItem(key(owner, sourceId));
    if (!value) return null;
    try {
        return (JSON.parse(value) as {draft?: Omit<StudyDraft, 'file' | 'id'>}).draft ?? null;
    } catch {
        return null;
    }
}

export async function reserveIntakeDestination(owner: string, sourceId: string, draft: StudyDraft, reserve: () => Promise<string>): Promise<string> {
    const {file, id: _id, ...fields} = draft;
    const bytes = file ? await file.arrayBuffer() : new ArrayBuffer(0);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const attachment = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const value = new TextEncoder().encode(JSON.stringify({fields, attachment}));
    const hash = await crypto.subtle.digest('SHA-256', value);
    const fingerprint = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    const storageKey = key(owner, sourceId);
    const existing = localStorage.getItem(storageKey);
    if (existing) {
        const saved = JSON.parse(existing) as {id: string; fingerprint: string};
        if (saved.fingerprint !== fingerprint) {
            throw new Error('Hay un guardado sin confirmar para este archivo. Recuperá los datos originales antes de reintentar.');
        }
        return saved.id;
    }
    const id = await reserve();
    localStorage.setItem(storageKey, JSON.stringify({id, fingerprint, draft: fields}));
    return id;
}

export function clearIntakeReservation(owner: string, sourceId: string): void {
    localStorage.removeItem(key(owner, sourceId));
}
