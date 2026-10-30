import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'jsdom',
    // Node 25+ ships a global localStorage stub that shadows jsdom's.
    poolOptions: {
      forks: { execArgv: ['--no-experimental-webstorage'] },
      threads: { execArgv: ['--no-experimental-webstorage'] },
    },
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    exclude: ['**/integration/**', '**/node_modules/**'],
    // Node 25+ ships a native localStorage global that shadows jsdom's.
    poolOptions: {
      forks: { execArgv: ['--no-experimental-webstorage'] },
    },
  },
});
