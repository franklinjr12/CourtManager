import { describe, expect, it } from 'vitest';
import {
  call,
  dateAhead,
  journey,
  nextWeekday,
  slot,
} from '../testing/journey-fixture.js';

type AvailabilityCourt = { courtId: string; available: string[] };

const availableTimes = async (
  app: Awaited<ReturnType<typeof journey>>['app'],
  token: string,
  courtId: string,
  date: string,
  durationMinutes = 60,
) => {
  const response = await call(
    app,
    'GET',
    `/customer/availability?date=${date}&durationMinutes=${durationMinutes}&courtId=${courtId}`,
    token,
  );
  expect(response.status).toBe(200);
  return (response.body.data.courts as AvailabilityCourt[])[0]?.available ?? [];
};

describe('journey: STAFF_ONLY venue', () => {
  it('lets customers browse but only staff book', async () => {
    const { app, venue, customer, staffLogin } = await journey({
      reservationMode: 'STAFF_ONLY',
    });
    const ana = await customer();
    const staff = await staffLogin();

    const venuePage = await call(app, 'GET', `/public/venues/${venue.slug}`);
    expect(venuePage.status).toBe(200);
    expect(venuePage.body.data.bookingPolicy.reservationMode).toBe(
      'STAFF_ONLY',
    );
    const policy = await call(
      app,
      'GET',
      '/customer/booking-policy',
      ana.token,
    );
    expect(policy.body.data.reservationMode).toBe('STAFF_ONLY');
    const availability = await call(
      app,
      'GET',
      `/customer/availability?date=${dateAhead(2)}&durationMinutes=60`,
      ana.token,
    );
    expect(availability.body.data).toMatchObject({
      courts: [],
      onlineBookingAvailable: false,
    });

    const attempt = await call(
      app,
      'POST',
      '/customer/reservations',
      ana.token,
      slot(venue.courts.tennis, 2),
    );
    expect(attempt.status).toBe(403);
    expect(attempt.body.error.message).toMatch(/Online booking is disabled/);
    const target = slot(venue.courts.tennis, 2);
    const anonymous = await call(
      app,
      'POST',
      `/public/venues/${venue.slug}/requests`,
      undefined,
      {
        courtId: target.courtId,
        requestedStartAt: target.startAt,
        requestedEndAt: target.endAt,
        customerName: 'Anonymous',
        phone: '41999990000',
      },
    );
    expect(anonymous.status).toBe(403);

    const staffBooking = await call(app, 'POST', '/reservations', staff, {
      ...target,
      customerId: ana.customerId,
    });
    expect(staffBooking.status).toBe(201);
    expect(staffBooking.body.data.status).toBe('BOOKED');
  });
});

describe('journey: REQUEST_APPROVAL venue', () => {
  it('submits a Saturday 90-minute request that staff approve into a reservation', async () => {
    const { app, venue, customer, staffLogin } = await journey({
      reservationMode: 'REQUEST_APPROVAL',
    });
    const ana = await customer();
    const staff = await staffLogin();
    const saturday = nextWeekday(6);

    const before = await availableTimes(
      app,
      ana.token,
      venue.courts.tennis,
      saturday.date,
      90,
    );
    expect(before).toContain('10:00');
    const submitted = await call(
      app,
      'POST',
      '/customer/reservations',
      ana.token,
      slot(venue.courts.tennis, saturday.daysAhead, '10:00', 90),
    );
    expect(submitted.status).toBe(201);
    expect(submitted.body.data).toMatchObject({
      status: 'REQUESTED',
      linkedCustomerId: ana.customerId,
    });
    const requestId = submitted.body.data.requestId as string;

    const pending = await call(
      app,
      'GET',
      '/customer/reservations/upcoming',
      ana.token,
    );
    expect(pending.body.data.reservations).toEqual([]);
    expect(pending.body.data.requests).toEqual([
      expect.objectContaining({
        itemType: 'REQUEST',
        requestId,
        status: 'REQUESTED',
      }),
    ]);
    // Requests do not occupy the schedule.
    expect(
      await availableTimes(
        app,
        ana.token,
        venue.courts.tennis,
        saturday.date,
        90,
      ),
    ).toContain('10:00');

    const inbox = await call(app, 'GET', '/requests', staff);
    const listed = (
      inbox.body.data as { requestId: string; linkedCustomerId: string }[]
    ).find((item) => item.requestId === requestId);
    expect(listed).toMatchObject({ linkedCustomerId: ana.customerId });
    // The staff inbox preselects the linked customer when confirming.
    const confirmed = await call(
      app,
      'POST',
      `/requests/${requestId}/confirm`,
      staff,
      { customerId: listed!.linkedCustomerId },
    );
    expect(confirmed.status).toBe(200);
    const reservationId = confirmed.body.data.reservationId as string;

    const after = await call(
      app,
      'GET',
      '/customer/reservations/upcoming',
      ana.token,
    );
    expect(after.body.data.requests).toEqual([]);
    expect(after.body.data.reservations).toEqual([
      expect.objectContaining({
        itemType: 'RESERVATION',
        reservationId,
        status: 'BOOKED',
        durationMinutes: 90,
      }),
    ]);
    const times = await availableTimes(
      app,
      ana.token,
      venue.courts.tennis,
      saturday.date,
      90,
    );
    expect(times).not.toContain('10:00');
    expect(times).not.toContain('11:00');
  });

  async function rejectedRequest() {
    const fixture = await journey({ reservationMode: 'REQUEST_APPROVAL' });
    const ana = await fixture.customer();
    const staff = await fixture.staffLogin();
    const submitted = await call(
      fixture.app,
      'POST',
      '/customer/reservations',
      ana.token,
      slot(fixture.venue.courts.tennis, 3),
    );
    const requestId = submitted.body.data.requestId as string;
    expect(
      (
        await call(
          fixture.app,
          'POST',
          `/requests/${requestId}/reject`,
          staff,
          {
            reason: 'Tournament',
          },
        )
      ).status,
    ).toBe(200);
    return { ...fixture, ana, requestId };
  }

  // BUG: RequestService.reject updates only the REQUEST# record and not the
  // customer's RESERVATION_REQUEST# index (confirm and withdraw update both).
  // /customer/reservations/upcoming filters that index on status REQUESTED,
  // so a rejected request keeps showing as pending in the portal forever.
  it.fails(
    'removes a rejected request from the customer pending list',
    async () => {
      const { app, ana } = await rejectedRequest();
      const upcoming = await call(
        app,
        'GET',
        '/customer/reservations/upcoming',
        ana.token,
      );
      expect(upcoming.body.data.requests).toEqual([]);
    },
  );

  it('frees the active booking allowance and refuses withdrawal after staff reject a request', async () => {
    const { app, venue, ana, requestId, repo } = await rejectedRequest();
    expect(
      await repo.get({ PK: `REQUEST#${requestId}`, SK: 'META' }),
    ).toMatchObject({ status: 'REJECTED', rejectionReason: 'Tournament' });
    // The rejected request no longer counts as an active booking.
    expect(
      (
        await call(
          app,
          'POST',
          '/customer/reservations',
          ana.token,
          slot(venue.courts.tennis, 3),
        )
      ).status,
    ).toBe(201);
    // A rejected request can no longer be withdrawn.
    expect(
      (
        await call(
          app,
          'POST',
          `/customer/reservations/${requestId}/cancel`,
          ana.token,
        )
      ).status,
    ).toBe(422);
  });

  // BUG: confirming a customer-linked request without an explicit customerId
  // creates a brand-new customer from the request's name/phone instead of
  // reusing request.linkedCustomerId. The portal customer never sees the
  // confirmed reservation (and the venue gets a duplicate customer). The
  // staff UI only avoids this when the linked customer is among the first
  // 100 customers loaded into the confirm dialog.
  it.fails(
    'keeps the portal customer when a linked request is confirmed without an explicit customer',
    async () => {
      const { app, venue, customer, staffLogin } = await journey({
        reservationMode: 'REQUEST_APPROVAL',
      });
      const ana = await customer();
      const staff = await staffLogin();
      const submitted = await call(
        app,
        'POST',
        '/customer/reservations',
        ana.token,
        slot(venue.courts.tennis, 3),
      );
      const confirmed = await call(
        app,
        'POST',
        `/requests/${submitted.body.data.requestId}/confirm`,
        staff,
        {},
      );
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.data.customerId).toBe(ana.customerId);
    },
  );
});

