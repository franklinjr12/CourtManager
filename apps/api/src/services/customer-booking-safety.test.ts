import {
  DEFAULT_BOOKING_POLICY,
  type Court,
  type CustomerAuthContext,
} from '@court-manager/contracts';
import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../db.js';
import { buildServices } from './index.js';

const owner = {
  organizationId: 'org-booking-safety',
  userId: 'owner',
  role: 'OWNER' as const,
};
const openingHours = Object.fromEntries(
  [
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
    'SATURDAY',
    'SUNDAY',
  ].map((day) => [day, { open: '07:00', close: '23:00' }]),
);

async function setup() {
  const repo = new MemoryRepository();
  await repo.put({
    PK: `ORG#${owner.organizationId}`,
    SK: 'META',
    entity: 'organization',
    organizationId: owner.organizationId,
    name: 'Booking Safety Arena',
    slug: 'booking-safety',
    timezone: 'UTC',
    currency: 'BRL',
    active: true,
    features: { classes: false, finance: false },
    bookingPolicy: {
      ...DEFAULT_BOOKING_POLICY,
      reservationMode: 'AUTO_CONFIRM',
      bookAheadDays: 30,
      minimumReservationMinutes: 60,
      maximumReservationMinutes: 120,
      maximumActiveBookings: 3,
    },
  });
  const services = buildServices(repo);
  const court = (await services.courts.create(owner, {
    name: 'Safety Court',
    sport: 'Tennis',
    slotMinutes: 30,
    defaultHourlyPrice: 80,
    publiclyRequestable: true,
    active: true,
    openingHours,
  })) as Court;
  const first = await services.customerAccounts.register('booking-safety', {
    name: 'First Customer',
    email: 'first@booking-safety.test',
    phone: '41999990001',
    password: 'secret',
  });
  const second = await services.customerAccounts.register('booking-safety', {
    name: 'Second Customer',
    email: 'second@booking-safety.test',
    phone: '41999990002',
    password: 'secret',
  });
  const context = (account: typeof first): CustomerAuthContext => ({
    actorType: 'CUSTOMER',
    organizationId: owner.organizationId,
    customerId: String(account.customer.customerId),
    customerAccountId: String(account.account.customerAccountId),
  });
  return {
    repo,
    services,
    court,
    first: context(first),
    second: context(second),
  };
}

const futureSlot = () => {
  const start = new Date(Date.now() + 3 * 86400000);
  start.setUTCHours(18, 0, 0, 0);
  return {
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + 60 * 60000).toISOString(),
  };
};

describe('customer booking safety', () => {
  it('enforces minimum, maximum, and allowed duration boundaries', async () => {
    const { services, court } = await setup();
    const policy = await services.bookingPolicy.policy(owner.organizationId);
    expect(
      services.bookingPolicy.customerAllowedDurations(policy, court),
    ).toEqual([60, 90, 120]);
    const at = new Date();
    const start = new Date(at.getTime() + 3 * 86400000);
    start.setUTCHours(18, 0, 0, 0);
    const valid = (minutes: number) => ({
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + minutes * 60000).toISOString(),
    });
    expect(() =>
      services.bookingPolicy.assertCustomerCanBook(
        policy,
        'UTC',
        court,
        valid(60).startAt,
        valid(60).endAt,
        at,
      ),
    ).not.toThrow();
    expect(() =>
      services.bookingPolicy.assertCustomerCanBook(
        policy,
        'UTC',
        court,
        valid(30).startAt,
        valid(30).endAt,
        at,
      ),
    ).toThrow('duration is not allowed');
    expect(() =>
      services.bookingPolicy.assertCustomerCanBook(
        policy,
        'UTC',
        court,
        valid(150).startAt,
        valid(150).endAt,
        at,
      ),
    ).toThrow('duration is not allowed');
  });

  it('allows only one simultaneous AUTO_CONFIRM request for same court slot', async () => {
    const { repo, services, court, first, second } = await setup();
    const slot = futureSlot();
    const results = await Promise.allSettled([
      services.customerBookings.create(first, {
        courtId: court.courtId,
        ...slot,
      }),
      services.customerBookings.create(second, {
        courtId: court.courtId,
        ...slot,
      }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      reason: { code: 'SCHEDULE_CONFLICT' },
    });
    expect(
      await repo.scan(
        (item) => item.entity === 'reservation' && item.status === 'BOOKED',
      ),
    ).toHaveLength(1);
    const locks = await repo.scan(
      (item) =>
        item.PK.startsWith('SCHEDULE#') && item.occupancyId !== undefined,
    );
    expect(locks.length).toBeGreaterThanOrEqual(2);
    expect(new Set(locks.map((lock) => lock.occupancyId))).toHaveLength(1);
  });
});
