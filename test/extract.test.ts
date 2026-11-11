/**
 * Behaviour spec carried over unchanged from the original test/extract.test.mjs (web/extract.js, web/detect.js).
 * Same inputs, same expectations: the TypeScript port must read reports exactly as before.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { signatureImages } from '@data/pdf-analysis';
import { extractFields, extractSignatureDoctor } from '@domain/extract';

/** The catalogue the app ships: every detected type must be one the form can select. */
const catalogue = JSON.parse(readFileSync(resolve(process.cwd(), 'public/types.json'), 'utf8')) as string[];

describe('extractFields: study types and date', () => {
  it('a breast report supplies its date and both types without using the birth date', () => {
    const found = extractFields(
      [
        'Sr./a APELLIDO, PACIENTE',
        'Fecha de Nac: 12/07/1980',
        'Dr./a PEREZ ANA',
        'Fecha: 18/03/2024 Orden: 123456789',
        'MAMOGRAFIA BILATERAL CON PROLONGACION AXILAR',
        'ESTUDIO REALIZADO CON MAMOGRAFO FULL DIGITAL',
        'ECOGRAFIA MAMARIA BILATERAL Y REGIONES AXILARES',
      ].join('\n')
    );

    expect(found).toEqual({ date: '2024-03-18', types: ['Mamografía', 'Ecografía'], doctor: 'PEREZ ANA' });
    expect(found.types?.every((type) => catalogue.includes(type))).toBe(true);
  });

  it('never takes a date that the same cell labels as birth, issue or print date', () => {
    // These cells also start with "Fecha:", so only the exclusion list keeps them out.
    for (const line of ['Fecha: 12/07/1980 nacimiento', 'Fecha: 01/02/2024 emision', 'Fecha: 01/02/2024 impresion']) {
      expect(extractFields(line).date, line).toBeUndefined();
    }
    expect(extractFields('Fecha: 18/03/2024').date).toBe('2024-03-18');
  });

  it('a single modality and an explicit study type keep their existing priority', () => {
    expect(extractFields('MAMOGRAFIA BILATERAL').types).toEqual(['Mamografía']);
    expect(extractFields('ECOGRAFÍA MAMARIA').types).toEqual(['Ecografía']);
    expect(extractFields('Estudio: Mamografía bilateral\nEcografía previa').types).toEqual(['Mamografía']);
  });

  it('multiple types are kept individually and repeated headings do not duplicate them', () => {
    expect(extractFields('RADIOGRAFIA DE TORAX\nECOGRAFIA ABDOMINAL').types).toEqual(['Radiografía', 'Ecografía']);
    expect(extractFields('MAMOGRAFIA\nECOGRAFIA\nRESONANCIA MAGNETICA\nECOGRAFIA').types).toEqual([
      'Mamografía',
      'Ecografía',
      'Resonancia magnética',
    ]);
    expect(extractFields('Informe sin tipo identificable').types).toBeUndefined();
  });

  it('specific study types are detected without also selecting their broader category', () => {
    for (const [heading, expected] of [
      ['ECOGRAFÍA TV', 'Ecografía TV'],
      ['ECOGRAFIA TRANSVAGINAL', 'Ecografía TV'],
      ['COLONOSCOPIA', 'Colonoscopía'],
      ['VIDEOCOLONOSCOPÍA', 'Colonoscopía'],
      ['PAP', 'PAP'],
      ['P.A.P.', 'PAP'],
      ['PAPANICOLAOU', 'PAP'],
    ] as const) {
      expect(catalogue, expected).toContain(expected);
      expect(extractFields(heading).types, heading).toEqual([expected]);
    }
    expect(extractFields('ECOGRAFIA ABDOMINAL\nECOGRAFIA TV\nPAP').types).toEqual(['Ecografía', 'Ecografía TV', 'PAP']);
    expect(extractFields('PAPILOMAVIRUS').types).toBeUndefined();
  });
});

describe('extractFields: doctor', () => {
  it('OCR of a signature supplies the professional, without accepting other footer text', () => {
    expect(extractSignatureDoctor('Dra. Ana Ejemplo\nM.N. 123456 M.P. 654321')).toBe('Dra. Ana Ejemplo');
    expect(extractSignatureDoctor('El presente informe fue realizado por el médico\nPágina 1')).toBeUndefined();
    expect(extractSignatureDoctor('Dra. Ana Ejemplo\nDr. Juan Prueba')).toBeUndefined();
  });

  it('the doctor in the header takes priority over the doctor who signs the report', () => {
    for (const header of [
      'Dr./a PEREZ ANA',
      'Dr./a: PEREZ ANA',
      'Dr./Dra.: PEREZ ANA',
      'Médico: PEREZ ANA',
      'Médico solicitante: PEREZ ANA',
      'Profesional tratante: PEREZ ANA',
    ]) {
      const text = [header, 'Fecha: 18/03/2024', 'Firmado por: Dra. Julia Ejemplo', 'M.N. 123456'].join('\n');
      expect(extractFields(text).doctor, header).toBe('PEREZ ANA');
    }
    expect(extractFields('Dra. Ana Pérez\nFirmado por: Dra. Julia Ejemplo').doctor).toBe('Dra. Ana Pérez');
  });

  it('a signature remains a fallback when the header does not name a doctor', () => {
    expect(extractFields('Fecha: 18/03/2024\nFirmado por: Dra. Julia Ejemplo').doctor).toBe('Dra. Julia Ejemplo');
    expect(extractFields('Dra. Julia Ejemplo\nM.N. 123456').doctor).toBe('Dra. Julia Ejemplo');
    expect(extractFields('Dr./a\nFecha: 18/03/2024').doctor).toBeUndefined();
    expect(extractFields('Médico:\nEcografía abdominal').doctor).toBeUndefined();
  });

  it('conflicting header names are left for the user to review', () => {
    expect(extractFields('Dr./a PEREZ ANA\nDr./a LOPEZ JUAN\nFirmado por: Dra. Julia Ejemplo').doctor).toBeUndefined();
  });
});

describe('signatureImages', () => {
  it('follows nested transforms and ignores logos and full-page scans', () => {
    const { OPS } = pdfjs;
    const operations: Array<[number, unknown?]> = [
      [OPS.save],
      [OPS.transform, [100, 0, 0, 40, 20, 730]],
      [OPS.paintImageXObject, ['logo', 100, 40]],
      [OPS.restore],
      [OPS.save],
      [OPS.transform, [600, 0, 0, 800, 0, 0]],
      [OPS.paintImageXObject, ['scan', 600, 800]],
      [OPS.restore],
      [OPS.save],
      [OPS.transform, [1, 0, 0, 1, 50, 200]],
      [OPS.save],
      [OPS.transform, [180, 0, 0, 100, 0, 0]],
      [OPS.paintImageXObject, ['signature', 240, 140]],
      [OPS.restore],
      [OPS.transform, [-80, 0, 0, 30, 300, 50]],
      [OPS.paintInlineImageXObject, [{}]],
      [OPS.restore],
    ];

    const regions = signatureImages(
      { fnArray: operations.map(([op]) => op), argsArray: operations.map(([, args]) => args ?? null) },
      pdfjs,
      [0, 0, 600, 800]
    );

    expect(regions).toEqual([
      [50, 200, 230, 300],
      [270, 250, 350, 280],
    ]);
  });
});
