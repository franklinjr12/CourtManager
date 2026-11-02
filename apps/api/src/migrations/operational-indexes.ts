import { isDeepStrictEqual } from 'node:util';
import type { RecordItem, Repository, Write } from '../db.js';
import {
  openRequestIndex,
  operationalKeys,
  organizationChargeIndex,
} from '../persistence/operational-keys.js';

export type OperationalIndexesMigrationResult = {
  reservationIndexesWritten: number;
  paymentSummariesWritten: number;
  openRequestIndexesWritten: number;
  chargeIndexesWritten: number;
};

const withoutMetadata = (item: RecordItem) =>
  Object.fromEntries(
    Object.entries(item).filter(
      ([name]) => name !== 'PK' && name !== 'SK' && name !== 'entity',
    ),
  );

const cents = (value: number) => Math.round(value * 100) / 100;

/**
 * One-off bounded-scan backfill for the front-desk access records:
 * - an `ORG#<org>#RESERVATIONS` index copy of every reservation;
 * - a `PAYMENT_SUMMARY` per reservation with payments, recomputed from the
 *   authoritative payment records;
 * - an `ORG#<org>#OPEN_REQUESTS` copy of every request still `REQUESTED`;
 * - an `ORG#<org>#CHARGES` copy of every charge, sorted by `serviceAt`.
 * Additive and idempotent: it only writes items that are missing or differ
 * from their source, never deletes, and never invents business records.
 */
export async function migrateOperationalIndexes(
  repo: Repository,
  rows?: RecordItem[],
): Promise<OperationalIndexesMigrationResult> {
  const items = rows ?? (await repo.scan<RecordItem>());
  let reservationIndexesWritten = 0;
  let paymentSummariesWritten = 0;
  let openRequestIndexesWritten = 0;
  let chargeIndexesWritten = 0;

  const payments = new Map<
    string,
    { organizationId: string; amounts: number[] }
  >();
  for (const item of items) {
    if (item.entity !== 'payment' || !item.reservationId) continue;
    const reservationId = String(item.reservationId);
    const entry = payments.get(reservationId) ?? {
      organizationId: String(item.organizationId),
      amounts: [],
    };
    entry.amounts.push(Number(item.amount ?? 0));
    payments.set(reservationId, entry);
  }

  for (const item of items) {
    if (item.entity !== 'reservation' || !item.organizationId) continue;
    const key = operationalKeys.organizationReservation(
      String(item.organizationId),
      String(item.startAt),
      String(item.reservationId),
    );
    const index: RecordItem = {
      ...withoutMetadata(item),
      ...key,
      entity: 'organizationReservationIndex',
    };
    if (isDeepStrictEqual(await repo.get(key), index)) continue;
    await repo.put(index);
    reservationIndexesWritten += 1;
  }

  for (const [reservationId, { organizationId, amounts }] of payments) {
    const key = operationalKeys.reservationPaymentSummary(reservationId);
    const current = await repo.get<RecordItem>(key);
    const paidAmount = cents(amounts.reduce((sum, amount) => sum + amount, 0));
    if (
      current &&
      Number(current.paidAmount) === paidAmount &&
      Number(current.paymentCount) === amounts.length
    )
      continue;
    const summary: Write = {
      type: 'put',
      item: {
        ...key,
        entity: 'reservationPaymentSummary',
        organizationId,
        reservationId,
        paidAmount,
        paymentCount: amounts.length,
        updatedAt: new Date().toISOString(),
      },
      // Fail rather than overwrite a summary a live payment just changed.
      ...(current
        ? {
            expected: {
              paidAmount: current.paidAmount,
              paymentCount: current.paymentCount,
            },
          }
        : { condition: 'attribute_not_exists(PK)' }),
    };
    await repo.transactWrite([summary]);
    paymentSummariesWritten += 1;
  }

  const putIfChanged = async (index: RecordItem) => {
    if (isDeepStrictEqual(await repo.get(index), index)) return false;
    await repo.put(index);
    return true;
  };
  for (const item of items) {
    if (!item.organizationId) continue;
    if (item.entity === 'request' && item.status === 'REQUESTED') {
      if (await putIfChanged(openRequestIndex(item)))
        openRequestIndexesWritten += 1;
    } else if (item.entity === 'charge') {
      if (await putIfChanged(organizationChargeIndex(item)))
        chargeIndexesWritten += 1;
    }
  }
  return {
    reservationIndexesWritten,
    paymentSummariesWritten,
    openRequestIndexesWritten,
    chargeIndexesWritten,
  };
}
