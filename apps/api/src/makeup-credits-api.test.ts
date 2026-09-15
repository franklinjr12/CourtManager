import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { MemoryRepository } from './db.js';
import { hashPassword } from './security.js';
import { classFixture } from './testing/class-fixture.js';

describe('makeup credit API', () => {
  it('lets staff grant a credit and lets the customer read its history', async () => {
    const repo = new MemoryRepository();
    const { services, owner, ctx, classId, slug } = await classFixture(repo);
    await repo.put({
      PK: `ORG#${owner.organizationId}`,
      SK: 'USER#owner',
      entity: 'user',
      organizationId: owner.organizationId,
      userId: 'owner',
      name: 'Owner',
      email: 'owner@example.test',
      role: 'OWNER',
      active: true,
      passwordHash: await hashPassword('password'),
    });
    const app = createApp(repo);
    const login = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'owner@example.test',
        password: 'password',
      }),
    });
    const staffToken = ((await login.json()) as { data: { token: string } })
      .data.token;
    const headers = {
      Authorization: `Bearer ${staffToken}`,
      'Content-Type': 'application/json',
    };
    const issued = await app.request(
      `/customers/${ctx.customerId}/makeup-credits`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          originClassId: classId,
          originSessionId: `${classId}-2099-01-05`,
          reason: 'STAFF_GRANTED',
          idempotencyKey: 'api-makeup-1',
        }),
      },
    );
    expect(issued.status).toBe(201);
    const credit = (await issued.json()) as {
      data: { makeupCreditId: string; originSessionId: string };
    };
    expect(credit.data.originSessionId).toBe(`${classId}-2099-01-05`);

    const customerLogin = await services.customerAuth.login(
      slug,
      'ana@example.test',
      'class-password',
    );
    const history = await app.request('/customer/makeup-credits', {
      headers: { Authorization: `Bearer ${customerLogin.token}` },
    });
    expect(history.status).toBe(200);
    expect(((await history.json()) as { data: unknown[] }).data).toHaveLength(
      1,
    );
  });
});
