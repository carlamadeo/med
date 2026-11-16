import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
    testDir: './test/e2e',
    testMatch: 'offline-shell.spec.ts',
    use: {baseURL: 'http://localhost:4187/med/', ...devices['Desktop Chrome']},
    webServer: {
        command: 'npm run preview -- --port 4187 --strictPort --base /med/',
        url: 'http://localhost:4187/med/',
        reuseExistingServer: false
    },
});
