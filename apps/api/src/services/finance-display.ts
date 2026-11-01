import type { Key, RecordItem, Repository } from '../db.js';

type FinanceRow = Record<string, unknown>;

export type FinanceDisplay = {
  customerName?: string;
  courtName?: string;
  startAt?: string;
  endAt?: string;
  className?: string;
};

const keyId = (key: Key) => `${key.PK}|${key.SK}`;

async function batchGet(repo: Repository, keys: Key[]) {
  const unique = [...new Map(keys.map((key) => [keyId(key), key])).values()];
  const result: RecordItem[] = [];
  for (let offset = 0; offset < unique.length; offset += 100)
    result.push(...(await repo.batchGet(unique.slice(offset, offset + 100))));
  return result;
}

/**
 * Adds human-readable names to charge/payment rows. Uses at most two bounded
 * batch rounds (customers/reservations/classes, then courts) regardless of the
 * number of rows, and ignores records owned by other organizations.
 */
export async function withFinanceDisplay<T extends FinanceRow>(
  repo: Repository,
  organizationId: string,
  rows: T[],
): Promise<Array<T & FinanceDisplay>> {
  const ids = (pick: (row: T) => unknown) => [
    ...new Set(
      rows.map(pick).filter((v): v is string => !!v && typeof v === 'string'),
    ),
  ];
  const customerKey = (id: string): Key => ({
    PK: `ORG#${organizationId}`,
    SK: `CUSTOMER#${id}`,
  });
  const reservationKey = (id: string): Key => ({
    PK: `RESERVATION#${id}`,
    SK: 'META',
  });
  const classKey = (id: string): Key => ({ PK: `CLASS#${id}`, SK: 'META' });
  const first = await batchGet(repo, [
    ...ids((row) => row.customerId).map(customerKey),
    ...ids((row) => row.reservationId).map(reservationKey),
    ...ids((row) => row.classId).map(classKey),
  ]);
  const owned = new Map(
    first
      .filter((row) => row.organizationId === organizationId)
      .map((row) => [`${row.PK}|${row.SK}`, row]),
  );
  const courtIds = [
    ...new Set(
      ids((row) => row.reservationId)
        .map((id) => owned.get(keyId(reservationKey(id)))?.courtId)
        .filter((v): v is string => !!v && typeof v === 'string'),
    ),
  ];
  const courts = new Map(
    (
      await batchGet(
        repo,
        courtIds.map((id) => ({
          PK: `ORG#${organizationId}`,
          SK: `COURT#${id}`,
        })),
      )
    )
      .filter((row) => row.organizationId === organizationId)
      .map((row) => [`${row.PK}|${row.SK}`, row]),
  );
  return rows.map((row) => {
    const customer = row.customerId
      ? owned.get(keyId(customerKey(String(row.customerId))))
      : undefined;
    const reservation = row.reservationId
      ? owned.get(keyId(reservationKey(String(row.reservationId))))
      : undefined;
    const cls = row.classId
      ? owned.get(keyId(classKey(String(row.classId))))
      : undefined;
    const court = reservation?.courtId
      ? courts.get(
          keyId({
            PK: `ORG#${organizationId}`,
            SK: `COURT#${String(reservation.courtId)}`,
          }),
        )
      : undefined;
    return {
      ...row,
      ...(customer ? { customerName: String(customer.name) } : {}),
      ...(court ? { courtName: String(court.name) } : {}),
      ...(reservation?.startAt ? { startAt: String(reservation.startAt) } : {}),
      ...(reservation?.endAt ? { endAt: String(reservation.endAt) } : {}),
      ...(cls ? { className: String(cls.name) } : {}),
    };
  });
}
