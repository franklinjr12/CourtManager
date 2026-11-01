import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { MemoryRepository } from './db.js';
import { hashPassword } from './security.js';
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

describe('DynamoDB error mapping', () => {
  it('returns the standard 500 body without DynamoDB wording for rejected transactions', async () => {
    const repo = new MemoryRepository();
    await repo.put({
      PK: 'ORG#org-err',
      SK: 'META',
      entity: 'organization',
      organizationId: 'org-err',
      name: 'Arena',
      currency: 'BRL',
      timezone: 'UTC',
    });
    await repo.put({
      PK: 'ORG#org-err',
      SK: 'USER#staff-err',
      entity: 'user',
      userId: 'staff-err',
      organizationId: 'org-err',
      name: 'Staff',
      email: 'staff-err@arena.test',
      role: 'OWNER',
      active: true,
      passwordHash: await hashPassword('password'),
    });
    const app = createApp(repo);
    const login = await app.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'staff-err@arena.test',
        password: 'password',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const token = (await login.json()) as { data: { token: string } };
    const headers = {
      Authorization: `Bearer ${token.data.token}`,
      'Content-Type': 'application/json',
    };
    const day = { open: '07:00', close: '23:00' };
    const court = (await (
      await app.request('/courts', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'Court 1',
          sport: 'Tennis',
          slotMinutes: 30,
          defaultHourlyPrice: 80,
          publiclyRequestable: true,
          active: true,
          openingHours: Object.fromEntries(
            [
              'MONDAY',
              'TUESDAY',
              'WEDNESDAY',
              'THURSDAY',
              'FRIDAY',
              'SATURDAY',
              'SUNDAY',
            ].map((name) => [name, day]),
          ),
        }),
      })
    ).json()) as { data: { courtId: string } };
    const customer = (await (
      await app.request('/customers', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Ana', phone: '41999991234' }),
      })
    ).json()) as { data: { customerId: string } };
    const created = (await (
      await app.request('/reservations', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          courtId: court.data.courtId,
          customerId: customer.data.customerId,
          startAt: '2027-01-04T10:00:00Z',
          endAt: '2027-01-04T11:00:00Z',
          source: 'STAFF',
        }),
      })
    ).json()) as { data: { reservationId: string } };
    vi.spyOn(repo, 'transactWrite').mockRejectedValue(
      Object.assign(new Error('Transaction request is invalid'), {
        name: 'ValidationException',
      }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await app.request(
      `/reservations/${created.data.reservationId}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          startAt: '2027-01-04T11:00:00Z',
          endAt: '2027-01-04T12:00:00Z',
        }),
      },
    );
    expect(response.status).toBe(500);
    const payload = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(payload.error.code).toBe('INTERNAL_ERROR');
    expect(payload.error.message).not.toContain('DynamoDB');
  });
});
