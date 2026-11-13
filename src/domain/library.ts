/**
 * Pure rules for the study list. Ported from `render()` and `updatePortalOptions()` in the original app.js:
 * what matches a search, how matches are ordered, and which institutions the editor suggests.
 */
import type { Filters, Study } from './models';
import { normalize } from './utils';

export type StudySortOrder = 'date-desc' | 'date-asc' | 'title' | 'type';

interface ListResult {
  matches: Study[];
  /** Any search text or filter is active. */
  filtered: boolean;
  /** "Hasta" is earlier than "Desde": nothing can match, and the user should be told why. */
  invalidRange: boolean;
}

/** Link that opens the stored PDF in Google Drive's own viewer. */
export function reportUrl(driveFileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(driveFileId)}/view`;
}

/** Newest first; same-day studies in alphabetical order (Argentine Spanish collation). */
function compareStudies(a: Study, b: Study): number {
  return b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'es-AR');
}

export function filterStudies(
  studies: readonly Study[],
  filters: Filters,
  categoryTypes: readonly string[] = [],
  sortOrder: StudySortOrder = 'date-desc',
): ListResult {
  const query = normalize(filters.query);
  const { type, from, to, operationId, portal, onlyPdf, onlyViewer } = filters;
  const filtered = Boolean(query || type || from || to || operationId || portal || onlyPdf || onlyViewer || categoryTypes.length);
  const invalidRange = Boolean(from && to && from > to);
  if (invalidRange) return { matches: [], filtered, invalidRange };

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
    return !query || [study.title, study.doctor, study.portal, ...study.types].some(
      (value) => normalize(value).includes(query),
    );
  });
  matches.sort((a, b) => {
    if (sortOrder === 'date-asc') return a.date.localeCompare(b.date) || compareStudies(a, b);
    if (sortOrder === 'title') return a.title.localeCompare(b.title, 'es') || compareStudies(a, b);
    if (sortOrder === 'type') return (a.types[0] ?? '').localeCompare(b.types[0] ?? '', 'es') || compareStudies(a, b);
    return compareStudies(a, b);
  });
  return { matches, filtered, invalidRange };
}

/** Distinct institutions already used, ignoring case/accents/extra spaces, sorted for display. */
export function portalNames(studies: readonly Study[]): string[] {
  const names = new Map<string, string>();
  for (const study of studies) {
    if (typeof study.portal !== 'string') continue;
    const name = study.portal.trim().replace(/\s+/g, ' ');
    if (name && !names.has(normalize(name))) names.set(normalize(name), name);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}
