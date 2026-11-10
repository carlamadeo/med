import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { signatureImages } from '../web/detect.js';
import { extractFields, extractSignatureDoctor } from '../web/extract.js';
import { readFile } from 'node:fs/promises';

test('a breast report supplies its date and both types without using the birth date', async () => {
  const found = extractFields([
    'Sr./a APELLIDO, PACIENTE',
    'Fecha de Nac: 12/07/1980',
    'Dr./a PEREZ ANA',
    'Fecha: 18/03/2024 Orden: 123456789',
    'MAMOGRAFIA BILATERAL CON PROLONGACION AXILAR',
    'ESTUDIO REALIZADO CON MAMOGRAFO FULL DIGITAL',
    'ECOGRAFIA MAMARIA BILATERAL Y REGIONES AXILARES',
  ].join('\n'));
  assert.deepEqual(found, { date: '2024-03-18', types: ['Mamografía', 'Ecografía'], doctor: 'PEREZ ANA' });
  const types = JSON.parse(await readFile(new URL('../web/types.json', import.meta.url), 'utf8'));
  assert.ok(found.types.every((type) => types.includes(type)));
});

test('a single modality and an explicit study type keep their existing priority', () => {
  assert.deepEqual(extractFields('MAMOGRAFIA BILATERAL').types, ['Mamografía']);
  assert.deepEqual(extractFields('ECOGRAFÍA MAMARIA').types, ['Ecografía']);
  assert.deepEqual(extractFields('Estudio: Mamografía bilateral\nEcografía previa').types, ['Mamografía']);
});

test('multiple types are kept individually and repeated headings do not duplicate them', () => {
  assert.deepEqual(extractFields('RADIOGRAFIA DE TORAX\nECOGRAFIA ABDOMINAL').types, ['Radiografía', 'Ecografía']);
  assert.deepEqual(extractFields('MAMOGRAFIA\nECOGRAFIA\nRESONANCIA MAGNETICA\nECOGRAFIA').types,
    ['Mamografía', 'Ecografía', 'Resonancia magnética']);
  assert.equal(extractFields('Informe sin tipo identificable').types, undefined);
});

test('specific study types are detected without also selecting their broader category', async () => {
  const types = JSON.parse(await readFile(new URL('../web/types.json', import.meta.url), 'utf8'));
  for (const [heading, expected] of [
    ['ECOGRAFÍA TV', 'Ecografía TV'],
    ['ECOGRAFIA TRANSVAGINAL', 'Ecografía TV'],
    ['COLONOSCOPIA', 'Colonoscopía'],
    ['VIDEOCOLONOSCOPÍA', 'Colonoscopía'],
    ['PAP', 'PAP'],
    ['P.A.P.', 'PAP'],
    ['PAPANICOLAOU', 'PAP'],
  ]) {
    assert.ok(types.includes(expected));
    assert.deepEqual(extractFields(heading).types, [expected], heading);
  }
  assert.deepEqual(extractFields('ECOGRAFIA ABDOMINAL\nECOGRAFIA TV\nPAP').types,
    ['Ecografía', 'Ecografía TV', 'PAP']);
  assert.equal(extractFields('PAPILOMAVIRUS').types, undefined);
});

test('OCR of a signature supplies the professional, without accepting other footer text', () => {
  assert.equal(extractSignatureDoctor('Dra. Ana Ejemplo\nM.N. 123456 M.P. 654321'), 'Dra. Ana Ejemplo');
  assert.equal(extractSignatureDoctor('El presente informe fue realizado por el médico\nPágina 1'), undefined);
  assert.equal(extractSignatureDoctor('Dra. Ana Ejemplo\nDr. Juan Prueba'), undefined);
});

test('the doctor in the header takes priority over the doctor who signs the report', () => {
  for (const header of ['Dr./a PEREZ ANA', 'Dr./a: PEREZ ANA', 'Dr./Dra.: PEREZ ANA',
    'Médico: PEREZ ANA', 'Médico solicitante: PEREZ ANA', 'Profesional tratante: PEREZ ANA']) {
    const text = [header, 'Fecha: 18/03/2024', 'Firmado por: Dra. Julia Ejemplo', 'M.N. 123456'].join('\n');
    assert.equal(extractFields(text).doctor, 'PEREZ ANA', header);
  }
  assert.equal(extractFields('Dra. Ana Pérez\nFirmado por: Dra. Julia Ejemplo').doctor, 'Dra. Ana Pérez');
});

test('a signature remains a fallback when the header does not name a doctor', () => {
  assert.equal(extractFields('Fecha: 18/03/2024\nFirmado por: Dra. Julia Ejemplo').doctor, 'Dra. Julia Ejemplo');
  assert.equal(extractFields('Dra. Julia Ejemplo\nM.N. 123456').doctor, 'Dra. Julia Ejemplo');
  assert.equal(extractFields('Dr./a\nFecha: 18/03/2024').doctor, undefined);
  assert.equal(extractFields('Médico:\nEcografía abdominal').doctor, undefined);
});

test('conflicting header names are left for the user to review', () => {
  assert.equal(extractFields('Dr./a PEREZ ANA\nDr./a LOPEZ JUAN\nFirmado por: Dra. Julia Ejemplo').doctor, undefined);
});

test('signature image crops follow nested transforms and ignore logos and full-page scans', () => {
  const { OPS } = pdfjs;
  const operations = [
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
  assert.deepEqual(signatureImages({
    fnArray: operations.map(([op]) => op),
    argsArray: operations.map(([, args]) => args ?? null),
  }, pdfjs, [0, 0, 600, 800]), [[50, 200, 230, 300], [270, 250, 350, 280]]);
});
