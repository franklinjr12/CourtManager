import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../db.js';
import { operationalKeys } from '../persistence/operational-keys.js';
import { migrateOperationalIndexes } from './operational-indexes.js';
import { migratePhase3 } from './phase3.js';

const legacyReservation = (
  organizationId: string,
  reservationId: string,
  startAt: string,
) => ({
  PK: `RESERVATION#${reservationId}`,
  SK: 'META',
  entity: 'reservation' as const,
  organizationId,
  reservationId,
  customerId: `customer-${organizationId}`,
  courtId: `court-${organizationId}`,
  startAt,
  endAt: startAt.replace('T10', 'T11'),
  status: 'CONFIRMED',
  expectedAmount: 80,
});
const legacyPayment = (
  organizationId: string,
  paymentId: string,
  reservationId: string,
  amount: number,
) => ({
  PK: `PAYMENT#${paymentId}`,
  SK: 'META',
  entity: 'payment' as const,
  organizationId,
  paymentId,
  reservationId,
  customerId: `customer-${organizationId}`,
  amount,
  paidAt: '2026-09-10T09:00:00.000Z',
});

const legacyRequest = (
  organizationId: string,
  requestId: string,
  status: string,
) => ({
  PK: `REQUEST#${requestId}`,
  SK: 'META',
  entity: 'request' as const,
  organizationId,
  requestId,
  courtId: `court-${organizationId}`,
  requestedStartAt: '2026-09-12T10:00:00Z',
  requestedEndAt: '2026-09-12T11:00:00Z',
  status,
  createdAt: `2026-09-01T0${requestId.slice(-1)}:00:00.000Z`,
});
const legacyCharge = (
  organizationId: string,
  chargeId: string,
  serviceAt: string,
) => ({
  PK: `CHARGE#${chargeId}`,
  SK: 'META',
  entity: 'charge' as const,
  organizationId,
  chargeId,
  customerId: `customer-${organizationId}`,
  amount: 40,
  serviceAt,
  status: 'ACTIVE',
});

async function legacyRepo() {
  const repo = new MemoryRepository();
  await repo.put(legacyReservation('org-1', 'r-1', '2026-09-10T10:00:00Z'));
  await repo.put(legacyReservation('org-1', 'r-2', '2026-09-11T10:00:00Z'));
  await repo.put(legacyReservation('org-2', 'r-3', '2026-09-10T10:00:00Z'));
  await repo.put(legacyPayment('org-1', 'p-1', 'r-1', 30));
  await repo.put(legacyPayment('org-1', 'p-2', 'r-1', 20.5));
  await repo.put(legacyPayment('org-2', 'p-3', 'r-3', 80));
  await repo.put(legacyRequest('org-1', 'q-1', 'REQUESTED'));
  await repo.put(legacyRequest('org-1', 'q-2', 'CONFIRMED'));
  await repo.put(legacyRequest('org-2', 'q-3', 'REQUESTED'));
  await repo.put(legacyCharge('org-1', 'c-1', '2026-09-10T10:00:00.000Z'));
  await repo.put(legacyCharge('org-2', 'c-2', '2026-09-10T12:00:00.000Z'));
  return repo;
}

const orgIndex = (repo: MemoryRepository, organizationId: string) =>
  repo.query(operationalKeys.organizationReservations(organizationId).PK, {
    beginsWith: 'RESERVATION#',
  });

describe('operational indexes migration', () => {
  it('backfills reservation index items and payment summaries per organization', async () => {
    const repo = await legacyRepo();
    const before = (await repo.scan()).length;

    expect(await migrateOperationalIndexes(repo)).toEqual({
      reservationIndexesWritten: 3,
      paymentSummariesWritten: 2,
      openRequestIndexesWritten: 2,
      chargeIndexesWritten: 2,
    });

    expect(await orgIndex(repo, 'org-1')).toMatchObject([
      {
        SK: 'RESERVATION#2026-09-10T10:00:00Z#r-1',
        entity: 'organizationReservationIndex',
        organizationId: 'org-1',
        reservationId: 'r-1',
        status: 'CONFIRMED',
      },
      { SK: 'RESERVATION#2026-09-11T10:00:00Z#r-2', reservationId: 'r-2' },
    ]);
    expect(await orgIndex(repo, 'org-2')).toMatchObject([
      { organizationId: 'org-2', reservationId: 'r-3' },
    ]);
    expect(
      await repo.get(operationalKeys.reservationPaymentSummary('r-1')),
    ).toMatchObject({
      organizationId: 'org-1',
      paidAmount: 50.5,
      paymentCount: 2,
    });
    expect(
      await repo.get(operationalKeys.reservationPaymentSummary('r-3')),
    ).toMatchObject({ organizationId: 'org-2', paidAmount: 80 });
    expect(
      await repo.get(operationalKeys.reservationPaymentSummary('r-2')),
    ).toBeUndefined();
    expect(
      await repo.query(operationalKeys.organizationOpenRequests('org-1').PK, {
        beginsWith: 'REQUEST#',
      }),
    ).toMatchObject([
      {
        SK: 'REQUEST#2026-09-01T01:00:00.000Z#q-1',
        entity: 'organizationOpenRequestIndex',
        requestId: 'q-1',
        status: 'REQUESTED',
      },
    ]);
    expect(
      await repo.query(operationalKeys.organizationCharges('org-1').PK, {
        beginsWith: 'CHARGE#2026-09-10',
      }),
    ).toMatchObject([
      {
        SK: 'CHARGE#2026-09-10T10:00:00.000Z#c-1',
        entity: 'organizationChargeIndex',
        chargeId: 'c-1',
        status: 'ACTIVE',
      },
    ]);
    expect(
      await repo.query(operationalKeys.organizationCharges('org-2').PK, {
        beginsWith: 'CHARGE#',
      }),
    ).toMatchObject([{ chargeId: 'c-2', organizationId: 'org-2' }]);
    // Only index items, summaries and lookups were added; nothing removed.
    expect((await repo.scan()).length).toBe(before + 9);
  });

  it('is idempotent and repairs a stale summary from payment records', async () => {
    const repo = await legacyRepo();
    await migrateOperationalIndexes(repo);
    const snapshot = await repo.scan();

    expect(await migrateOperationalIndexes(repo)).toEqual({
      reservationIndexesWritten: 0,
      paymentSummariesWritten: 0,
      openRequestIndexesWritten: 0,
      chargeIndexesWritten: 0,
    });
    expect(await repo.scan()).toEqual(snapshot);

    await repo.put({
      ...(await repo.get(operationalKeys.reservationPaymentSummary('r-1')))!,
      paidAmount: 999,
    });
    expect(await migrateOperationalIndexes(repo)).toEqual({
      reservationIndexesWritten: 0,
      paymentSummariesWritten: 1,
      openRequestIndexesWritten: 0,
      chargeIndexesWritten: 0,
    });
    expect(
      await repo.get(operationalKeys.reservationPaymentSummary('r-1')),
    ).toMatchObject({ paidAmount: 50.5, paymentCount: 2 });
  });

  it('runs as part of migrate:phase3', async () => {
    const repo = await legacyRepo();
    expect((await migratePhase3(repo)).operational).toEqual({
      reservationIndexesWritten: 3,
      paymentSummariesWritten: 2,
      openRequestIndexesWritten: 2,
      chargeIndexesWritten: 2,
    });
    expect((await migratePhase3(repo)).operational).toEqual({
      reservationIndexesWritten: 0,
      paymentSummariesWritten: 0,
      openRequestIndexesWritten: 0,
      chargeIndexesWritten: 0,
    });
  });
});
