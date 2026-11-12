/** Study type catalogue; relative URL so the app also works when served from a sub-path. */
let cachedTypes: string[] | null = null;

export async function getStudyTypes(): Promise<string[]> {
  if (cachedTypes) return cachedTypes;
  const response = await fetch(`${import.meta.env.BASE_URL}types.json`);
  if (!response.ok) throw new Error('No se pudieron cargar los tipos de estudio.');
  cachedTypes = (await response.json()) as string[];
  return cachedTypes;
}

/** Test hook: forget the cached catalogue so the next call hits the network again. */
export function resetStudyTypesCache(): void {
  cachedTypes = null;
}

/** Lowercase, accent-insensitive form used for every user-facing comparison. */
export function normalize(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Validates a viewer link: empty is allowed, anything else must be a plain http(s) URL without credentials.
 * Returns the normalized href; throws for anything unsafe or unparseable.
 */
export function viewerURL(value: string): string {
  if (!value) return '';
  const link = new URL(value);
  if (!['http:', 'https:'].includes(link.protocol) || link.username || link.password) throw new Error('Invalid viewer link');
  return link.href;
}

/** A real calendar date written as YYYY-MM-DD, not before 1900 (same rule as the original extract.js). */
export function isValidDate(date: unknown): date is string {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '1900-01-01') return false;
  const instant = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === date;
}
