import { beforeAll, describe, expect, it } from 'vitest';
import { MemoryRepository } from '../db.js';
import {
  organizationChargeIndex,
  organizationExpenseIndex,
  organizationPaymentIndex,
} from '../persistence/operational-keys.js';
import { buildServices } from './index.js';

const owner = { organizationId: 'org1', userId: 'o', role: 'OWNER' as const };
const other = { organizationId: 'org2', userId: 'o2', role: 'OWNER' as const };
const range = { from: '2026-10-01', to: '2026-10-31' };

type Row = Record<string, unknown>;

async function seed(repo: MemoryRepository) {
  const customer = (org: string, id: string, name: string) =>
    repo.put({
      PK: `ORG#${org}`,
      SK: `CUSTOMER#${id}`,
      entity: 'customer',
      organizationId: org,
      customerId: id,
      name,
    });
  const charge = async (org: string, id: string, fields: Row) => {
    const value = {
      organizationId: org,
      chargeId: id,
      status: 'ACTIVE',
      sourceType: 'RESERVATION',
      ...fields,
    };
    await repo.put({
      PK: `CHARGE#${id}`,
      SK: 'META',
      entity: 'charge',
      ...value,
    });
    await repo.put(organizationChargeIndex(value));
  };
  const payment = async (org: string, id: string, fields: Row) => {
    const value = { organizationId: org, paymentId: id, ...fields };
    await repo.put({
      PK: `PAYMENT#${id}`,
      SK: 'META',
      entity: 'payment',
      ...value,
    });
    await repo.put(organizationPaymentIndex(value));
  };
  const expense = async (
    org: string,
    id: string,
    date: string,
    amount: number,
  ) => {
    const value = { organizationId: org, expenseId: id, date, amount };
    await repo.put({
      PK: `EXPENSE#${id}`,
      SK: 'META',
      entity: 'expense',
      ...value,
    });
    await repo.put(organizationExpenseIndex(value));
  };
  await customer('org1', 'cu1', 'Ana');
  await customer('org1', 'cu2', 'Bia');
  await customer('org2', 'cu1', 'Zed');
  // Range boundaries: 2026-10-01T00:00Z and 2026-10-31T23:30Z are both inside.
  await charge('org1', 'c1', {
    customerId: 'cu1',
    amount: 100,
    reservationId: 'r1',
    serviceAt: '2026-10-01T00:00:00.000Z',
  });
  await charge('org1', 'c2', {
    customerId: 'cu1',
    amount: 50,
    reservationId: 'r2',
    serviceAt: '2026-10-31T23:30:00.000Z',
  });
  await charge('org1', 'c3', {
    customerId: 'cu2',
    amount: 80,
    sourceType: 'CLASS',
    classId: 'cl1',
    serviceAt: '2026-10-10T13:00:00.000Z',
  });
  await charge('org1', 'c4', {
    customerId: 'cu2',
    amount: 40,
    status: 'VOID',
    reservationId: 'r4',
    serviceAt: '2026-10-12T13:00:00.000Z',
  });
  await charge('org1', 'c5', {
    customerId: 'cu1',
    amount: 60,
    reservationId: 'r5',
    serviceAt: '2026-09-15T13:00:00.000Z',
  });
  await payment('org1', 'p1', {
    customerId: 'cu1',
    chargeId: 'c1',
    amount: 100,
    paidAt: '2026-10-05T15:00:00.000Z',
  });
  // No chargeId: matches c2 through its reservation.
  await payment('org1', 'p2', {
    customerId: 'cu1',
    reservationId: 'r2',
    amount: 20,
    paidAt: '2026-10-21T15:00:00.000Z',
  });
  await payment('org1', 'p3', {
    customerId: 'cu1',
    chargeId: 'c5',
    amount: 25,
    paidAt: '2026-09-16T15:00:00.000Z',
  });
  await payment('org1', 'p4', {
    customerId: 'cu2',
    chargeId: 'c3',
    amount: 30,
    paidAt: '2026-11-02T15:00:00.000Z',
  });
  await expense('org1', 'e1', '2026-10-03', 70);
  await expense('org1', 'e2', '2026-10-31', 30);
  await expense('org1', 'e3', '2026-09-30', 15);
  await expense('org1', 'e4', '2026-11-01', 10);
  // Another organization, reusing ids that would collide if scoping leaked.
  await charge('org2', 'o2c', {
    customerId: 'cu1',
    amount: 999,
    reservationId: 'r2',
    serviceAt: '2026-10-05T13:00:00.000Z',
  });
  await payment('org2', 'o2p', {
    customerId: 'cu1',
    reservationId: 'r2',
    amount: 7,
    paidAt: '2026-10-05T15:00:00.000Z',
  });
  await expense('org2', 'o2e', '2026-10-05', 888);
}

