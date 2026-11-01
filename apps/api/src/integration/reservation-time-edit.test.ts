import { randomUUID } from 'node:crypto';
import type { AuthContext } from '@court-manager/contracts';
import { describe, expect, it } from 'vitest';
import { dynamo, ensureTable } from '../db.js';
import { buildServices } from '../services/index.js';
process.env.DYNAMODB_ENDPOINT = 'http://localhost:8120';
process.env.DYNAMODB_TABLE = 'court-manager-integration';
process.env.AWS_REGION = 'us-east-1';

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
  await ensureTable();
  const repo = dynamo();
  const organizationId = randomUUID();
  const ctx: AuthContext = { organizationId, userId: 'owner-1', role: 'OWNER' };
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: 'META',
    entity: 'organization',
    organizationId,
    name: 'Arena',
    slug: `arena-${organizationId}`,
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
  const book = (startAt: string, endAt: string, customerId: string) =>
    services.reservations.create(ctx, {
      courtId: court.courtId,
      customerId,
      startAt,
      endAt,
      source: 'STAFF',
    });
  const locks = async () =>
    (await services.schedule.locks(ctx, String(court.courtId), date)).map(
      (lock) => lock.SK,
    );
  return { repo, ctx, services, court, customer, book, locks };
}

describe('DynamoDB staff reservation time edit', () => {
  it('moves, changes only the end, conflicts and no-ops against DynamoDB', async () => {
    const { repo, ctx, services, customer, book, locks } = await setup();
    const reservation = await book(
      `${date}T10:00:00Z`,
      `${date}T11:00:00Z`,
      String(customer.customerId),
    );
    const id = String(reservation.reservationId);
    const customerPk = `CUSTOMER#${ctx.organizationId}#${customer.customerId}`;

    await services.reservations.update(ctx, id, {
      startAt: `${date}T11:00:00Z`,
      endAt: `${date}T12:00:00Z`,
    });
    expect(await locks()).toEqual(['LOCK#11:00', 'LOCK#11:30']);
    expect(
      await repo.query(customerPk, { beginsWith: 'ACTIVITY#' }),
    ).toHaveLength(1);
    expect(
      await repo.query(customerPk, { beginsWith: 'RESERVATION#' }),
    ).toHaveLength(1);

    await services.reservations.update(ctx, id, {
      endAt: `${date}T12:30:00Z`,
    });
    expect(await locks()).toEqual(['LOCK#11:00', 'LOCK#11:30', 'LOCK#12:00']);

    const other = await services.customers.create(ctx, {
      name: 'Bia',
      phone: '41999990002',
    });
    await book(
      `${date}T13:00:00Z`,
      `${date}T14:00:00Z`,
      String(other.customerId),
    );
    await expect(
      services.reservations.update(ctx, id, {
        startAt: `${date}T12:30:00Z`,
        endAt: `${date}T13:30:00Z`,
      }),
    ).rejects.toMatchObject({ code: 'SCHEDULE_CONFLICT' });
    expect(await services.reservations.detail(ctx, id)).toMatchObject({
      startAt: `${date}T11:00:00Z`,
      endAt: `${date}T12:30:00Z`,
    });

    const unchanged = await services.reservations.update(ctx, id, {
      startAt: `${date}T11:00:00.000Z`,
      endAt: `${date}T12:30:00Z`,
    });
    expect(unchanged).toMatchObject({ startAt: `${date}T11:00:00Z` });
    expect(await locks()).toHaveLength(5);
  });
});
