/**
 * Pure rules for the study list. Ported from `render()` and `updatePortalOptions()` in the original app.js:
 * what matches a search, how matches are ordered, and which institutions the editor suggests.
 */
import type { Study } from './models';
import { normalize } from './utils';

export interface ListFilters {
  query: string;
  type: string;
  from: string;
  to: string;
}

export interface ListResult {
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
export function compareStudies(a: Study, b: Study): number {
  return b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'es-AR');
}

export function filterStudies(studies: readonly Study[], filters: ListFilters): ListResult {
  const query = normalize(filters.query.trim());
  const { type, from, to } = filters;
  const filtered = Boolean(query || type || from || to);
  const invalidRange = Boolean(from && to && from > to);
  const matches = invalidRange
    ? []
    : studies
        .filter(
          (study) =>
            (!query || normalize([study.title, study.doctor, study.portal].join(' ')).includes(query)) &&
            (!type || study.types.includes(type)) &&
            (!from || study.date >= from) &&
            (!to || study.date <= to)
        )
        .sort(compareStudies);
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
