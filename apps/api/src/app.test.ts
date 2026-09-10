import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { MemoryRepository } from './db.js';
describe('HTTP boundary', () => {
  it('returns health and stable unauthorized errors', async () => {
    const app = createApp(new MemoryRepository());
    expect((await app.request('/health')).status).toBe(200);
    const response = await app.request('/courts');
    expect(response.status).toBe(401);
    const payload = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(payload.error.code).toBe('UNAUTHORIZED');
    expect(payload.error.message).not.toContain('Dynamo');
  });
});
