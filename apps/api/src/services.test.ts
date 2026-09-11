import type { AuthContext } from '@court-manager/contracts';
import { describe, expect, it } from 'vitest';
import { MemoryRepository } from './db.js';
import { calculatePrice } from './domain.js';
import { AppError } from './errors.js';
import { buildServices } from './services/index.js';

const context: AuthContext = {
  organizationId: 'org-1',
  userId: 'owner-1',
  role: 'OWNER',
};
const hours = {
  MONDAY: { open: '07:00', close: '23:00' },
  TUESDAY: { open: '07:00', close: '23:00' },
  WEDNESDAY: { open: '07:00', close: '23:00' },
  THURSDAY: { open: '07:00', close: '23:00' },
  FRIDAY: { open: '07:00', close: '23:00' },
  SATURDAY: { open: '07:00', close: '23:00' },
  SUNDAY: { open: '07:00', close: '23:00' },
};
async function setup(timezone = 'UTC') {
  const repo = new MemoryRepository();
  await repo.put({
    PK: 'ORG#org-1',
    SK: 'META',
    entity: 'organization',
    organizationId: 'org-1',
    name: 'Arena',
    slug: 'arena',
    timezone,
    currency: 'BRL',
    active: true,
    features: { classes: false, finance: true },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await repo.put({
    PK: 'ORG#org-1',
    SK: 'USER#coach-1',
    entity: 'user',
    userId: 'coach-1',
    organizationId: 'org-1',
    name: 'Coach',
    email: 'coach@arena.test',
    role: 'COACH',
    passwordHash: 'test',
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const services = buildServices(repo);
  const court = await services.courts.create(context, {
    name: 'Court 1',
    sport: 'Tennis',
    slotMinutes: 30,
    defaultHourlyPrice: 80,
    publiclyRequestable: true,
    active: true,
    openingHours: hours,
  });
  const customer = await services.customers.create(context, {
    name: 'Ana',
    phone: '41999991234',
  });
  return { repo, services, court, customer };
}
describe('reservation workflows', () => {
  it('prevents overlap and releases a cancelled slot', async () => {
    const { services, court, customer } = await setup();
    const input = {
      courtId: String(court.courtId),
      customerId: String(customer.customerId),
      startAt: '2026-01-02T18:00:00Z',
      endAt: '2026-01-02T19:00:00Z',
      source: 'STAFF' as const,
    };
    const reservation = await services.reservations.create(context, input);
    await expect(
      services.reservations.create(context, {
        ...input,
        customerId: String(customer.customerId),
      }),
    ).rejects.toMatchObject({ code: 'SCHEDULE_CONFLICT' });
    await services.reservations.transition(
      context,
      String(reservation.reservationId),
      'CANCELLED',
    );
    const second = await services.reservations.create(context, input);
    expect(second.status).toBe('BOOKED');
  });
  it('serializes concurrent writes with one winner', async () => {
    const { services, court, customer } = await setup();
    const input = {
      courtId: String(court.courtId),
      customerId: String(customer.customerId),
      startAt: '2026-01-03T18:00:00Z',
      endAt: '2026-01-03T19:00:00Z',
      source: 'STAFF' as const,
    };
    const results = await Promise.allSettled([
      services.reservations.create(context, input),
      services.reservations.create(context, input),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(
      results.filter(
        (x) =>
          x.status === 'rejected' &&
          x.reason instanceof AppError &&
          x.reason.code === 'SCHEDULE_CONFLICT',
      ),
    ).toHaveLength(1);
  });
  it('confirms a public request without locking it before review', async () => {
    const { services, court } = await setup();
    const request = await services.requests.createPublic('arena', {
      courtId: String(court.courtId),
      requestedStartAt: '2026-12-06T18:00:00Z',
      requestedEndAt: '2026-12-06T19:00:00Z',
      customerName: 'Bea',
      phone: '41999999999',
    });
    expect(request.status).toBe('REQUESTED');
    expect(
      await services.schedule.locks(
        context,
        String(court.courtId),
        '2026-12-06',
      ),
    ).toHaveLength(0);
    const reservation = await services.requests.confirm(
      context,
      String(request.requestId),
    );
    expect(reservation.status).toBe('BOOKED');
  });
  it('derives payment summary and preserves historical price', async () => {
    const { services, court, customer } = await setup();
    expect(calculatePrice(Number(court.defaultHourlyPrice), 60)).toBe(80);
    const reservation = await services.reservations.create(context, {
      courtId: String(court.courtId),
      customerId: String(customer.customerId),
      startAt: '2026-01-05T18:00:00Z',
      endAt: '2026-01-05T19:00:00Z',
      source: 'STAFF',
    });
    await services.payments.create(context, {
      reservationId: reservation.reservationId,
      customerId: customer.customerId,
      amount: 40,
      method: 'PIX',
      paidAt: '2026-01-05T19:00:00Z',
    });
    expect(
      (
        await services.reservations.detail(
          context,
          String(reservation.reservationId),
        )
      ).paymentStatus,
    ).toBe('PARTIAL');
  });
  it('rejects payments with missing or mismatched associations', async () => {
    const { services, court, customer } = await setup();
    const other = await services.customers.create(context, {
      name: 'Other customer',
      phone: '41999990001',
    });
    const reservation = await services.reservations.create(context, {
      courtId: court.courtId,
      customerId: customer.customerId,
      startAt: '2027-01-06T18:00:00Z',
      endAt: '2027-01-06T19:00:00Z',
      source: 'STAFF',
    });
    await expect(
      services.payments.create(context, {
        reservationId: reservation.reservationId,
        customerId: other.customerId,
        amount: 20,
        method: 'PIX',
        paidAt: '2027-01-06T18:00:00Z',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      services.payments.create(context, {
        reservationId: 'missing-reservation',
        customerId: customer.customerId,
        amount: 20,
        method: 'PIX',
        paidAt: '2027-01-06T18:00:00Z',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('court archive listing', () => {
  it('hides archived courts by default and returns them when requested', async () => {
    const { services, court } = await setup();
    await services.courts.archive(context, String(court.courtId));
    expect(await services.courts.list(context)).toHaveLength(0);
    expect(await services.courts.list(context, true)).toHaveLength(1);
  });
  it('hides inactive courts and rejects new occupancy on them', async () => {
    const { services, court, customer } = await setup();
    await services.courts.update(context, String(court.courtId), {
      active: false,
    });
    expect(await services.courts.list(context)).toHaveLength(0);
    await expect(
      services.courts.get(context, String(court.courtId)),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      services.reservations.create(context, {
        courtId: court.courtId,
        customerId: customer.customerId,
        startAt: '2027-01-04T18:00:00Z',
        endAt: '2027-01-04T19:00:00Z',
        source: 'STAFF',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('protects archival when future occupancy exists', async () => {
    const { services, court, customer } = await setup();
    await services.reservations.create(context, {
      courtId: court.courtId,
      customerId: customer.customerId,
      startAt: '2027-01-05T18:00:00Z',
      endAt: '2027-01-05T19:00:00Z',
      source: 'STAFF',
    });
    await expect(
      services.courts.archive(context, String(court.courtId)),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
  it('uses local venue time for locks and supports longer slot multiples', async () => {
    const { services, court, customer } = await setup('America/Sao_Paulo');
    const reservation = await services.reservations.create(context, {
      courtId: court.courtId,
      customerId: customer.customerId,
      startAt: '2027-01-05T22:00:00Z',
      endAt: '2027-01-06T00:00:00Z',
      source: 'STAFF',
    });
    expect(
      await services.schedule.locks(
        context,
        String(court.courtId),
        '2027-01-04',
      ),
    ).toHaveLength(0);
    expect(
      await services.schedule.locks(
        context,
        String(court.courtId),
        '2027-01-05',
      ),
    ).toHaveLength(4);
    expect(reservation.status).toBe('BOOKED');
    expect(
      await services.schedule.availability(
        context,
        court as Parameters<typeof services.schedule.availability>[1],
        '2027-01-05',
        120,
      ),
    ).not.toContain('19:00');
  });
  it('makes classes visible as occupancy and protects non-public courts', async () => {
    const { services, court } = await setup();
    const customer = await services.customers.create(context, {
      name: 'Class customer',
      phone: '41999990000',
    });
    await services.classes.create(context, {
      name: 'Evening class',
      sport: 'Tennis',
      coachId: 'coach-1',
      courtId: court.courtId,
      capacity: 10,
      price: 50,
      weekday: 1,
      startTime: '18:00',
      durationMinutes: 60,
      startDate: '2027-01-04',
      endDate: '2027-01-04',
    });
    const occurrences = await services.classes.occurrences(
      context,
      '2027-01-04',
    );
    expect(occurrences[0]).toMatchObject({
      name: 'Evening class',
      courtId: court.courtId,
    });
    await expect(
      services.reservations.create(context, {
        courtId: court.courtId,
        customerId: customer.customerId,
        startAt: '2027-01-04T18:00:00Z',
        endAt: '2027-01-04T19:00:00Z',
        source: 'STAFF',
      }),
    ).rejects.toMatchObject({ code: 'SCHEDULE_CONFLICT' });
  });
  it('does not expose a private court through public availability', async () => {
    const { services } = await setup();
    const privateCourt = await services.courts.create(context, {
      name: 'Private',
      sport: 'Tennis',
      slotMinutes: 30,
      defaultHourlyPrice: 80,
      publiclyRequestable: false,
      active: true,
      openingHours: hours,
    });
    await expect(
      services.requests.publicAvailability(
        'arena',
        String(privateCourt.courtId),
        '2027-01-04',
        120,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('does not return dates before today from availability', async () => {
    const { services, court } = await setup();
    expect(
      await services.schedule.availability(
        context,
        court as Parameters<typeof services.schedule.availability>[1],
        '2020-01-01',
        30,
      ),
    ).toEqual([]);
  });
  it('does not return elapsed slots for today', async () => {
    const { services, court } = await setup();
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const currentTime = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
    const available = await services.schedule.availability(
      context,
      court as Parameters<typeof services.schedule.availability>[1],
      date,
      30,
    );
    expect(available.every((start) => start >= currentTime)).toBe(true);
  });
  it('creates long recurring series without exceeding one transaction limit', async () => {
    const { services, court, customer } = await setup();
    const result = await services.reservations.recurring(context, {
      courtId: court.courtId,
      customerId: customer.customerId,
      startAt: '2027-01-04T18:00:00Z',
      endAt: '2027-01-04T19:00:00Z',
      untilDate: '2028-02-28',
      frequency: 'WEEKLY',
      intervalWeeks: 1,
      source: 'STAFF',
    });
    const created = result.created as Record<string, unknown>[];
    expect(created.length).toBeGreaterThan(50);
    expect(
      (await services.reservations.list(context, {})).filter(
        (reservation) => reservation.seriesId === String(result.seriesId),
      ),
    ).toHaveLength(created.length);
  });
  it('does not leave a customer when request confirmation loses its slot', async () => {
    const { services, court, customer } = await setup();
    const startAt = '2028-02-06T18:00:00Z';
    await services.reservations.create(context, {
      courtId: court.courtId,
      customerId: customer.customerId,
      startAt,
      endAt: '2028-02-06T19:00:00Z',
      source: 'STAFF',
    });
    const request = await services.requests.createPublic('arena', {
      courtId: court.courtId,
      requestedStartAt: startAt,
      requestedEndAt: '2028-02-06T19:00:00Z',
      customerName: 'Never created',
      phone: '41999991111',
    });
    await expect(
      services.requests.confirm(context, String(request.requestId)),
    ).rejects.toMatchObject({ code: 'SCHEDULE_CONFLICT' });
    expect(
      await services.customers.list(context, 'Never created'),
    ).toHaveLength(0);
  });
});
