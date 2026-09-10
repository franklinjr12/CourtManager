import type { AuthContext } from '@court-manager/contracts';
import { describe, expect, it } from 'vitest';
import { MemoryRepository } from './db.js';
import { calculatePrice } from './domain.js';
import { AppError } from './errors.js';
import { buildServices } from './services/index.js';

const context: AuthContext = {
  organizationId: 'org-1',
  userId: 'staff-1',
  role: 'STAFF',
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
    expect(second.status).toBe('CONFIRMED');
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
    expect(reservation.status).toBe('CONFIRMED');
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
});

describe('court archive listing', () => {
  it('hides archived courts by default and returns them when requested', async () => {
    const { services, court } = await setup();
    await services.courts.archive(context, String(court.courtId));
    expect(await services.courts.list(context)).toHaveLength(0);
    expect(await services.courts.list(context, true)).toHaveLength(1);
  });
});
