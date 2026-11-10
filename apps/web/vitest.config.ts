import { defineConfig } from 'vitest/config';

// Lets `vitest` run from apps/web (for example via `pnpm --filter`) with the
// same jsdom environment the root config provides.
export default defineConfig({
  test: {
    environment: 'jsdom',
    // Node 25+ ships a global localStorage stub that shadows jsdom's.
    poolOptions: {
      forks: { execArgv: ['--no-experimental-webstorage'] },
      threads: { execArgv: ['--no-experimental-webstorage'] },
    },
    setupFiles: ['../../vitest.setup.config.ts'],
    include: ['src/**/*.test.ts'],
  },
});
