import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'jsdom', include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'], exclude: ['**/integration/**', '**/node_modules/**'] } });
