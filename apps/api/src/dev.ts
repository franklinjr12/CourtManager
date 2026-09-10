import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { ensureTable, dynamo } from './db.js';
await ensureTable();
serve({
  fetch: createApp(dynamo()).fetch,
  port: Number(process.env.PORT ?? 8787),
  hostname: '0.0.0.0',
});
