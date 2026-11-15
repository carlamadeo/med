/**
 * Pure rules for the study list. Ported from `render()` and `updatePortalOptions()` in the original app.js:
 * what matches a search, how matches are ordered, and which institutions the editor suggests.
 */
import type {Filters, Study} from './models';
import {normalize} from './utils';

export type StudySortOrder =
    | 'date-desc'
    | 'date-asc'
    | 'title'
    | 'title-desc'
    | 'doctor'
    | 'doctor-desc'
    | 'portal'
    | 'portal-desc'
    | 'type';

interface ListResult {
    matches: Study[];
    /** Any search text or filter is active. */
    filtered: boolean;
    /** "Hasta" is earlier than "Desde": nothing can match, and the user should be told why. */
    invalidRange: boolean;
}

export function hasStudyAttachment(study: Study): boolean {
    return Boolean(study.hasPdf || study.attachmentMime);
}

export function studyAttachmentLabel(study: Study): string {
    return study.attachmentMime ? 'Abrir imagen' : 'Abrir PDF';
}

/** Link that opens the stored report in Google Drive's own viewer. */
export function reportUrl(driveFileId: string): string {
    return `https://drive.google.com/file/d/${encodeURIComponent(driveFileId)}/view`;
}

/** Medium es-AR date for a `YYYY-MM-DD` study date; malformed values are returned untouched. */
export function formatStudyDate(date: string): string {
    const parts = date.split('-');
    if (parts.length !== 3) return date;
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return date;
    return new Date(year, month - 1, day).toLocaleDateString('es-AR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}

/** Newest first; same-day studies in alphabetical order (Argentine Spanish collation). */
function compareStudies(a: Study, b: Study): number {
    return b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'es-AR');
}

function studyMatchesQuery(study: Study, normalizedQuery: string): boolean {
    return [study.title, study.doctor, study.portal, study.reportName, ...study.types].some(
        (value) => normalize(value).includes(normalizedQuery),
    );
}

export function filterStudiesByQuery(studies: Study[], query: string): Study[] {
    const normalizedQuery = normalize(query);
    return normalizedQuery ? studies.filter((study) => studyMatchesQuery(study, normalizedQuery)) : studies;
}

function compareByOrder(a: Study, b: Study, sortOrder: StudySortOrder): number {
    switch (sortOrder) {
        case 'date-asc':
            return a.date.localeCompare(b.date);
        case 'title':
            return a.title.localeCompare(b.title, 'es') || b.date.localeCompare(a.date);
        case 'title-desc':
            return b.title.localeCompare(a.title, 'es') || b.date.localeCompare(a.date);
        case 'doctor':
            return (a.doctor || '').localeCompare(b.doctor || '', 'es') || b.date.localeCompare(a.date);
        case 'doctor-desc':
            return (b.doctor || '').localeCompare(a.doctor || '', 'es') || b.date.localeCompare(a.date);
        case 'portal':
            return (a.portal || '').localeCompare(b.portal || '', 'es') || b.date.localeCompare(a.date);
        case 'portal-desc':
            return (b.portal || '').localeCompare(a.portal || '', 'es') || b.date.localeCompare(a.date);
        case 'type':
            return (a.types[0] ?? '').localeCompare(b.types[0] ?? '', 'es') || b.date.localeCompare(a.date);
        case 'date-desc':
        default:
            return b.date.localeCompare(a.date);
    }
}

export function sortStudies(studies: readonly Study[], sortOrder: StudySortOrder = 'date-desc'): Study[] {
    const list = [...studies];
    list.sort((a, b) => compareByOrder(a, b, sortOrder));
    return list;
}

export function filterStudies(
    studies: readonly Study[],
    filters: Filters,
    categoryTypes: readonly string[] = [],
    sortOrder: StudySortOrder = 'date-desc',
): ListResult {
    const query = normalize(filters.query);
    const {type, from, to, operationId, portal, onlyPdf, onlyViewer} = filters;
    const filtered = Boolean(query || type || from || to || operationId || portal || onlyPdf || onlyViewer || categoryTypes.length);
    const invalidRange = Boolean(from && to && from > to);
    if (invalidRange) return {matches: [], filtered, invalidRange};

    const normalizedType = normalize(type);
    const normalizedPortal = normalize(portal);
    const categories = new Set(categoryTypes.map(normalize));
    const matches = studies.filter((study) => {
        if (from && study.date < from) return false;
        if (to && study.date > to) return false;
        if (operationId && study.operationId !== operationId) return false;
        if (portal && normalize(study.portal) !== normalizedPortal) return false;
        if (onlyPdf && !study.hasPdf && !study.documentIds?.length) return false;
        if (onlyViewer && !study.viewer) return false;
        if (type && !study.types.some((value) => normalize(value) === normalizedType)) return false;
        if (categories.size && !study.types.some((value) => categories.has(normalize(value)))) return false;
        return !query || studyMatchesQuery(study, query);
    });
    matches.sort((a, b) => compareByOrder(a, b, sortOrder) || compareStudies(a, b));
    return {matches, filtered, invalidRange};
}

function addNormalizedName(names: Map<string, string>, raw: unknown): void {
    if (typeof raw !== 'string') return;
    const name = raw.trim().replace(/\s+/g, ' ');
    if (name && !names.has(normalize(name))) names.set(normalize(name), name);
}

function sortDisplayNames(names: Map<string, string>): string[] {
    return [...names.values()].sort((a, b) => a.localeCompare(b, 'es', {sensitivity: 'base'}));
}

/** Distinct institutions already used, ignoring case/accents/extra spaces, sorted for display. */
export function portalNames(
    studies: readonly Study[],
    savedPortals: readonly { name?: string; displayName?: string }[] = [],
): string[] {
    const names = new Map<string, string>();
    for (const study of studies) addNormalizedName(names, study.portal);
    for (const portal of savedPortals) addNormalizedName(names, portal.displayName || portal.name);
    return sortDisplayNames(names);
}

/** Distinct professionals already used across studies and related records, sorted for display. */
export function doctorNames(
    studies: readonly Study[],
    extraNames: readonly (string | undefined)[] = [],
): string[] {
    const names = new Map<string, string>();
    for (const study of studies) addNormalizedName(names, study.doctor);
    for (const extra of extraNames) addNormalizedName(names, extra);
    return sortDisplayNames(names);
}
