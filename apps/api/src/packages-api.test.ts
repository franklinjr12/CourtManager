import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { MemoryRepository } from './db.js';
import { hashPassword } from './security.js';

describe('package management API', () => {
  it('allows staff to create, issue, list, and cancel customer packages', async () => {
    const repo = new MemoryRepository();
    await repo.put({
      PK: 'ORG#org-api-packages',
      SK: 'META',
      entity: 'organization',
      organizationId: 'org-api-packages',
      name: 'Arena',
      currency: 'BRL',
      timezone: 'UTC',
    });
    await repo.put({
      PK: 'ORG#org-api-packages',
      SK: 'USER#staff-packages',
      entity: 'user',
      userId: 'staff-packages',
      organizationId: 'org-api-packages',
      name: 'Staff',
      email: 'staff-packages@arena.test',
      role: 'STAFF',
      active: true,
      passwordHash: await hashPassword('password'),
    });
    const app = createApp(repo);
    const login = await app.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'staff-packages@arena.test',
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
    const definitionResponse = await app.request('/package-definitions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Court hours',
        price: 700,
        validityDays: 90,
        benefits: [
          {
            type: 'COURT_TIME',
            period: 'PACKAGE_LIFETIME',
            quantityType: 'FINITE',
            quantity: 600,
            unit: 'COURT_MINUTES',
          },
        ],
      }),
    });
    expect(definitionResponse.status).toBe(201);
    const definition = (await definitionResponse.json()) as {
      data: { packageDefinitionId: string };
    };
    const issuedResponse = await app.request(
      `/customers/${customer.data.customerId}/packages`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          packageDefinitionId: definition.data.packageDefinitionId,
          issuedAt: '2026-09-10T12:00:00.000Z',
          idempotencyKey: 'api-sale-1',
        }),
      },
    );
    expect(issuedResponse.status).toBe(201);
    const issued = (await issuedResponse.json()) as {
      data: { customerPackageId: string; expiresAt?: string };
    };
    expect(issued.data.expiresAt).toBe('2026-12-09T12:00:00.000Z');
    const listed = await app.request(
      `/customers/${customer.data.customerId}/packages`,
      { headers },
    );
    expect(((await listed.json()) as { data: unknown[] }).data).toHaveLength(1);
    const charges = await app.request('/charges?sourceType=PACKAGE', {
      headers,
    });
    expect(
      ((await charges.json()) as { data: Array<{ sourceId: string }> }).data[0]
        ?.sourceId,
    ).toBe(issued.data.customerPackageId);
    const cancelled = await app.request(
      `/customer-packages/${issued.data.customerPackageId}/cancel`,
      { method: 'POST', headers },
    );
    expect(
      ((await cancelled.json()) as { data: { status: string } }).data.status,
    ).toBe('CANCELLED');
  });
});
