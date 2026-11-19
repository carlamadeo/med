import {openDB, type DBSchema, type IDBPDatabase} from 'idb';
import type {StudyDraft} from '@domain/models';

interface IntakeReservation {
    id: string;
    fingerprint: string;
    draft?: Omit<StudyDraft, 'file' | 'id'>;
}

interface StoredIntakeReservation extends IntakeReservation {
    owner: string;
    sourceId: string;
}

interface IntakeReservationDB extends DBSchema {
    reservations: {key: [string, string]; value: StoredIntakeReservation; indexes: {owner: string}};
}

let database: Promise<IDBPDatabase<IntakeReservationDB>> | undefined;

function getDB() {
    database ??= openDB<IntakeReservationDB>('mis-estudios-intake-reservations', 1, {
        upgrade(db) {
            db.createObjectStore('reservations', {keyPath: ['owner', 'sourceId']}).createIndex('owner', 'owner');
        },
    }).catch((error: unknown) => {
        database = undefined;
        throw error;
    });
    return database;
}

function legacyPrefix(owner: string): string {
    return `mis-estudios:intake-reservation:${encodeURIComponent(owner)}:`;
}

async function putIfAbsent(owner: string, sourceId: string, value: IntakeReservation): Promise<StoredIntakeReservation> {
    const db = await getDB();
    const tx = db.transaction('reservations', 'readwrite');
    const existing = await tx.store.get([owner, sourceId]);
    const record = existing ?? {...value, owner, sourceId};
    if (!existing) await tx.store.add(record);
    await tx.done;
    return record;
}

function readLegacy(raw: string): IntakeReservation {
    let value: IntakeReservation | undefined;
    try {
        value = JSON.parse(raw) as IntakeReservation;
    } catch {
        // A damaged legacy entry may still refer to an upload that landed in Drive.
    }
    if (typeof value?.id !== 'string' || !/^[\w-]+$/.test(value.id) ||
        typeof value.fingerprint !== 'string' || !value.fingerprint) {
        throw new Error('No se pudo recuperar una reserva de importación de este navegador.');
    }
    return value;
}

export async function readIntakeReservation(owner: string, sourceId: string): Promise<IntakeReservation | undefined> {
    const legacyKey = `${legacyPrefix(owner)}${encodeURIComponent(sourceId)}`;
    const db = await getDB();
    const tx = db.transaction('reservations', 'readwrite');
    let record = await tx.store.get([owner, sourceId]);
    const raw = localStorage.getItem(legacyKey);
    if (raw !== null) {
        const value = readLegacy(raw);
        if (record && (record.id !== value.id || record.fingerprint !== value.fingerprint)) {
            throw new Error('Hay dos reservas para este documento. Verificá en Drive qué archivo se guardó antes de continuar.');
        }
        if (!record) {
            record = {...value, owner, sourceId};
            await tx.store.add(record);
        }
    }
    await tx.done;
    if (raw !== null) {
        // Do not erase newer data written by another tab running the previous version.
        if (localStorage.getItem(legacyKey) === raw) localStorage.removeItem(legacyKey);
    }
    if (record) {
        const {owner: _owner, sourceId: _source, ...reservation} = record;
        return reservation;
    }
}

export async function listIntakeReservationSources(owner: string): Promise<string[]> {
    const prefix = legacyPrefix(owner);
    // Capture the keys before migration removes them from the legacy store.
    const sources = Object.keys(localStorage)
        .filter(key => key.startsWith(prefix))
        .map(key => decodeURIComponent(key.slice(prefix.length)));
    // One unreadable legacy reservation must not hide the other pending imports.
    const results = await Promise.allSettled(sources.map(sourceId => readIntakeReservation(owner, sourceId)));
    const db = await getDB();
    const current = (await db.getAllKeysFromIndex('reservations', 'owner', owner)).map(([, sourceId]) => sourceId);
    return [...new Set([...current, ...sources.filter((_, index) => results[index]?.status === 'rejected')])];
}

export async function reserveIntakeDestination(owner: string, sourceId: string, draft: StudyDraft, reserve: () => Promise<string>): Promise<string> {
    const {file, id: _id, ...fields} = draft;
    const bytes = file ? await file.arrayBuffer() : new ArrayBuffer(0);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const attachment = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const encoded = new TextEncoder().encode(JSON.stringify({fields, attachment}));
    const hash = await crypto.subtle.digest('SHA-256', encoded);
    const fingerprint = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    const existing = await readIntakeReservation(owner, sourceId);
    const record = existing ?? await putIfAbsent(owner, sourceId, {id: await reserve(), fingerprint, draft: fields});
    if (record.fingerprint !== fingerprint) {
        throw new Error('Hay un guardado sin confirmar para este archivo. Recuperá los datos originales antes de reintentar.');
    }
    return record.id;
}

export async function clearIntakeReservation(owner: string, sourceId: string, confirmedId: string): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('reservations', 'readwrite');
    const key: [string, string] = [owner, sourceId];
    if ((await tx.store.get(key))?.id === confirmedId) await tx.store.delete(key);
    await tx.done;
}
