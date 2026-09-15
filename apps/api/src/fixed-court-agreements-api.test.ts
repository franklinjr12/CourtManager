import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { MemoryRepository } from './db.js';
import { hashPassword } from './security.js';

describe('fixed court agreement API', () => {
  it('lets staff preview, create, inspect, bill, and pause an agreement', async () => {
    const repo = new MemoryRepository();
    const organizationId = 'org-api-fixed-court';
    await repo.put({
      PK: `ORG#${organizationId}`,
      SK: 'META',
      entity: 'organization',
      organizationId,
      name: 'Arena',
      currency: 'BRL',
      timezone: 'UTC',
    });
    await repo.put({
      PK: `ORG#${organizationId}`,
      SK: 'USER#staff-fixed-court',
      entity: 'user',
      userId: 'staff-fixed-court',
      organizationId,
      name: 'Staff',
      email: 'staff-fixed-court@arena.test',
      role: 'OWNER',
      active: true,
      passwordHash: await hashPassword('password'),
    });
    const app = createApp(repo);
    const login = await app.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'staff-fixed-court@arena.test',
        password: 'password',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const token = (await login.json()) as { data: { token: string } };
    const headers = {
      Authorization: `Bearer ${token.data.token}`,
      'Content-Type': 'application/json',
    };
    const openingHours = Object.fromEntries(
      [
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
        'SATURDAY',
        'SUNDAY',
      ].map((day) => [day, { open: '07:00', close: '23:00' }]),
    );
    const courtResponse = await app.request('/courts', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Court 1',
        sport: 'Tennis',
        slotMinutes: 30,
        defaultHourlyPrice: 80,
        publiclyRequestable: true,
        active: true,
        openingHours,
      }),
    });
    const court = (await courtResponse.json()) as {
      data: { courtId: string };
    };
    const customerResponse = await app.request('/customers', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'João', phone: '41999990000' }),
    });
    const customer = (await customerResponse.json()) as {
      data: { customerId: string };
    };
    const input = {
      courtId: court.data.courtId,
      customerId: customer.data.customerId,
      weekday: 'WEDNESDAY',
      startTime: '19:00',
      durationMinutes: 120,
      intervalWeeks: 1,
      startDate: '2027-01-06',
      endDate: '2027-02-20',
      monthlyPrice: 600,
    };
    const preview = await app.request('/fixed-court-agreements', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...input, preview: true }),
    });
    expect(preview.status).toBe(201);
    expect(
      ((await preview.json()) as { data: { conflicts: string[] } }).data
        .conflicts,
    ).toEqual([]);
    const create = await app.request('/fixed-court-agreements', {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    });
    expect(create.status).toBe(201);
    const agreement = (await create.json()) as {
      data: { agreementId: string; occurrences: unknown[] };
    };
    expect(agreement.data.occurrences).toHaveLength(7);
    const details = await app.request(
      `/fixed-court-agreements/${agreement.data.agreementId}`,
      { headers },
    );
    expect(details.status).toBe(200);
    expect(
      ((await details.json()) as { data: { occurrences: unknown[] } }).data
        .occurrences,
    ).toHaveLength(7);
    const billed = await app.request(
      `/fixed-court-agreements/${agreement.data.agreementId}/bill`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ periodStartDate: '2027-02-01' }),
      },
    );
    expect(billed.status).toBe(200);
    const paused = await app.request(
      `/fixed-court-agreements/${agreement.data.agreementId}/pause`,
      { method: 'POST', headers, body: JSON.stringify({}) },
    );
    expect(
      ((await paused.json()) as { data: { status: string } }).data.status,
    ).toBe('PAUSED');
  });
});
