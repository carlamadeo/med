import { describe, expect, it } from 'vitest';
import { normalizeSearch, searchArchive } from '@domain/search';
import type { Appointment, Portal, Study } from '@domain/models';

function study(id: string, over: Partial<Study> = {}): Study {
  return {
    id,
    title: `Estudio ${id}`,
    date: '2026-11-10',
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

function portal(id: string, over: Partial<Portal> = {}): Portal {
  return { id, name: id, displayName: id, url: `https://${id}.test`, ...over };
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

const now = new Date(2026, 10, 14, 12, 0, 0);

describe('normalizeSearch', () => {
  it('removes accents, lowercases and trims', () => {
    expect(normalizeSearch('  Análisis  ')).toBe('analisis');
  });
});

describe('searchArchive', () => {
  it('finds studies by title, doctor, portal, type and date, prioritizing the title', () => {
    const studies = [
      study('a', { title: 'Mamografía bilateral', date: '2026-11-12', doctor: 'Dra. Pérez', portal: 'Hospital Italiano', types: ['Mamografía'] }),
      study('b', { title: 'Consulta cardiológica', date: '2026-11-13', doctor: 'Dr. López', portal: 'Hospital Italiano', types: ['Consulta'] }),
    ];

    const result = searchArchive({ studies, portals: [], appointments: [], query: 'mamografia' });
    expect(result.map((item) => item.key)).toEqual(['study:a']);
    expect(result[0]?.subtitle).toMatch(/12 (?:de )?nov\.? (?:de )?2026/);

    expect(searchArchive({ studies, portals: [], appointments: [], query: 'perez' })[0]?.key).toBe('study:a');
    expect(searchArchive({ studies, portals: [], appointments: [], query: 'italiano' })).toHaveLength(2);
    expect(searchArchive({ studies, portals: [], appointments: [], query: 'consulta' })[0]?.key).toBe('study:b');
  });

  it('finds portals by display name, slug, URL and notes', () => {
    const portals = [portal('p1', { displayName: 'Hospital Italiano', name: 'hospital-italiano', url: 'https://hospital.test', notes: 'Cartilla prepaga' })];

    expect(searchArchive({ studies: [], portals, appointments: [], query: 'italiano' })[0]?.key).toBe('portal:p1');
    expect(searchArchive({ studies: [], portals, appointments: [], query: 'hospital.test' })[0]?.key).toBe('portal:p1');
    expect(searchArchive({ studies: [], portals, appointments: [], query: 'prepaga' })[0]?.key).toBe('portal:p1');
  });

  it('finds appointments by professional, notes and status label', () => {
    const appointments = [appointment('a1', { professional: 'Dra. Pérez', notes: 'Control anual', date: '2026-11-20' })];

    expect(searchArchive({ studies: [], portals: [], appointments, query: 'perez', now })[0]?.key).toBe('appointment:a1');
    expect(searchArchive({ studies: [], portals: [], appointments, query: 'control', now })[0]?.key).toBe('appointment:a1');
    expect(searchArchive({ studies: [], portals: [], appointments, query: 'proximo', now })[0]?.key).toBe('appointment:a1');
  });

  it('returns nothing for an empty or unmatched query', () => {
    const studies = [study('a', { title: 'Mamografía' })];
    expect(searchArchive({ studies, portals: [], appointments: [], query: '' })).toEqual([]);
    expect(searchArchive({ studies, portals: [], appointments: [], query: 'resonancia' })).toEqual([]);
  });
});