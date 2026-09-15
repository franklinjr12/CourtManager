import { dynamo, ensureTable } from '../db.js';
import { reconcileCommercial } from '../services/commercial-reconciliation.js';

await ensureTable();
const result = await reconcileCommercial(dynamo());
console.log(`Commercial reconciliation complete: ${JSON.stringify(result)}`);
