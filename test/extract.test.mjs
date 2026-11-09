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
    'Dr./a PROFESIONAL SOLICITANTE',
    'Fecha: 18/03/2024 Orden: 123456789',
    'MAMOGRAFIA BILATERAL CON PROLONGACION AXILAR',
    'ESTUDIO REALIZADO CON MAMOGRAFO FULL DIGITAL',
    'ECOGRAFIA MAMARIA BILATERAL Y REGIONES AXILARES',
  ].join('\n'));
  assert.deepEqual(found, { date: '2024-03-18', types: ['Mamografía', 'Ecografía'] });
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

test('OCR of a signature supplies the professional, without accepting other footer text', () => {
  assert.equal(extractSignatureDoctor('Dra. Ana Ejemplo\nM.N. 123456 M.P. 654321'), 'Dra. Ana Ejemplo');
  assert.equal(extractSignatureDoctor('El presente informe fue realizado por el médico\nPágina 1'), undefined);
  assert.equal(extractSignatureDoctor('Dra. Ana Ejemplo\nDr. Juan Prueba'), undefined);
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
