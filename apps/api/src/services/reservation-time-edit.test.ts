import type { AuthContext } from '@court-manager/contracts';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRepository } from '../db.js';
import { buildServices } from './index.js';

const ctx: AuthContext = {
  organizationId: 'org-1',
  userId: 'owner-1',
  role: 'OWNER',
};
const day = { open: '07:00', close: '23:00' };
const hours = {
  MONDAY: day,
  TUESDAY: day,
  WEDNESDAY: day,
  THURSDAY: day,
  FRIDAY: day,
  SATURDAY: day,
  SUNDAY: day,
};
const date = '2027-01-04';

async function setup() {
  const repo = new MemoryRepository();
  await repo.put({
    PK: 'ORG#org-1',
    SK: 'META',
    entity: 'organization',
    organizationId: 'org-1',
    name: 'Arena',
    slug: 'arena',
    timezone: 'UTC',
    currency: 'BRL',
    active: true,
    features: { classes: false, finance: true },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const services = buildServices(repo);
  const court = await services.courts.create(ctx, {
    name: 'Court 1',
    sport: 'Tennis',
    slotMinutes: 30,
    defaultHourlyPrice: 80,
    publiclyRequestable: true,
    active: true,
    openingHours: hours,
  });
  const customer = await services.customers.create(ctx, {
    name: 'Ana',
    phone: '41999991234',
  });
  const book = (
    startAt: string,
    endAt: string,
    customerId = customer.customerId,
  ) =>
    services.reservations.create(ctx, {
      courtId: court.courtId,
      customerId,
      startAt,
      endAt,
      source: 'STAFF',
    });
  const lockSlots = async () =>
    (await services.schedule.locks(ctx, String(court.courtId), date)).map(
      (lock) => lock.SK,
    );
  const customerRows = async (prefix: string) =>
    repo.query(`CUSTOMER#org-1#${customer.customerId}`, { beginsWith: prefix });
  return { repo, services, court, customer, book, lockSlots, customerRows };
}

describe('staff reservation time edit', () => {
  it('moves a reservation to a free slot with its locks, index and activity', async () => {
    const { services, book, lockSlots, customerRows } = await setup();
    const reservation = await book(`${date}T10:00:00Z`, `${date}T11:00:00Z`);
    const updated = await services.reservations.update(
      ctx,
      String(reservation.reservationId),
      { startAt: `${date}T11:00:00Z`, endAt: `${date}T12:00:00Z` },
    );
    expect(updated).toMatchObject({
      startAt: `${date}T11:00:00Z`,
      endAt: `${date}T12:00:00Z`,
    });
    expect(
      await services.reservations.detail(
        ctx,
        String(reservation.reservationId),
      ),
    ).toMatchObject({ startAt: `${date}T11:00:00Z` });
    expect(await lockSlots()).toEqual(['LOCK#11:00', 'LOCK#11:30']);
    const index = await customerRows('RESERVATION#');
    expect(index.map((row) => row.SK)).toEqual([
      `RESERVATION#${date}T11:00:00Z#${reservation.reservationId}`,
    ]);
    const activities = await customerRows('ACTIVITY#');
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({ startAt: `${date}T11:00:00Z` });
  });

  it('changes only the end time', async () => {
    const { services, book, lockSlots, customerRows } = await setup();
    const reservation = await book(`${date}T10:00:00Z`, `${date}T11:00:00Z`);
    await services.reservations.update(ctx, String(reservation.reservationId), {
      endAt: `${date}T12:00:00Z`,
    });
    expect(await lockSlots()).toEqual([
      'LOCK#10:00',
      'LOCK#10:30',
      'LOCK#11:00',
      'LOCK#11:30',
    ]);
    expect(await customerRows('RESERVATION#')).toHaveLength(1);
    const activities = await customerRows('ACTIVITY#');
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({ endAt: `${date}T12:00:00Z` });
  });

  it('rejects a move onto an occupied slot and leaves everything unchanged', async () => {
    const { services, book, customer, lockSlots } = await setup();
    const other = await services.customers.create(ctx, {
      name: 'Bia',
      phone: '41999990002',
    });
    const reservation = await book(`${date}T10:00:00Z`, `${date}T11:00:00Z`);
    await book(`${date}T11:00:00Z`, `${date}T12:00:00Z`, other.customerId);
    const before = await lockSlots();
    await expect(
      services.reservations.update(ctx, String(reservation.reservationId), {
        startAt: `${date}T10:30:00Z`,
        endAt: `${date}T11:30:00Z`,
      }),
    ).rejects.toMatchObject({ code: 'SCHEDULE_CONFLICT' });
    expect(
      await services.reservations.detail(
        ctx,
        String(reservation.reservationId),
      ),
    ).toMatchObject({
      startAt: `${date}T10:00:00Z`,
      endAt: `${date}T11:00:00Z`,
      customerId: customer.customerId,
    });
    expect(await lockSlots()).toEqual(before);
  });

  it('treats an unchanged save as a no-op without writing', async () => {
    const { repo, services, book } = await setup();
    const reservation = await book(`${date}T10:00:00Z`, `${date}T11:00:00Z`);
    const spy = vi.spyOn(repo, 'transactWrite');
    const put = vi.spyOn(repo, 'put');
    const result = await services.reservations.update(
      ctx,
      String(reservation.reservationId),
      {
        startAt: `${date}T10:00:00.000Z`,
        endAt: `${date}T11:00:00Z`,
      },
    );
    expect(result).toMatchObject({ startAt: `${date}T10:00:00Z` });
    expect(spy).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('rejects transactions that touch the same item twice', async () => {
    const repo = new MemoryRepository();
    const item = { PK: 'A', SK: 'B' };
    await expect(
      repo.transactWrite([
        { type: 'put', item },
        { type: 'delete', key: item },
      ]),
    ).rejects.toThrow(/multiple operations on one item/);
    expect(await repo.get(item)).toBeUndefined();
  });
});
