import {defineConfig, type Plugin} from 'vite';
import {resolve} from 'path';
import {fileURLToPath} from 'url';
import {readFileSync} from 'fs';
import {createHash, randomBytes} from 'crypto';

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

/** Vite injects HMR styles; give those styles a fresh nonce only in the local dev server. */
function devStyleNonce(): Plugin {
    return {
        name: 'dev-style-nonce',
        apply: 'serve',
        transformIndexHtml: {
            order: 'pre',
            handler(html) {
                const nonce = randomBytes(18).toString('base64');
                return html.replace('<head>', `<head><meta property="csp-nonce" nonce="${nonce}">`)
                    .replace("style-src 'self'", `style-src 'self' 'nonce-${nonce}'`);
            },
        },
    };
}

function offlineShell(): Plugin {
    return {
        name: 'offline-shell',
        apply: 'build',
        generateBundle(_options, bundle) {
            const assets = ['index.html', 'types.json', 'icon.svg', ...Object.keys(bundle).filter((name) => name.startsWith('assets/'))].sort();
            const template = readFileSync(resolve(__dirname, 'src/core/service-worker.template'), 'utf8');
            const version = createHash('sha256').update(JSON.stringify(assets)).update(template).update(readFileSync(resolve(__dirname, 'index.html'))).update(readFileSync(resolve(__dirname, 'public/types.json'))).update(readFileSync(resolve(__dirname, 'public/icon.svg'))).update(readFileSync(resolve(__dirname, 'package-lock.json'))).update(clientId).digest('hex').slice(0, 16);
            const source = template.replace('__CACHE_NAME__', '`mis-estudios-shell:${new URL(self.registration.scope).pathname}:' + version + '`').replace('__ASSETS__', JSON.stringify(assets));
            this.emitFile({type: 'asset', fileName: 'sw.js', source});
        },
    };
}

export default defineConfig({
    // Relative URLs, like the original build, so the app can be hosted from any sub-path (GitHub Pages).
    base: './',
    plugins: [requireClientIdOnCI(), dropGoogleScriptWithoutClientId(), devStyleNonce(), offlineShell()],
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
        minify: true,
        cssCodeSplit: true,
        modulePreload: {polyfill: true},
        rollupOptions: {
            // pdf.js and Tesseract are loaded from vendor/ by URL (see scripts/vendor.mjs), not bundled.
            output: {manualChunks: (id) => /node_modules\/(?:preact|@preact\/signals)/.test(id) ? 'preact' : undefined},
        },
    },
    // http://localhost:4173 is the origin the README tells users to authorize in Google Cloud.
    server: {port: 4173, strictPort: true},
    preview: {port: 4173, strictPort: true},
    worker: {format: 'es'},
    publicDir: 'public',
});
