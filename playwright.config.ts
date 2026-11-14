import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
    testDir: './test/e2e',
    testIgnore: ['offline-shell.spec.ts', 'outbox.spec.ts', 'navigation.spec.ts'],
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    use: {
        baseURL: 'http://localhost:4189',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: {...devices['Desktop Chrome']},
        },
        {
            name: 'mobile-chrome',
            use: {...devices['Pixel 5']},
        },
        {
            name: 'mobile-safari',
            use: {...devices['iPhone 15']},
        },
    ],
    webServer: {
        // A dedicated port avoids reusing an unrelated development server.
        command: 'npm run dev -- --port 4189 --strictPort',
        url: 'http://localhost:4189',
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
    },
});
