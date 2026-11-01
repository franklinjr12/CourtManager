import { expect, it } from 'vitest';
import { MemoryRepository } from '../db.js';
import { buildServices } from './index.js';

const seed = async (repo: MemoryRepository, org: string, suffix = '') => {
  await repo.put({
    PK: `ORG#${org}`,
    SK: `CUSTOMER#cu${suffix}`,
    entity: 'customer',
    organizationId: org,
    customerId: `cu${suffix}`,
    name: `Davi${suffix}`,
  });
  await repo.put({
    PK: `ORG#${org}`,
    SK: `COURT#co${suffix}`,
    entity: 'court',
    organizationId: org,
    courtId: `co${suffix}`,
    name: `Quadra 1${suffix}`,
  });
  await repo.put({
    PK: `RESERVATION#re${suffix}`,
    SK: 'META',
    entity: 'reservation',
    organizationId: org,
    reservationId: `re${suffix}`,
    courtId: `co${suffix}`,
    customerId: `cu${suffix}`,
    startAt: '2026-10-05T13:00:00.000Z',
    endAt: '2026-10-05T14:00:00.000Z',
  });
  await repo.put({
    PK: `CLASS#cl${suffix}`,
    SK: 'META',
    entity: 'class',
    organizationId: org,
    classId: `cl${suffix}`,
    name: `Tênis${suffix}`,
  });
  await repo.put({
    PK: `CHARGE#ch${suffix}`,
    SK: 'META',
    entity: 'charge',
    organizationId: org,
    chargeId: `ch${suffix}`,
    customerId: `cu${suffix}`,
    reservationId: `re${suffix}`,
    sourceType: 'RESERVATION',
    sourceId: `re${suffix}`,
    amount: 80,
    serviceAt: '2026-10-05T13:00:00.000Z',
    status: 'ACTIVE',
  });
  await repo.put({
    PK: `PAYMENT#pa${suffix}`,
    SK: 'META',
    entity: 'payment',
    organizationId: org,
    paymentId: `pa${suffix}`,
    customerId: `cu${suffix}`,
    reservationId: `re${suffix}`,
    amount: 30,
  });
  await repo.put({
    PK: `PAYMENT#pb${suffix}`,
    SK: 'META',
    entity: 'payment',
    organizationId: org,
    paymentId: `pb${suffix}`,
    customerId: `cu${suffix}`,
    classId: `cl${suffix}`,
    amount: 20,
  });
};

it('adds customer, court, time and class names to charges and payments', async () => {
  const repo = new MemoryRepository();
  await seed(repo, 'org1');
  const services = buildServices(repo);
  const owner = { organizationId: 'org1', userId: 'o', role: 'OWNER' as const };

  const charges = (await services.charges.list(owner)) as Array<
    Record<string, unknown>
  >;
  expect(charges[0]).toMatchObject({
    customerName: 'Davi',
    courtName: 'Quadra 1',
    startAt: '2026-10-05T13:00:00.000Z',
    paidAmount: 30,
  });

  const payments = (await services.payments.list(owner)) as Array<
    Record<string, unknown>
  >;
  expect(payments.find((p) => p.paymentId === 'pa')).toMatchObject({
    customerName: 'Davi',
    courtName: 'Quadra 1',
    startAt: '2026-10-05T13:00:00.000Z',
    endAt: '2026-10-05T14:00:00.000Z',
  });
  expect(payments.find((p) => p.paymentId === 'pb')).toMatchObject({
    className: 'Tênis',
  });
});

it('does not use records from another organization for display names', async () => {
  const repo = new MemoryRepository();
  await seed(repo, 'org1');
  await seed(repo, 'org2', 'x');
  // org1 payment pointing at org2 ids must not resolve names from org2.
  await repo.put({
    PK: 'PAYMENT#evil',
    SK: 'META',
    entity: 'payment',
    organizationId: 'org1',
    paymentId: 'evil',
    customerId: 'cux',
    reservationId: 'rex',
    classId: 'clx',
    amount: 1,
  });
  const services = buildServices(repo);
  const owner = { organizationId: 'org1', userId: 'o', role: 'OWNER' as const };
  const payments = (await services.payments.list(owner)) as Array<
    Record<string, unknown>
  >;
  const evil = payments.find((p) => p.paymentId === 'evil');
  expect(evil).toBeDefined();
  expect(evil).not.toHaveProperty('customerName');
  expect(evil).not.toHaveProperty('courtName');
  expect(evil).not.toHaveProperty('startAt');
  expect(evil).not.toHaveProperty('className');
});
