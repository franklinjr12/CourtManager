import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { MemoryRepository } from './db.js';
import { hashPassword } from './security.js';

describe('membership management API', () => {
  it('allows staff to assign, update, pause, resume, and cancel memberships', async () => {
    const repo = new MemoryRepository();
    await repo.put({
      PK: 'ORG#org-api-memberships',
      SK: 'META',
      entity: 'organization',
      organizationId: 'org-api-memberships',
      name: 'Arena',
      currency: 'BRL',
      timezone: 'UTC',
    });
    await repo.put({
      PK: 'ORG#org-api-memberships',
      SK: 'USER#staff-memberships',
      entity: 'user',
      userId: 'staff-memberships',
      organizationId: 'org-api-memberships',
      name: 'Staff',
      email: 'staff-memberships@arena.test',
      role: 'STAFF',
      active: true,
      passwordHash: await hashPassword('password'),
    });
    const app = createApp(repo);
    const login = await app.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'staff-memberships@arena.test',
        password: 'password',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const token = (await login.json()) as { data: { token: string } };
    const headers = {
      Authorization: `Bearer ${token.data.token}`,
      'Content-Type': 'application/json',
    };
    const customerResponse = await app.request('/customers', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Maria', phone: '41999990000' }),
    });
    const customer = (await customerResponse.json()) as {
      data: { customerId: string };
    };
    const planResponse = await app.request('/plans', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Monthly classes',
        basePrice: 300,
        benefits: [
          {
            type: 'CLASS_ATTENDANCE',
            period: 'MONTH',
            quantityType: 'FINITE',
            quantity: 8,
            unit: 'SESSION',
          },
        ],
      }),
    });
    const plan = (await planResponse.json()) as { data: { planId: string } };
    const startDate = new Date().toISOString().slice(0, 10);
    const createResponse = await app.request('/memberships', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        customerId: customer.data.customerId,
        planId: plan.data.planId,
        startDate,
        price: 270,
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      data: { membershipId: string; price: number; currentPeriodId: string };
    };
    expect(created.data.price).toBe(270);
    expect(created.data.currentPeriodId).toBeTruthy();

    const patchResponse = await app.request(
      `/memberships/${created.data.membershipId}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ price: 275 }),
      },
    );
    expect(patchResponse.status).toBe(200);
    expect(
      ((await patchResponse.json()) as { data: { price: number } }).data.price,
    ).toBe(275);

    expect(
      (
        await app.request(`/memberships/${created.data.membershipId}/pause`, {
          method: 'POST',
          headers,
        })
      ).status,
    ).toBe(200);
    const paused = await app.request(
      `/memberships/${created.data.membershipId}`,
      { headers },
    );
    expect(
      ((await paused.json()) as { data: { status: string } }).data.status,
    ).toBe('PAUSED');
    expect(
      (
        await app.request(`/memberships/${created.data.membershipId}/resume`, {
          method: 'POST',
          headers,
        })
      ).status,
    ).toBe(200);

    const periods = await app.request(
      `/memberships/${created.data.membershipId}/periods`,
      { headers },
    );
    expect(periods.status).toBe(200);
    expect(((await periods.json()) as { data: unknown[] }).data).toHaveLength(
      1,
    );

    const cancel = await app.request(
      `/memberships/${created.data.membershipId}/cancel`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ effectiveDate: startDate }),
      },
    );
    expect(cancel.status).toBe(200);
    expect(
      ((await cancel.json()) as { data: { status: string } }).data.status,
    ).toBe('CANCELLED');
  });
});
