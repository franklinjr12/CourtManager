import { dynamo, ensureTable } from '../db.js';
import { migratePhase3 } from '../migrations/phase3.js';

await ensureTable();
const result = await migratePhase3(dynamo());
console.log(
  `Phase 3 migration complete: ${result.indexesCreated} indexes created (${result.financialIndexesCreated} financial).`,
);
