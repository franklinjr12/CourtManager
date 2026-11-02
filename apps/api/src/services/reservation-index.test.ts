import type { AuthContext } from '@court-manager/contracts';
import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../db.js';
import { operationalKeys } from '../persistence/operational-keys.js';
import { buildServices } from './index.js';

const ctx: AuthContext = {
  organizationId: 'org-1',
  userId: 'owner-1',
  role: 'OWNER',
};
const day = { open: '07:00', close: '23:00' };
const hours = Object.fromEntries(
  [
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
    'SATURDAY',
    'SUNDAY',
  ].map((name) => [name, day]),
);
const date = '2027-01-04';

async function setup() {
  const repo = new MemoryRepository();
  for (const organizationId of ['org-1', 'org-2'])
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
  const book = (startAt: string, endAt: string) =>
    services.reservations.create(ctx, {
      courtId: court.courtId,
      customerId: customer.customerId,
      startAt,
      endAt,
      source: 'STAFF',
    });
  const orgIndex = (organizationId = 'org-1') =>
    repo.query(operationalKeys.organizationReservations(organizationId).PK, {
      beginsWith: 'RESERVATION#',
    });
  const summary = (reservationId: string) =>
    repo.get(operationalKeys.reservationPaymentSummary(reservationId));
  return { repo, services, customer, book, orgIndex, summary };
}

describe('organization reservation index', () => {
  it('keeps exactly one current index item across create, time edit and cancel', async () => {
    const { services, book, orgIndex } = await setup();
    const reservation = await book(`${date}T10:00:00Z`, `${date}T11:00:00Z`);
    const reservationId = String(reservation.reservationId);

    let rows = await orgIndex();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      SK: `RESERVATION#${date}T10:00:00Z#${reservationId}`,
      entity: 'organizationReservationIndex',
      organizationId: 'org-1',
      reservationId,
      status: 'BOOKED',
    });

    await services.reservations.update(ctx, reservationId, {
      startAt: `${date}T14:00:00Z`,
      endAt: `${date}T15:00:00Z`,
    });
    rows = await orgIndex();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      SK: `RESERVATION#${date}T14:00:00Z#${reservationId}`,
      startAt: `${date}T14:00:00Z`,
    });

    await services.reservations.update(ctx, reservationId, {
      notes: 'Bring balls',
    });
    rows = await orgIndex();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ notes: 'Bring balls' });

    await services.reservations.transition(ctx, reservationId, 'CANCELLED');
    rows = await orgIndex();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      SK: `RESERVATION#${date}T14:00:00Z#${reservationId}`,
      status: 'CANCELLED',
    });
  });

  it('writes nothing under another organization', async () => {
    const { repo, book, orgIndex } = await setup();
    await book(`${date}T10:00:00Z`, `${date}T11:00:00Z`);
    expect(await orgIndex('org-2')).toEqual([]);
    const foreign = (await repo.scan()).filter((row) =>
      JSON.stringify(row).includes('org-2'),
    );
    expect(foreign.every((row) => row.PK === 'ORG#org-2')).toBe(true);
  });
});

describe('reservation payment summary', () => {
  it('tracks payment create and remove', async () => {
    const { services, customer, book, summary } = await setup();
    const reservation = await book(`${date}T10:00:00Z`, `${date}T11:00:00Z`);
    const reservationId = String(reservation.reservationId);
    const pay = (amount: number) =>
      services.payments.create(ctx, {
        customerId: customer.customerId,
        reservationId,
        amount,
        method: 'PIX',
        paidAt: `${date}T09:00:00Z`,
      });

    expect(await summary(reservationId)).toBeUndefined();
    const first = await pay(30);
    expect(await summary(reservationId)).toMatchObject({
      entity: 'reservationPaymentSummary',
      organizationId: 'org-1',
      reservationId,
      paidAmount: 30,
      paymentCount: 1,
    });
    const second = await pay(20.5);
    expect(await summary(reservationId)).toMatchObject({
      paidAmount: 50.5,
      paymentCount: 2,
    });

    await services.payments.remove(ctx, String(first.paymentId));
    expect(await summary(reservationId)).toMatchObject({
      paidAmount: 20.5,
      paymentCount: 1,
    });
    await expect(
      services.payments.remove(ctx, String(first.paymentId)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await services.payments.remove(ctx, String(second.paymentId));
    expect(await summary(reservationId)).toMatchObject({
      paidAmount: 0,
      paymentCount: 0,
    });
  });

  it('does not lose concurrent payments', async () => {
    const { services, customer, book, summary } = await setup();
    const reservation = await book(`${date}T10:00:00Z`, `${date}T11:00:00Z`);
    const reservationId = String(reservation.reservationId);
    await Promise.all(
      [10, 15].map((amount) =>
        services.payments.create(ctx, {
          customerId: customer.customerId,
          reservationId,
          amount,
          method: 'CASH',
          paidAt: `${date}T09:00:00Z`,
        }),
      ),
    );
    expect(await summary(reservationId)).toMatchObject({
      paidAmount: 25,
      paymentCount: 2,
    });
  });
});
