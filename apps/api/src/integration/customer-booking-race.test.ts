import { randomUUID } from 'node:crypto';
import {
  DEFAULT_BOOKING_POLICY,
  type Court,
  type CustomerAuthContext,
} from '@court-manager/contracts';
import { describe, expect, it } from 'vitest';
import { dynamo, ensureTable } from '../db.js';
import { buildServices } from '../services/index.js';

process.env.DYNAMODB_ENDPOINT = 'http://localhost:8120';
process.env.DYNAMODB_TABLE = 'court-manager-integration';
process.env.AWS_REGION = 'us-east-1';

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

describe('DynamoDB Local AUTO_CONFIRM booking races', () => {
  it('allows only one customer to occupy the same court slot', async () => {
    await ensureTable();
    const repo = dynamo();
    const organizationId = randomUUID();
    const owner = {
      organizationId,
      userId: 'owner',
      role: 'OWNER' as const,
    };
    await repo.put({
      PK: `ORG#${organizationId}`,
      SK: 'META',
      entity: 'organization',
      organizationId,
      name: 'Race Arena',
      slug: `race-${organizationId}`,
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
      name: 'Race Court',
      sport: 'Tennis',
      slotMinutes: 30,
      defaultHourlyPrice: 80,
      publiclyRequestable: true,
      active: true,
      openingHours,
    })) as Court;
    const first = await services.customerAccounts.register(
      `race-${organizationId}`,
      {
        name: 'First',
        email: `first-${organizationId}@race.test`,
        phone: '41999990001',
        password: 'secret',
      },
    );
    const second = await services.customerAccounts.register(
      `race-${organizationId}`,
      {
        name: 'Second',
        email: `second-${organizationId}@race.test`,
        phone: '41999990002',
        password: 'secret',
      },
    );
    const context = (account: typeof first): CustomerAuthContext => ({
      actorType: 'CUSTOMER',
      organizationId,
      customerId: String(account.customer.customerId),
      customerAccountId: String(account.account.customerAccountId),
    });
    const start = new Date(Date.now() + 3 * 86400000);
    start.setUTCHours(18, 0, 0, 0);
    const slot = {
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 60 * 60000).toISOString(),
    };
    const results = await Promise.allSettled([
      services.customerBookings.create(context(first), {
        courtId: court.courtId,
        ...slot,
      }),
      services.customerBookings.create(context(second), {
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
  });
});
