import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const at = (path) => new URL(path, root);
const copy = (source, target) => cp(at(source), at('dist/' + target), { recursive: true });
const pdf = 'node_modules/pdfjs-dist/';
const ocr = 'node_modules/tesseract.js/';
const core = 'node_modules/tesseract.js-core/';
const client = (process.env.GOOGLE_CLIENT_ID || '').trim();
if (process.env.GITHUB_ACTIONS === 'true' && !/^\d+-[\w-]+\.apps\.googleusercontent\.com$/.test(client)) {
  throw new Error('Configurá la variable GOOGLE_CLIENT_ID del repositorio.');
}

await rm(at('dist/'), { recursive: true, force: true });
await cp(at('web/'), at('dist/'), { recursive: true });
await mkdir(at('dist/vendor/pdf/'), { recursive: true });
await mkdir(at('dist/vendor/ocr/core/'), { recursive: true });
await mkdir(at('dist/vendor/ocr/lang/'), { recursive: true });

const coreFiles = (await readdir(at(core))).filter((name) => /lstm\.wasm(?:\.js)?$/.test(name) || name === 'LICENSE');
await Promise.all([
  ...['pdf.min.mjs', 'pdf.worker.min.mjs'].map((file) => copy(pdf + 'legacy/build/' + file, 'vendor/pdf/' + file)),
  ...['cmaps', 'standard_fonts', 'wasm', 'iccs', 'LICENSE'].map((file) => copy(pdf + file, 'vendor/pdf/' + file)),
  ...['tesseract.esm.min.js', 'worker.min.js', 'worker.min.js.LICENSE.txt'].map((file) => copy(ocr + 'dist/' + file, 'vendor/ocr/' + file)),
  ...coreFiles.map((file) => copy(core + file, 'vendor/ocr/core/' + file)),
  copy('node_modules/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz', 'vendor/ocr/lang/spa.traineddata.gz'),
  copy('node_modules/@tesseract.js-data/spa/README.md', 'vendor/ocr/lang/README.md'),
  writeFile(at('dist/config.js'), 'export const GOOGLE_CLIENT_ID = ' + JSON.stringify(client) + ';\n'),
  writeFile(at('dist/.nojekyll'), ''),
]);

const html = await readFile(at('dist/index.html'), 'utf8');
if (!client) await writeFile(at('dist/index.html'), html.replace(/\s*<script src="https:\/\/accounts.google.com\/gsi\/client" defer><\/script>/, ''));
