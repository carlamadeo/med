import {defineConfig} from 'vitest/config';
import {resolve} from 'path';
import {fileURLToPath} from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/domain/**', 'src/data/**', 'src/core/**'],
            exclude: ['src/**/*.test.*', 'src/**/*.d.ts', 'src/domain/models.ts', 'src/domain/repository.ts'],
            thresholds: {
                lines: 80,
                functions: 80,
                branches: 70,
                statements: 80,
            },
        },
        // Read by src/core/config.ts through import.meta.env; must match the client-id format check.
        env: {VITE_GOOGLE_CLIENT_ID: '123456789-test.apps.googleusercontent.com'},
        setupFiles: ['./test/setup.ts'],
    },
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
});
