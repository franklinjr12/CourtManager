import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { MemoryRepository } from './db.js';
import { hashPassword } from './security.js';

describe('plan management API', () => {
  it('exposes tenant-scoped CRUD and archive operations to staff', async () => {
    const repo = new MemoryRepository();
    await repo.put({
      PK: 'ORG#org-api-plans',
      SK: 'META',
      entity: 'organization',
      organizationId: 'org-api-plans',
      name: 'Arena',
      currency: 'BRL',
      timezone: 'UTC',
    });
    await repo.put({
      PK: 'ORG#org-api-plans',
      SK: 'USER#staff-api',
      entity: 'user',
      userId: 'staff-api',
      organizationId: 'org-api-plans',
      name: 'Staff',
      email: 'staff@arena.test',
      role: 'STAFF',
      active: true,
      passwordHash: await hashPassword('password'),
    });
    const app = createApp(repo);
    expect((await app.request('/plans')).status).toBe(401);
    const login = await app.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'staff@arena.test', password: 'password' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const token = (await login.json()) as { data: { token: string } };
    const headers = {
      Authorization: `Bearer ${token.data.token}`,
      'Content-Type': 'application/json',
    };
    const createdResponse = await app.request('/plans', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Court hours',
        basePrice: 500,
        benefits: [
          {
            type: 'COURT_TIME',
            period: 'MONTH',
            quantityType: 'FINITE',
            quantity: 240,
            unit: 'COURT_MINUTES',
          },
        ],
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      data: { planId: string; currency: string };
    };
    expect(created.data.currency).toBe('BRL');

    const listResponse = await app.request('/plans?status=ACTIVE', { headers });
    expect(listResponse.status).toBe(200);
    expect(
      ((await listResponse.json()) as { data: unknown[] }).data,
    ).toHaveLength(1);
    const archiveResponse = await app.request(
      `/plans/${created.data.planId}/archive`,
      { method: 'POST', headers },
    );
    expect(archiveResponse.status).toBe(200);
    expect(
      ((await archiveResponse.json()) as { data: { status: string } }).data
        .status,
    ).toBe('ARCHIVED');
  });
});
