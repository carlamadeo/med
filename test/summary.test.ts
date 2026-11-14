import { describe, expect, it } from 'vitest';
import { latestStudy, monthlyStudyActivity, relativeDayLabel, studySyncState, upcomingAppointment } from '@domain/summary';
import type { Appointment, Study } from '@domain/models';

function study(id: string, over: Partial<Study> = {}): Study {
  return {
    id,
    title: `Estudio ${id}`,
    date: '2026-01-01',
    types: [],
    doctor: '',
    portal: '',
    viewer: '',
    reportName: '',
    hasPdf: false,
    driveFileId: id,
    driveModifiedTime: '',
    revision: '1',
    ...over,
  };
}

function appointment(id: string, over: Partial<Appointment> = {}): Appointment {
  return {
    id,
    date: '2026-11-20',
    time: '10:30',
    timeZone: 'America/Argentina/Buenos_Aires',
    professional: 'Dra. Pérez',
    notes: '',
    status: 'scheduled',
    cost: null,
    coverage: null,
    revision: '1',
    ...over,
  };
}

const now = new Date(2026, 10, 15, 12, 0, 0);

describe('monthlyStudyActivity', () => {
  it('returns the last six calendar months oldest first, including empty months', () => {
    const result = monthlyStudyActivity([
      study('old', { date: '2026-05-02' }),
      study('new', { date: '2026-11-03' }),
      study('new-2', { date: '2026-11-28' }),
      study('invalid', { date: 'no' }),
    ], 6, now);

    expect(result.map((item) => item.key)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(result.map((item) => item.count)).toEqual([0, 0, 0, 0, 0, 2]);
    expect(result[5]?.label).toBe('nov');
  });

  it('counts studies by the first seven characters of the date and ignores malformed dates', () => {
    const result = monthlyStudyActivity([study('a', { date: '2026-10-31' }), study('b', { date: '2026-10-01' }), study('c', { date: '2026-1-01' })], 1, now);

    expect(result).toEqual([{ key: '2026-11', label: 'nov', count: 0 }]);
  });

  it('uses the supplied month count', () => {
    expect(monthlyStudyActivity([], 3, now)).toHaveLength(3);
  });
});

describe('latestStudy', () => {
  it('returns the newest study, breaking ties with Spanish alphabetical order', () => {
    expect(latestStudy([study('a', { title: 'Zeta', date: '2026-01-01' }), study('b', { title: 'Álamo', date: '2026-02-01' }), study('c', { title: 'Ñandú', date: '2026-02-01' })])?.id).toBe('b');
    expect(latestStudy([])).toBeNull();
  });
});

describe('upcomingAppointment', () => {
  it('ignores past, completed, cancelled and invalid appointments', () => {
    const result = upcomingAppointment([
      appointment('past', { date: '2026-11-01' }),
      appointment('done', { status: 'completed', date: '2026-11-18' }),
      appointment('cancelled', { status: 'cancelled', date: '2026-11-19' }),
      appointment('later', { date: '2026-11-25', time: '16:00' }),
      appointment('soon', { date: '2026-11-20', time: '10:30' }),
    ], now);

    expect(result?.id).toBe('soon');
  });

  it('returns null when there is no upcoming appointment', () => {
    expect(upcomingAppointment([appointment('past', { date: '2026-11-01' })], now)).toBeNull();
    expect(upcomingAppointment([], now)).toBeNull();
  });
});

describe('relativeDayLabel', () => {
  it('uses calendar days in es-AR, independent of the local time zone', () => {
    expect(relativeDayLabel('2026-11-15', now)).toBe('hoy');
    expect(relativeDayLabel('2026-11-14', now)).toBe('ayer');
    expect(relativeDayLabel('2026-11-13', now)).toBe('anteayer');
    expect(relativeDayLabel('2026-11-16', now)).toBe('mañana');
  });

  it('returns the original value for malformed dates', () => {
    expect(relativeDayLabel('no', now)).toBe('no');
  });
});

describe('studySyncState', () => {
  it.each([
    [undefined, 'synced'],
    ['pending', 'pending'],
    ['conflict', 'conflict'],
    ['failed', 'failed'],
  ] as const)('maps %s to %s', (status, expected) => {
    expect(studySyncState({ syncStatus: status })).toBe(expected);
  });
});