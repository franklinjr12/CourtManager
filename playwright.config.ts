import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/support/global-setup.ts',
  workers: 1,
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'corepack pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
