import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './test/e2e',
  testMatch: ['outbox.spec.ts', 'navigation.spec.ts'],
  use: { baseURL: 'http://localhost:4188' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] }, timeout: 60000 },
    { name: 'mobile-safari', use: { ...devices['iPhone 15'] }, timeout: 60000 },
  ],
  webServer: { command: 'VITE_GOOGLE_CLIENT_ID=123-test.apps.googleusercontent.com npm run dev -- --port 4188 --strictPort', url: 'http://localhost:4188', reuseExistingServer: false, timeout: 120000 },
});
