import type { Appointment, Portal, Study, ViewMode } from './models';
import { formatStudyDate } from './library';
import { appointmentStatus } from './appointments';

export type ArchiveSearchKind = 'study' | 'portal' | 'appointment';

export interface ArchiveSearchResult {
  key: string;
  kind: ArchiveSearchKind;
  title: string;
  subtitle: string;
  meta: string;
  view: ViewMode;
  study?: Study;
  portal?: Portal;
  appointment?: Appointment;
}

interface SearchArchiveInput {
  studies: readonly Study[];
  portals: readonly Portal[];
  appointments: readonly Appointment[];
  query: string;
  now?: Date;
}

const statusLabels: Record<ReturnType<typeof appointmentStatus>, string> = {
  upcoming: 'Próximo',
  overdue: 'Vencido',
  completed: 'Realizado',
  cancelled: 'Cancelado',
  absent: 'No asistí',
};

export function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

function score(value: string, query: string): number {
  const normalized = normalizeSearch(value);
  if (!normalized) return -1;
  if (normalized === query) return 0;
  if (normalized.startsWith(query)) return 1;
  if (normalized.includes(query)) return 2;
  return -1;
}

function bestScore(values: readonly string[], query: string): number {
  let best = -1;
  for (const value of values) {
    const current = score(value, query);
    if (current >= 0 && (best < 0 || current < best)) best = current;
  }
  return best;
}

function matchesAllTerms(values: readonly string[], terms: readonly string[]): boolean {
  const normalized = values.map(normalizeSearch);
  return terms.every((term) => normalized.some((value) => value.includes(term)));
}

export function searchArchive({ studies, portals, appointments, query, now = new Date() }: SearchArchiveInput): ArchiveSearchResult[] {
  const normalized = normalizeSearch(query);
  if (!normalized) return [];
  const terms = normalized.split(/\s+/).filter(Boolean);

  const studyResults: ArchiveSearchResult[] = [];
  for (const study of studies) {
    const fields = [study.title, study.doctor, study.portal, study.types.join(' '), study.reportName, study.date, formatStudyDate(study.date)];
    const titleScore = bestScore([study.title], normalized);
    const fieldScore = bestScore(fields, normalized);
    if (titleScore < 0 && fieldScore < 0 && !matchesAllTerms(fields, terms)) continue;
    studyResults.push({
      key: `study:${study.id}`,
      kind: 'study',
      title: study.title,
      subtitle: `${formatStudyDate(study.date)}${study.doctor ? ` · ${study.doctor}` : ''}`,
      meta: study.types.join(', ') || 'Sin tipo',
      view: 'cronologia',
      study,
    });
  }
  studyResults.sort((a, b) => (b.study?.date ?? '').localeCompare(a.study?.date ?? ''));

  const portalResults: ArchiveSearchResult[] = [];
  for (const portal of portals) {
    const fields = [portal.displayName, portal.name, portal.url, portal.notes ?? ''];
    if (bestScore(fields, normalized) < 0 && !matchesAllTerms(fields, terms)) continue;
    portalResults.push({
      key: `portal:${portal.id ?? portal.name}`,
      kind: 'portal',
      title: portal.displayName,
      subtitle: portal.url,
      meta: portal.notes || 'Portal guardado',
      view: 'cronologia',
      portal,
    });
  }
  portalResults.sort((a, b) => a.title.localeCompare(b.title, 'es-AR'));

  const appointmentResults: ArchiveSearchResult[] = [];
  for (const appointment of appointments) {
    const status = appointmentStatus(appointment, now);
    const fields = [appointment.professional, appointment.notes, appointment.date, appointment.time, appointment.timeZone, statusLabels[status]];
    if (bestScore(fields, normalized) < 0 && !matchesAllTerms(fields, terms)) continue;
    appointmentResults.push({
      key: `appointment:${appointment.id}`,
      kind: 'appointment',
      title: appointment.professional || 'Turno médico',
      subtitle: `${appointment.date} · ${appointment.time}`,
      meta: statusLabels[status],
      view: 'turnos',
      appointment,
    });
  }
  appointmentResults.sort((a, b) => (b.appointment?.date ?? '').localeCompare(a.appointment?.date ?? ''));

  return [...studyResults, ...portalResults, ...appointmentResults];
}