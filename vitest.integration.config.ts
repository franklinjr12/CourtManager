import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./vitest.integration-global-setup.config.ts'],
    include: ['apps/**/integration/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    testTimeout: 30000,
  },
});
