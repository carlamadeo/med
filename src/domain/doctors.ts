import type {Doctor, Study} from './models';
import {cleanSpecialty, normalizeDoctorName} from './library';
import {normalize} from './utils';

export interface DoctorDirectoryEntry {
    key: string;
    name: string;
    specialty?: string;
    addresses: string[];
    defaultAddress?: string;
    studyCount: number;
    doctor?: Doctor;
}

function cleanText(value: unknown): string {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

export function cleanDoctorName(value: unknown): string {
    return cleanText(value);
}

export function cleanDoctorAddresses(
    addresses: unknown,
    defaultAddress?: unknown,
): { addresses: string[]; defaultAddress?: string } {
    if (!Array.isArray(addresses)) return {addresses: [], defaultAddress: undefined};
    const unique = new Map<string, string>();
    for (const raw of addresses) {
        const cleaned = cleanText(raw);
        if (!cleaned) continue;
        const key = normalize(cleaned);
        if (!unique.has(key)) unique.set(key, cleaned);
    }
    const cleaned = [...unique.values()];
    if (cleaned.length === 0) return {addresses: [], defaultAddress: undefined};

    const requestedDefault = cleanText(defaultAddress);
    const defaultKey = requestedDefault ? normalize(requestedDefault) : '';
    const resolvedDefault = (defaultKey ? unique.get(defaultKey) : undefined) ?? cleaned[0];
    return {addresses: cleaned, defaultAddress: resolvedDefault};
}

export function orderedDoctorAddresses(doctor: Pick<Doctor, 'addresses' | 'defaultAddress'>): string[] {
    const {addresses, defaultAddress} = cleanDoctorAddresses(doctor.addresses, doctor.defaultAddress);
    if (!defaultAddress) return addresses;
    return [defaultAddress, ...addresses.filter((address) => address !== defaultAddress)];
}

export function buildDoctorDirectory(
    studies: readonly Study[],
    savedDoctors: readonly Doctor[],
): DoctorDirectoryEntry[] {
    const counts = new Map<string, {name: string; studyCount: number; specialty?: string; specialtyDate: string}>();
    for (const study of studies) {
        const name = cleanDoctorName(study.doctor);
        const key = normalizeDoctorName(name);
        if (!key) continue;
        const specialty = cleanSpecialty(study.specialty);
        const studyDate = study.date ?? '';
        const existing = counts.get(key);
        if (existing) {
            existing.studyCount += 1;
            if (specialty && (!existing.specialty || studyDate >= existing.specialtyDate)) {
                existing.specialty = specialty;
                existing.specialtyDate = studyDate;
            }
        } else {
            counts.set(key, {
                name,
                studyCount: 1,
                specialty,
                specialtyDate: specialty ? studyDate : '',
            });
        }
    }

    const entries: DoctorDirectoryEntry[] = [];
    const seenKeys = new Set<string>();

    for (const doctor of savedDoctors) {
        const name = cleanDoctorName(doctor.name);
        const key = normalizeDoctorName(name);
        if (!key) continue;
        seenKeys.add(key);
        const info = counts.get(key);
        const addresses = orderedDoctorAddresses(doctor);
        entries.push({
            key,
            name,
            specialty: cleanSpecialty(doctor.specialty) ?? info?.specialty,
            addresses,
            defaultAddress: addresses[0],
            studyCount: info?.studyCount ?? 0,
            doctor,
        });
    }

    for (const [key, info] of counts) {
        if (seenKeys.has(key)) continue;
        entries.push({
            key,
            name: info.name,
            specialty: info.specialty,
            addresses: [],
            studyCount: info.studyCount,
        });
    }

    return entries.sort((a, b) => b.studyCount - a.studyCount || a.name.localeCompare(b.name, 'es-AR'));
}

export function findDoctorByName(
    entries: readonly DoctorDirectoryEntry[],
    name: string,
): DoctorDirectoryEntry | undefined {
    const key = normalizeDoctorName(name);
    if (!key) return undefined;
    return entries.find((entry) => entry.key === key);
}

export function doctorMatchesQuery(entry: DoctorDirectoryEntry, normalizedQuery: string): boolean {
    const query = normalizeDoctorName(normalizedQuery);
    if (!query) return true;
    return [entry.name, entry.specialty ?? '', ...entry.addresses].some((value) =>
        normalizeDoctorName(value).includes(query),
    );
}
