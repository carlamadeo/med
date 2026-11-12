import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Same contract as the original scripts/build.mjs and the README: the OAuth client id comes from GOOGLE_CLIENT_ID.
const CLIENT_ID_PATTERN = /^\d+-[\w-]+\.apps\.googleusercontent\.com$/;
const clientId = (process.env.GOOGLE_CLIENT_ID ?? process.env.VITE_GOOGLE_CLIENT_ID ?? '').trim();

/** Publishing without a valid client id would ship an app that can never connect to Drive. */
function requireClientIdOnCI(): Plugin {
  return {
    name: 'require-google-client-id',
    apply: 'build',
    buildStart() {
      if (process.env.GITHUB_ACTIONS === 'true' && !CLIENT_ID_PATTERN.test(clientId)) {
        this.error('Configurá la variable GOOGLE_CLIENT_ID del repositorio.');
      }
    },
  };
}

/** Without a client id the Google script can never help, so (like the original build) it is not loaded. */
function dropGoogleScriptWithoutClientId(): Plugin {
  return {
    name: 'drop-google-script-without-client-id',
    apply: 'build',
    transformIndexHtml(html) {
      return clientId ? html : html.replace(/\s*<script src="https:\/\/accounts\.google\.com\/gsi\/client" defer><\/script>/, '');
    },
  };
}

export default defineConfig({
  // Relative URLs, like the original build, so the app can be hosted from any sub-path (GitHub Pages).
  base: './',
  plugins: [requireClientIdOnCI(), dropGoogleScriptWithoutClientId()],
  // Also expose GOOGLE_CLIENT_ID (not just VITE_*) to import.meta.env.
  envPrefix: ['VITE_', 'GOOGLE_CLIENT_ID'],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@core': resolve(__dirname, 'src/core'),
      '@domain': resolve(__dirname, 'src/domain'),
      '@data': resolve(__dirname, 'src/data'),
      '@presentation': resolve(__dirname, 'src/presentation'),
      '@workers': resolve(__dirname, 'src/workers'),
    },
  },
  build: {
    target: 'es2022',
    minify: 'esbuild',
    cssCodeSplit: true,
    modulePreload: { polyfill: true },
    rollupOptions: {
      // pdf.js and Tesseract are loaded from vendor/ by URL (see scripts/vendor.mjs), not bundled.
      output: { manualChunks: { preact: ['preact', '@preact/signals'] } },
    },
  },
  // http://localhost:4173 is the origin the README tells users to authorize in Google Cloud.
  server: { port: 4173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  worker: { format: 'es' },
  publicDir: 'public',
});
