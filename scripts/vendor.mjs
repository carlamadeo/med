// Copies the heavy browser-side libraries to public/vendor, where Vite serves them in dev and ships them in dist.
// Same files as the original scripts/build.mjs: pdf.js (legacy build), Tesseract and the Spanish language data.
// They are loaded by URL at runtime (workers, WASM, fonts, language data), so they are not part of the JS bundle.
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const at = (path) => join(root, path);
const target = join(root, 'public/vendor/');
const copy = (source, to) => cp(at(source), join(target, to), { recursive: true });
const pdf = 'node_modules/pdfjs-dist/';
const ocr = 'node_modules/tesseract.js/';
const core = 'node_modules/tesseract.js-core/';

await rm(target, { recursive: true, force: true });
await Promise.all(['pdf/', 'ocr/core/', 'ocr/lang/'].map((dir) => mkdir(join(target, dir), { recursive: true })));

const coreFiles = (await readdir(at(core))).filter((name) => /lstm\.wasm(?:\.js)?$/.test(name) || name === 'LICENSE');
await Promise.all([
  ...['pdf.min.mjs', 'pdf.worker.min.mjs'].map((file) => copy(pdf + 'legacy/build/' + file, 'pdf/' + file)),
  ...['cmaps', 'standard_fonts', 'wasm', 'iccs', 'LICENSE'].map((file) => copy(pdf + file, 'pdf/' + file)),
  ...['tesseract.esm.min.js', 'worker.min.js', 'worker.min.js.LICENSE.txt'].map((file) => copy(ocr + 'dist/' + file, 'ocr/' + file)),
  ...coreFiles.map((file) => copy(core + file, 'ocr/core/' + file)),
  copy('node_modules/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz', 'ocr/lang/spa.traineddata.gz'),
  copy('node_modules/@tesseract.js-data/spa/README.md', 'ocr/lang/README.md'),
]);
console.log('vendor assets ready in public/vendor');