describe('journey: AUTO_CONFIRM venue', () => {
  it('books instantly, occupies the slot, charges, and shows for staff and customer', async () => {
    const { app, venue, customer, staffLogin } = await journey({
      reservationMode: 'AUTO_CONFIRM',
    });
    const ana = await customer();
    const staff = await staffLogin();
    const date = dateAhead(4);
    expect(
      await availableTimes(app, ana.token, venue.courts.tennis, date),
    ).toContain('19:00');

    const booked = await call(
      app,
      'POST',
      '/customer/reservations',
      ana.token,
      slot(venue.courts.tennis, 4, '19:00'),
    );
    expect(booked.status).toBe(201);
    expect(booked.body.data).toMatchObject({
      status: 'BOOKED',
      customerId: ana.customerId,
      source: 'CUSTOMER_PORTAL',
    });
    const reservationId = booked.body.data.reservationId as string;

    expect(
      await availableTimes(app, ana.token, venue.courts.tennis, date),
    ).not.toContain('19:00');

    const activities = await call(
      app,
      'GET',
      '/customer/activities',
      ana.token,
    );
    expect(activities.body.data).toEqual([
      expect.objectContaining({
        activityType: 'RESERVATION',
        sourceId: reservationId,
        status: 'BOOKED',
      }),
    ]);
    const upcoming = await call(
      app,
      'GET',
      '/customer/reservations/upcoming',
      ana.token,
    );
    expect(upcoming.body.data.reservations).toEqual([
      expect.objectContaining({ reservationId, status: 'BOOKED' }),
    ]);

    const schedule = await call(app, 'GET', `/schedule?date=${date}`, staff);
    expect(schedule.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reservationId, customerId: ana.customerId }),
      ]),
    );
    const charges = await call(app, 'GET', '/charges', staff);
    expect(charges.status).toBe(200);
    expect(charges.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          customerId: ana.customerId,
          status: 'ACTIVE',
          amount: 80,
        }),
      ]),
    );
  });

  it('lets only one of two customers win the same slot at the same time', async () => {
    const { app, repo, venue, customer } = await journey({
      reservationMode: 'AUTO_CONFIRM',
    });
    const ana = await customer();
    const bea = await customer();
    const target = slot(venue.courts.tennis, 5, '20:00');
    const results = await Promise.all([
      call(app, 'POST', '/customer/reservations', ana.token, target),
      call(app, 'POST', '/customer/reservations', bea.token, target),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(
      results.find((result) => result.status === 409)?.body.error.code,
    ).toBe('SCHEDULE_CONFLICT');
    expect(
      await repo.scan(
        (item) =>
          item.entity === 'reservation' &&
          item.courtId === venue.courts.tennis &&
          item.status === 'BOOKED',
      ),
    ).toHaveLength(1);

    // An overlapping (not identical) slot is also refused.
    const overlap = await call(
      app,
      'POST',
      '/customer/reservations',
      bea.token,
      slot(venue.courts.tennis, 5, '20:30'),
    );
    expect(overlap.status).toBe(409);
  });
});
