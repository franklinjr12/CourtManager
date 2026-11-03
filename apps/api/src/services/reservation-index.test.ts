import type { AuthContext } from '@court-manager/contracts';
import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../db.js';
import { operationalKeys } from '../persistence/operational-keys.js';
import {
  encodeReservationCursor,
  reservationListRange,
} from './reservation-list.js';
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
  return { repo, services, court, customer, book, orgIndex, summary };
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

describe('reservation list', () => {
  const at = (day: string, hour: number) =>
    `${day}T${String(hour).padStart(2, '0')}:00:00Z`;
  const slot = (day: string, hour: number) =>
    [at(day, hour), at(day, hour + 1)] as const;

  it('pages a date range with an opaque cursor in start order', async () => {
    const { services, book } = await setup();
    for (const [day, hour] of [
      ['2027-01-05', 9],
      ['2027-01-04', 10],
      ['2027-01-04', 12],
      ['2027-01-05', 15],
      ['2027-01-06', 10],
    ] as const)
      await book(...slot(day, hour));

    const starts: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await services.reservations.list(ctx, {
        from: '2027-01-04',
        to: '2027-01-05',
        limit: 2,
        ...(cursor ? { cursor } : {}),
      });
      starts.push(...page.data.map((r) => String(r.startAt)));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 10);

    expect(starts).toEqual([
      at('2027-01-04', 10),
      at('2027-01-04', 12),
      at('2027-01-05', 9),
      at('2027-01-05', 15),
    ]);
    expect(pages).toBeLessThanOrEqual(3);

    const legacy = await services.reservations.list(ctx, {
      date: '2027-01-06',
    });
    expect(legacy.data.map((r) => r.startAt)).toEqual([at('2027-01-06', 10)]);
    expect(legacy.nextCursor).toBeNull();
  });

  it('applies status after bounded reads and resumes from the cursor', async () => {
    const { services, book } = await setup();
    const ids: string[] = [];
    for (let hour = 8; hour < 15; hour += 1)
      ids.push(String((await book(...slot(date, hour))).reservationId));
    for (const reservationId of ids.slice(0, 6))
      await services.reservations.transition(ctx, reservationId, 'CANCELLED');

    const first = await services.reservations.list(ctx, {
      date,
      status: 'BOOKED',
      limit: 1,
    });
    expect(first.data).toEqual([]);
    expect(first.nextCursor).not.toBeNull();
    const second = await services.reservations.list(ctx, {
      date,
      status: 'BOOKED',
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second.data.map((r) => r.reservationId)).toEqual([ids[6]]);
  });

  it('enriches names and payments in bulk, missing summary meaning unpaid', async () => {
    const { services, customer, book } = await setup();
    const paid = await book(...slot(date, 10));
    await book(...slot(date, 12));
    await services.payments.create(ctx, {
      customerId: customer.customerId,
      reservationId: paid.reservationId,
      amount: 30,
      method: 'PIX',
      paidAt: at(date, 9),
    });

    const { data } = await services.reservations.list(ctx, { date });
    expect(data).toMatchObject([
      {
        customerName: 'Ana',
        courtName: 'Court 1',
        paidAmount: 30,
        remainingAmount: 50,
        paymentStatus: 'PARTIAL',
      },
      {
        customerName: 'Ana',
        courtName: 'Court 1',
        paidAmount: 0,
        remainingAmount: 80,
      },
    ]);
  });

  it('lists a customer partition with no default lower bound', async () => {
    const { services, customer, book } = await setup();
    await book(...slot(date, 10));
    const { data } = await services.reservations.list(ctx, {
      customerId: customer.customerId,
    });
    expect(data).toHaveLength(1);
  });

  it('never returns another organization, even with a forged cursor', async () => {
    const { repo, services, book } = await setup();
    const mine = await book(...slot(date, 10));
    const other: AuthContext = { ...ctx, organizationId: 'org-2' };
    const court = await services.courts.create(other, {
      name: 'Other court',
      sport: 'Tennis',
      slotMinutes: 30,
      defaultHourlyPrice: 80,
      publiclyRequestable: true,
      active: true,
      openingHours: hours,
    });
    const customer = await services.customers.create(other, {
      name: 'Bia',
      phone: '41999995678',
    });
    const foreign = await services.reservations.create(other, {
      courtId: court.courtId,
      customerId: customer.customerId,
      startAt: at(date, 8),
      endAt: at(date, 9),
      source: 'STAFF',
    });

    const page = await services.reservations.list(ctx, { date });
    expect(page.data.map((r) => r.reservationId)).toEqual([mine.reservationId]);
    const [foreignIndex] = await repo.query(
      operationalKeys.organizationReservations('org-2').PK,
      { beginsWith: 'RESERVATION#' },
    );
    const forged = await services.reservations.list(ctx, {
      date,
      cursor: encodeReservationCursor(String(foreignIndex!.SK)),
    });
    expect(forged.data.map((r) => r.reservationId)).toEqual([
      mine.reservationId,
    ]);
    expect(
      forged.data.some((r) => r.reservationId === foreign.reservationId),
    ).toBe(false);
    await expect(
      services.reservations.list(ctx, { cursor: 'not a cursor' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      services.reservations.list(ctx, {
        cursor: encodeReservationCursor('CUSTOMER#x'),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('uses venue-local date boundaries', async () => {
    const { repo, services, book } = await setup();
    const meta = await repo.get({ PK: 'ORG#org-1', SK: 'META' });
    await repo.put({ ...meta!, timezone: 'America/Sao_Paulo' });
    // 22:00 local on Jan 3 and 22:00 local on Jan 4 (UTC-3).
    await book('2027-01-04T01:00:00Z', '2027-01-04T02:00:00Z');
    await book('2027-01-05T01:00:00Z', '2027-01-05T02:00:00Z');
    await book('2027-01-04T13:00:00Z', '2027-01-04T14:00:00Z');

    const { data } = await services.reservations.list(ctx, {
      date: '2027-01-04',
    });
    expect(data.map((r) => r.startAt)).toEqual([
      '2027-01-04T13:00:00Z',
      '2027-01-05T01:00:00Z',
    ]);
  });

  it('defaults to the venue today and rejects inverted ranges', () => {
    const nowIso = '2027-01-05T01:00:00.000Z';
    expect(reservationListRange({}, 'America/Sao_Paulo', { nowIso })).toEqual({
      from: '2027-01-04',
    });
    expect(
      reservationListRange({}, 'America/Sao_Paulo', {
        nowIso,
        openStart: true,
      }),
    ).toEqual({});
    expect(() =>
      reservationListRange({ from: '2027-01-05', to: '2027-01-04' }, 'UTC'),
    ).toThrow(/from/);
  });
});
