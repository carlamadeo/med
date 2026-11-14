import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
    testDir: './test/e2e',
    testMatch: 'offline-shell.spec.ts',
    use: {baseURL: 'http://localhost:4187', ...devices['Desktop Chrome']},
    webServer: {
        command: 'npm run preview -- --port 4187 --strictPort',
        url: 'http://localhost:4187',
        reuseExistingServer: false
    },
});
