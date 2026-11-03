import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { MemoryRepository } from './db.js';
import {
  organizationChargeIndex,
  organizationPaymentIndex,
} from './persistence/operational-keys.js';
import { hashPassword } from './security.js';

describe('commercial reporting API', () => {
  it('returns tenant-scoped commercial metrics with local date boundaries', async () => {
    const repo = new MemoryRepository();
    await repo.put({
      PK: 'ORG#org-reports',
      SK: 'META',
      entity: 'organization',
      organizationId: 'org-reports',
      name: 'Arena',
      currency: 'BRL',
      timezone: 'America/Sao_Paulo',
    });
    await repo.put({
      PK: 'ORG#org-reports',
      SK: 'USER#owner-reports',
      entity: 'user',
      organizationId: 'org-reports',
      userId: 'owner-reports',
      name: 'Owner',
      email: 'owner@reports.test',
      role: 'OWNER',
      active: true,
      passwordHash: await hashPassword('password'),
    });
    await repo.put({
      PK: 'MEMBERSHIP#membership-report',
      SK: 'META',
      entity: 'membership',
      organizationId: 'org-reports',
      membershipId: 'membership-report',
      planId: 'plan-report',
      planNameSnapshot: 'Report plan',
      status: 'ACTIVE',
      startDate: '2026-08-01',
    });
    await repo.put({
      PK: 'CHARGE#membership-charge-report',
      SK: 'META',
      entity: 'charge',
      organizationId: 'org-reports',
      customerId: 'customer-report',
      chargeId: 'membership-charge-report',
      sourceType: 'MEMBERSHIP',
      status: 'ACTIVE',
      amount: 300,
      serviceAt: '2026-09-30T23:30:00.000Z',
    });
    await repo.put({
      PK: 'PAYMENT#payment-report',
      SK: 'META',
      entity: 'payment',
      organizationId: 'org-reports',
      customerId: 'customer-report',
      paymentId: 'payment-report',
      chargeId: 'membership-charge-report',
      amount: 100,
      paidAt: '2026-10-01T02:30:00.000Z',
    });
    const app = createApp(repo);
    const login = await app.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'owner@reports.test',
        password: 'password',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const token = (await login.json()) as { data: { token: string } };
    const response = await app.request(
      '/reports/operations?from=2026-09-01&to=2026-09-30',
      { headers: { Authorization: `Bearer ${token.data.token}` } },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        timezone: string;
        membershipExpectedRevenue: number;
        membershipRecordedPayments: number;
        membershipOutstandingAmount: number;
      };
    };
    expect(body.data.timezone).toBe('America/Sao_Paulo');
    expect(body.data.membershipExpectedRevenue).toBe(300);
    expect(body.data.membershipRecordedPayments).toBe(100);
    expect(body.data.membershipOutstandingAmount).toBe(200);
  });

  it('nets all linked payments from outstanding, matching finance (J-4)', async () => {
    const repo = new MemoryRepository();
    await repo.put({
      PK: 'ORG#org-j4',
      SK: 'META',
      entity: 'organization',
      organizationId: 'org-j4',
      name: 'Arena',
      currency: 'BRL',
      timezone: 'America/Sao_Paulo',
    });
    await repo.put({
      PK: 'ORG#org-j4',
      SK: 'USER#owner-j4',
      entity: 'user',
      organizationId: 'org-j4',
      userId: 'owner-j4',
      name: 'Owner',
      email: 'owner@j4.test',
      role: 'OWNER',
      active: true,
      passwordHash: await hashPassword('password'),
    });
    const charge = async (id: string, amount: number, serviceAt: string) => {
      const value = {
        organizationId: 'org-j4',
        customerId: 'customer-j4',
        chargeId: id,
        sourceType: 'RESERVATION',
        reservationId: `res-${id}`,
        status: 'ACTIVE',
        amount,
        serviceAt,
      };
      await repo.put({
        PK: `CHARGE#${id}`,
        SK: 'META',
        entity: 'charge',
        ...value,
      });
      await repo.put(organizationChargeIndex(value));
    };
    const payment = async (
      id: string,
      chargeId: string,
      amount: number,
      paidAt: string,
    ) => {
      const value = {
        organizationId: 'org-j4',
        customerId: 'customer-j4',
        paymentId: id,
        chargeId,
        amount,
        paidAt,
      };
      await repo.put({
        PK: `PAYMENT#${id}`,
        SK: 'META',
        entity: 'payment',
        ...value,
      });
      await repo.put(organizationPaymentIndex(value));
    };
    await charge('j4', 160, '2026-10-15T13:00:00.000Z');
    await payment('pay-before', 'j4', 80, '2026-09-20T12:00:00.000Z');
    await charge('other', 100, '2026-09-10T13:00:00.000Z');
    await payment('pay-in-range', 'other', 30, '2026-10-05T12:00:00.000Z');
    const app = createApp(repo);
    const login = await app.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'owner@j4.test', password: 'password' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const token = (await login.json()) as { data: { token: string } };
    const headers = { Authorization: `Bearer ${token.data.token}` };
    const report = (await (
      await app.request('/reports/operations?from=2026-10-01&to=2026-10-31', {
        headers,
      })
    ).json()) as { data: Record<string, number> };
    const finance = (await (
      await app.request('/finance/summary?from=2026-10-01&to=2026-10-31', {
        headers,
      })
    ).json()) as { data: Record<string, number> };
    expect(report.data.expectedRevenue).toBe(160);
    expect(report.data.outstanding).toBe(80);
    expect(report.data.paymentsRecordedInPeriod).toBe(30);
    expect(report.data.recordedPayments).toBe(30);
    expect(finance.data.outstanding).toBe(report.data.outstanding);
  });
});