describe('finance reads without table scans', () => {
  const repo = new MemoryRepository();
  const services = buildServices(repo);
  beforeAll(async () => {
    await seed(repo);
    repo.scan = () => {
      throw new Error('finance reads must not scan the table');
    };
  });
  const ids = (rows: Row[]) => rows.map((x) => x.chargeId).sort();

  it('lists charges with filters and per-charge payment totals', async () => {
    const all = (await services.charges.list(owner)) as Row[];
    expect(ids(all)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    const byId = new Map(all.map((x) => [x.chargeId, x]));
    expect(byId.get('c1')).toMatchObject({
      paidAmount: 100,
      outstanding: 0,
      paymentStatus: 'PAID',
      customerName: 'Ana',
    });
    expect(byId.get('c2')).toMatchObject({
      paidAmount: 20,
      outstanding: 30,
      paymentStatus: 'PARTIAL',
    });
    expect(byId.get('c3')).toMatchObject({ paidAmount: 30, outstanding: 50 });
    expect(byId.get('c4')).toMatchObject({
      paidAmount: 0,
      outstanding: 40,
      paymentStatus: 'UNPAID',
    });
    expect(byId.get('c5')).toMatchObject({ paidAmount: 25, outstanding: 35 });

    expect(ids((await services.charges.list(owner, range)) as Row[])).toEqual([
      'c1',
      'c2',
      'c3',
      'c4',
    ]);
    expect(
      ids((await services.charges.list(owner, { customerId: 'cu2' })) as Row[]),
    ).toEqual(['c3', 'c4']);
    expect(
      ids(
        (await services.charges.list(owner, { sourceType: 'CLASS' })) as Row[],
      ),
    ).toEqual(['c3']);
    expect(
      ids(
        (await services.charges.list(owner, {
          outstandingOnly: 'true',
        })) as Row[],
      ),
    ).toEqual(['c2', 'c3', 'c4', 'c5']);
    expect(
      ids(
        (await services.charges.list(owner, {
          ...range,
          outstandingOnly: 'true',
        })) as Row[],
      ),
    ).toEqual(['c2', 'c3', 'c4']);
    expect(
      ids((await services.charges.list(owner, { to: '2026-10-01' })) as Row[]),
    ).toEqual(['c1', 'c5']);
    expect(
      ids(
        (await services.charges.list(owner, { from: '2026-10-31' })) as Row[],
      ),
    ).toEqual(['c2']);
  });

  it('keeps the summary totals', async () => {
    expect(await services.charges.summary(owner, range)).toEqual({
      expectedRevenue: 230,
      recordedPayments: 120,
      outstanding: 80,
      expenses: 100,
    });
    expect(await services.charges.summary(owner)).toEqual({
      expectedRevenue: 290,
      recordedPayments: 175,
      outstanding: 115,
      expenses: 125,
    });
    expect(await services.charges.summary(other, range)).toEqual({
      expectedRevenue: 999,
      recordedPayments: 7,
      outstanding: 992,
      expenses: 888,
    });
  });

  it('keeps customer balances', async () => {
    expect(await services.charges.balances(owner)).toEqual([
      {
        customerId: 'cu1',
        customerName: 'Ana',
        charges: 210,
        payments: 145,
        outstanding: 65,
      },
      {
        customerId: 'cu2',
        customerName: 'Bia',
        charges: 80,
        payments: 30,
        outstanding: 50,
      },
    ]);
    expect(await services.charges.balances(other)).toEqual([
      {
        customerId: 'cu1',
        customerName: 'Zed',
        charges: 999,
        payments: 7,
        outstanding: 992,
      },
    ]);
  });

  it('gets one charge and rejects other organizations', async () => {
    expect(await services.charges.get(owner, 'c2')).toMatchObject({
      chargeId: 'c2',
      paidAmount: 20,
      outstanding: 30,
      paymentStatus: 'PARTIAL',
    });
    await expect(services.charges.get(other, 'c2')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('lists payments and expenses of the organization only', async () => {
    const payments = (await services.payments.list(owner)) as Row[];
    expect(payments.map((x) => x.paymentId).sort()).toEqual([
      'p1',
      'p2',
      'p3',
      'p4',
    ]);
    expect(payments.every((x) => x.organizationId === 'org1')).toBe(true);
    expect(
      (
        (await services.payments.list(owner, { customerId: 'cu2' })) as Row[]
      ).map((x) => x.paymentId),
    ).toEqual(['p4']);
    expect(
      ((await services.payments.list(other)) as Row[]).map((x) => x.paymentId),
    ).toEqual(['o2p']);
    const expenses = (await services.expenses.list(owner)) as Row[];
    expect(expenses.map((x) => x.expenseId).sort()).toEqual([
      'e1',
      'e2',
      'e3',
      'e4',
    ]);
    expect(
      ((await services.expenses.list(other)) as Row[]).map((x) => x.expenseId),
    ).toEqual(['o2e']);
  });
});
