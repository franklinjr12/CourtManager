import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/**/integration/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    testTimeout: 30000,
  },
});
