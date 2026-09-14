import { dynamo, ensureTable } from '../db.js';
import { migrateClassDiscovery } from '../migrations/class-discovery.js';
await ensureTable();
console.log(await migrateClassDiscovery(dynamo()));
