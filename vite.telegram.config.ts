import {defineConfig} from 'vite';

export default defineConfig({
    publicDir: false,
    resolve: {tsconfigPaths: true},
    build: {
        ssr: 'src/bot/main.ts',
        outDir: '.data/telegram-build',
        emptyOutDir: true,
        target: 'node24',
        rollupOptions: {output: {entryFileNames: 'telegram.mjs'}},
    },
});
