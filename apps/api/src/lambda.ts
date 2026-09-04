import { handle } from 'hono/aws-lambda';
import { createApp } from './app.js';
import { dynamo } from './db.js';
export const handler=handle(createApp(dynamo()));
