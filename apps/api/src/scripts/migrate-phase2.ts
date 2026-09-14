import { ensureTable, dynamo } from '../db.js';
import { migratePhase2 } from '../migrations/phase2.js';

await ensureTable();
const result = await migratePhase2(dynamo());
console.log(
  `Phase 2 migration complete: ${result.organizationsUpdated} organization booking policies added; ${result.waitlistsIndexed} waitlists indexed.`,
);
