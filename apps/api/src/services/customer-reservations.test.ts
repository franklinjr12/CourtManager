import {
  DEFAULT_BOOKING_POLICY,
  type AuthContext,
} from '@court-manager/contracts';
import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../db.js';
import { buildServices } from './index.js';

const owner: AuthContext = {
  organizationId: 'org-1',
  userId: 'owner-1',
  role: 'OWNER',
};
const hours = Object.fromEntries(
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
    bookingPolicy: {
      ...DEFAULT_BOOKING_POLICY,
      bookAheadDays: 30,
      minimumReservationMinutes: 30,
      maximumReservationMinutes: 120,
    },
  });
  const services = buildServices(repo);
  const court = await services.courts.create(owner, {
    name: 'Court 1',
    sport: 'Tennis',
    slotMinutes: 30,
    defaultHourlyPrice: 80,
    publiclyRequestable: true,
    active: true,
    openingHours: hours,
  });
  const customer = await services.customers.create(owner, {
    name: 'Ana',
    phone: '41999991234',
  });
  return { repo, services, court, customer };
}

describe('CustomerReservationService rebooking', () => {
  it('suggests next weekday, preserves court/time/duration, and returns fresh availability', async () => {
    const { services, court, customer } = await setup();
    const reservation = await services.reservations.create(owner, {
      courtId: String(court.courtId),
      customerId: customer.customerId,
      startAt: '2026-09-12T10:00:00.000Z',
      endAt: '2026-09-12T11:30:00.000Z',
      source: 'STAFF',
    });
    await services.reservations.transition(
      owner,
      String(reservation.reservationId),
      'CHECKED_IN',
    );
    await services.reservations.transition(
      owner,
      String(reservation.reservationId),
      'COMPLETED',
    );

    const draft = await services.customerReservations.rebookingDraft(
      {
        organizationId: 'org-1',
        customerId: String(customer.customerId),
        customerAccountId: 'account-1',
        actorType: 'CUSTOMER',
      },
      String(reservation.reservationId),
      new Date('2026-09-13T12:00:00.000Z'),
    );

    expect(draft).toMatchObject({
      sourceReservationId: reservation.reservationId,
      date: '2026-09-19',
      startTime: '10:00',
      durationMinutes: 90,
      sport: 'Tennis',
      preferredCourtId: String(court.courtId),
    });
    expect(draft.availability.courts).toEqual([
      expect.objectContaining({
        courtId: String(court.courtId),
        available: expect.arrayContaining(['10:00']),
      }),
    ]);
  });

  it('removes private historical courts from the draft and offers compatible public courts', async () => {
    const { services, court: privateCourt, customer } = await setup();
    await services.courts.update(owner, String(privateCourt.courtId), {
      publiclyRequestable: false,
    });
    const publicCourt = await services.courts.create(owner, {
      name: 'Court 2',
      sport: 'Tennis',
      slotMinutes: 30,
      defaultHourlyPrice: 80,
      publiclyRequestable: true,
      active: true,
      openingHours: hours,
    });
    const reservation = await services.reservations.create(owner, {
      courtId: String(privateCourt.courtId),
      customerId: String(customer.customerId),
      startAt: '2026-09-12T10:00:00.000Z',
      endAt: '2026-09-12T11:00:00.000Z',
      source: 'STAFF',
    });
    await services.reservations.transition(
      owner,
      String(reservation.reservationId),
      'CHECKED_IN',
    );
    await services.reservations.transition(
      owner,
      String(reservation.reservationId),
      'COMPLETED',
    );

    const draft = await services.customerReservations.rebookingDraft(
      {
        organizationId: 'org-1',
        customerId: String(customer.customerId),
        customerAccountId: 'account-1',
        actorType: 'CUSTOMER',
      },
      String(reservation.reservationId),
      new Date('2026-09-13T12:00:00.000Z'),
    );

    expect(draft.preferredCourtId).toBeNull();
    expect(draft.availability.courts.map((item) => item.courtId)).toEqual([
      String(publicCourt.courtId),
    ]);
  });

  it('clamps the preferred weekday to the current booking horizon and rejects active reservations', async () => {
    const { services, court, customer } = await setup();
    const reservation = await services.reservations.create(owner, {
      courtId: String(court.courtId),
      customerId: customer.customerId,
      startAt: '2026-09-12T10:00:00.000Z',
      endAt: '2026-09-12T11:00:00.000Z',
      source: 'STAFF',
    });

    await expect(
      services.customerReservations.rebookingDraft(
        {
          organizationId: 'org-1',
          customerId: String(customer.customerId),
          customerAccountId: 'account-1',
          actorType: 'CUSTOMER',
        },
        String(reservation.reservationId),
        new Date('2026-09-13T12:00:00.000Z'),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });

    await services.reservations.transition(
      owner,
      String(reservation.reservationId),
      'CHECKED_IN',
    );
    await services.reservations.transition(
      owner,
      String(reservation.reservationId),
      'COMPLETED',
    );
    await services.organizations.update(owner, {
      bookingPolicy: {
        ...DEFAULT_BOOKING_POLICY,
        bookAheadDays: 2,
        minimumReservationMinutes: 30,
        maximumReservationMinutes: 120,
      },
    });

    const draft = await services.customerReservations.rebookingDraft(
      {
        organizationId: 'org-1',
        customerId: String(customer.customerId),
        customerAccountId: 'account-1',
        actorType: 'CUSTOMER',
      },
      String(reservation.reservationId),
      new Date('2026-09-13T12:00:00.000Z'),
    );

    expect(draft.date).toBe('2026-09-15');
    expect(draft.date > '2026-09-13').toBe(true);
  });
});
