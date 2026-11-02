import { spawnSync } from 'node:child_process';

import { dynamo, ensureTable } from '../../../apps/api/src/db.js';

// Specs that call `login(page)` without credentials use the development seed
// owner (owner@arena.test). `seed:dev` skips when any organization already
// exists, and isolated-venue specs create organizations, so a reused local
// DynamoDB can end up without the seed owner. Seed on a fresh database and
// fail fast with an actionable message instead of 30s login timeouts.
export default async function globalSetup() {
  await ensureTable();
  const seed = spawnSync('corepack', ['pnpm', 'seed:dev'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (seed.status !== 0) throw new Error('e2e setup: seed:dev failed.');
  const owner = await dynamo().get({
    PK: 'ORG#seed-org',
    SK: 'USER#seed-owner',
  });
  if (!owner)
    throw new Error(
      'e2e setup: development seed owner owner@arena.test is missing because ' +
        'local DynamoDB already holds other organizations. Run ' +
        '`corepack pnpm reset:dev && corepack pnpm seed:dev`, restart ' +
        '`corepack pnpm dev` if it is running, then re-run the e2e suite.',
    );
}
