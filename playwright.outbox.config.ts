import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
    testDir: './test/e2e',
    testMatch: 'outbox.spec.ts',
    use: {baseURL: 'http://localhost:4193', ...devices['Desktop Chrome']},
    webServer: {
        command: 'npm run dev -- --port 4193 --strictPort',
        url: 'http://localhost:4193',
        reuseExistingServer: false,
        timeout: 120000,
        env: {...process.env, VITE_GOOGLE_CLIENT_ID: '123-test.apps.googleusercontent.com'},
    },
});
