import { ensureTable } from './apps/api/src/db.js';

export default async function setup() {
  await ensureTable();
}
