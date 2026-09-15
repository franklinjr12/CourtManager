import { defineConfig } from 'vitest/config';

const phase3Domain = [
  'apps/api/src/services/plans.ts',
  'apps/api/src/services/memberships.ts',
  'apps/api/src/services/membership-charges.ts',
  'apps/api/src/services/packages.ts',
  'apps/api/src/services/entitlements.ts',
  'apps/api/src/services/reservation-entitlements.ts',
  'apps/api/src/services/class-entitlements.ts',
  'apps/api/src/services/makeup-credits.ts',
  'apps/api/src/services/fixed-court-agreements.ts',
  'apps/api/src/services/customer-commercial-balance.ts',
  'apps/api/src/services/commercial-evaluation.ts',
  'apps/api/src/services/commercial-reporting.ts',
  'apps/api/src/services/commercial-reconciliation.ts',
  'apps/api/src/services/commercial-activity-events.ts',
  'apps/api/src/services/customer-portal/commercial.ts',
];

const phase3Orchestration = [
  'apps/api/src/persistence/phase3-repository.ts',
  'apps/api/src/persistence/phase3-keys.ts',
  'apps/api/src/migrations/phase3.ts',
];

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    exclude: ['**/integration/**', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: [...phase3Domain, ...phase3Orchestration],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        '**/node_modules/**',
        '**/dist/**',
      ],
      thresholds: {
        ...Object.fromEntries(
          phase3Domain.flatMap((file) => [
            [`${file}:statements`, 100],
            [`${file}:functions`, 100],
            [`${file}:lines`, 100],
            [`${file}:branches`, 90],
          ]),
        ),
        ...Object.fromEntries(
          phase3Orchestration.flatMap((file) => [
            [`${file}:statements`, 95],
            [`${file}:functions`, 95],
            [`${file}:lines`, 95],
            [`${file}:branches`, 90],
          ]),
        ),
      },
    },
  },
});
