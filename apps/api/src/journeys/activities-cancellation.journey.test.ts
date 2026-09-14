import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, dateAhead, journey, slot } from '../testing/journey-fixture.js';

type AvailabilityCourt = { courtId: string; available: string[] };

afterEach(() => {
  vi.useRealTimers();
});

describe('journey: customer activities and history', () => {
  it('merges upcoming reservations and classes chronologically, and keeps finished bookings in history', async () => {
    const { app, venue, customer, staffLogin } = await journey({
      reservationMode: 'AUTO_CONFIRM',
    });
    const staff = await staffLogin();
    const ana = await customer();

    const later = await call(
      app,
      'POST',
      '/customer/reservations',
      ana.token,
      slot(venue.courts.tennis, 6, '18:00'),
    );
    const cls = await call(app, 'POST', '/classes', staff, {
      name: 'Padel clinic',
      sport: 'Padel',
      coachId: 'coach',
      courtId: venue.courts.padel,
      capacity: 4,
      pricePerParticipant: 30,
      scheduleType: 'SINGLE',
      startDate: dateAhead(4),
      startTime: '09:00',
      durationMinutes: 60,
    });
    expect(cls.status).toBe(201);
    expect(
      (
        await call(
          app,
          'POST',
          `/customer/classes/${cls.body.data.classId}/enroll`,
          ana.token,
        )
      ).status,
    ).toBe(201);
    const sooner = await call(
      app,
      'POST',
      '/customer/reservations',
      ana.token,
      slot(venue.courts.tennis, 2, '18:00'),
    );

    const activities = await call(
      app,
      'GET',
      '/customer/activities',
      ana.token,
    );
    expect(activities.status).toBe(200);
    const items = activities.body.data as {
      activityType: string;
      sourceId: string;
      startAt: string;
    }[];
    expect(items.map((item) => item.activityType)).toEqual([
      'RESERVATION',
      'CLASS',
      'RESERVATION',
    ]);
    expect(items[0]!.sourceId).toBe(sooner.body.data.reservationId);
    expect(items[2]!.sourceId).toBe(later.body.data.reservationId);
    expect(items.map((item) => item.startAt)).toEqual(
      [...items.map((item) => item.startAt)].sort(),
    );

    // Staff finish three other bookings in different ways.
    const finished: Record<string, string> = {};
    for (const [status, time] of [
      ['COMPLETED', '08:00'],
      ['CANCELLED', '10:00'],
      ['NO_SHOW', '12:00'],
    ] as const) {
      const created = await call(app, 'POST', '/reservations', staff, {
        ...slot(venue.courts.padel, 1, time),
        customerId: ana.customerId,
      });
      const id = created.body.data.reservationId as string;
      if (status === 'COMPLETED') {
        expect(
          (await call(app, 'POST', `/reservations/${id}/check-in`, staff))
            .status,
        ).toBe(200);
        expect(
          (await call(app, 'POST', `/reservations/${id}/complete`, staff))
            .status,
        ).toBe(200);
      } else
        expect(
          (
            await call(
              app,
              'POST',
              `/reservations/${id}/${status === 'CANCELLED' ? 'cancel' : 'no-show'}`,
              staff,
            )
          ).status,
        ).toBe(200);
      finished[status] = id;
    }
    const history = await call(
      app,
      'GET',
      '/customer/reservations/history?limit=10',
      ana.token,
    );
    expect(history.status).toBe(200);
    const byId = Object.fromEntries(
      (history.body.data as { reservationId: string; status: string }[]).map(
        (row) => [row.reservationId, row.status],
      ),
    );
    expect(byId).toMatchObject({
      [finished.COMPLETED!]: 'COMPLETED',
      [finished.CANCELLED!]: 'CANCELLED',
      [finished.NO_SHOW!]: 'NO_SHOW',
    });
    const upcoming = await call(
      app,
      'GET',
      '/customer/reservations/upcoming',
      ana.token,
    );
    expect(
      (upcoming.body.data.reservations as { reservationId: string }[]).map(
        (row) => row.reservationId,
      ),
    ).not.toEqual(expect.arrayContaining([finished.CANCELLED]));
  });
});

describe('journey: customer cancellation', () => {
  it('cancels an eligible booking, frees the slot, voids the charge, and keeps history', async () => {
    const { app, repo, venue, customer, staffLogin } = await journey({
      reservationMode: 'AUTO_CONFIRM',
      cancellationCutoffHours: 6,
    });
    const staff = await staffLogin();
    const ana = await customer();
    const date = dateAhead(3);
    const booked = await call(
      app,
      'POST',
      '/customer/reservations',
      ana.token,
      slot(venue.courts.tennis, 3, '17:00'),
    );
    const reservationId = booked.body.data.reservationId as string;
    const times = async () =>
      (
        (
          await call(
            app,
            'GET',
            `/customer/availability?date=${date}&durationMinutes=60&courtId=${venue.courts.tennis}`,
            ana.token,
          )
        ).body.data.courts as AvailabilityCourt[]
      )[0]!.available;
    expect(await times()).not.toContain('17:00');

    const detail = await call(
      app,
      'GET',
      `/customer/reservations/${reservationId}`,
      ana.token,
    );
    expect(detail.body.data.cancellationEligibility.eligible).toBe(true);
    const cancelled = await call(
      app,
      'POST',
      `/customer/reservations/${reservationId}/cancel`,
      ana.token,
    );
    expect(cancelled.status).toBe(200);
    expect(await times()).toContain('17:00');

    expect(
      (
        await call(
          app,
          'GET',
          `/customer/reservations/${reservationId}`,
          ana.token,
        )
      ).body.data.status,
    ).toBe('CANCELLED');
    const history = await call(
      app,
      'GET',
      '/customer/reservations/history',
      ana.token,
    );
    expect(history.body.data).toEqual([
      expect.objectContaining({ reservationId, status: 'CANCELLED' }),
    ]);
    expect(
      (await call(app, 'GET', '/customer/reservations/upcoming', ana.token))
        .body.data.reservations,
    ).toEqual([]);
    const [charge] = await repo.scan(
      (item) =>
        item.entity === 'charge' &&
        item.chargeId === `reservation-${reservationId}`,
    );
    expect(charge).toMatchObject({ status: 'VOID' });
    const staffDetail = await call(
      app,
      'GET',
      `/reservations/${reservationId}`,
      staff,
    );
    expect(staffDetail.body.data).toMatchObject({ status: 'CANCELLED' });

    // Cancelling twice is refused; the slot can be booked again by others.
    expect(
      (
        await call(
          app,
          'POST',
          `/customer/reservations/${reservationId}/cancel`,
          ana.token,
        )
      ).status,
    ).toBe(422);
    const bea = await customer();
    expect(
      (
        await call(
          app,
          'POST',
          '/customer/reservations',
          bea.token,
          slot(venue.courts.tennis, 3, '17:00'),
        )
      ).status,
    ).toBe(201);
  });

  it('allows cancellation just before the cutoff and refuses it just after', async () => {
    // Pin the clock so the 2h cutoff lands between two on-grid bookings,
    // whatever time of day the suite runs.
    const tomorrow = dateAhead(1);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${tomorrow}T10:00:00.000Z`));
    const { app, venue, customer, staffLogin } = await journey({
      reservationMode: 'AUTO_CONFIRM',
      cancellationCutoffHours: 2,
    });
    const staff = await staffLogin();
    const ana = await customer();
    const book = async (time: string) => {
      const created = await call(app, 'POST', '/reservations', staff, {
        ...slot(venue.courts.padel, 0, time),
        customerId: ana.customerId,
      });
      expect(created.status).toBe(201);
      return created.body.data.reservationId as string;
    };
    // Cutoff 10:30 is still ahead of 10:00; cutoff 09:30 has passed.
    const justBefore = await book('12:30');
    const justAfter = await book('11:30');
    const before = await call(
      app,
      'GET',
      `/customer/reservations/${justBefore}`,
      ana.token,
    );
    expect(before.body.data.cancellationEligibility.eligible).toBe(true);
    const after = await call(
      app,
      'GET',
      `/customer/reservations/${justAfter}`,
      ana.token,
    );
    expect(after.body.data.cancellationEligibility).toMatchObject({
      eligible: false,
      reason: 'Cancellation period has ended.',
    });
    expect(
      (
        await call(
          app,
          'POST',
          `/customer/reservations/${justAfter}/cancel`,
          ana.token,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await call(
          app,
          'POST',
          `/customer/reservations/${justBefore}/cancel`,
          ana.token,
        )
      ).status,
    ).toBe(200);
    // Staff can still cancel after the customer cutoff.
    expect(
      (await call(app, 'POST', `/reservations/${justAfter}/cancel`, staff))
        .status,
    ).toBe(200);
  });

  it('withdraws a pending approval request', async () => {
    const { app, venue, customer, staffLogin } = await journey({
      reservationMode: 'REQUEST_APPROVAL',
    });
    const staff = await staffLogin();
    const ana = await customer();
    const submitted = await call(
      app,
      'POST',
      '/customer/reservations',
      ana.token,
      slot(venue.courts.tennis, 3),
    );
    const requestId = submitted.body.data.requestId as string;
    const withdrawn = await call(
      app,
      'POST',
      `/customer/reservations/${requestId}/cancel`,
      ana.token,
    );
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.data.status).toBe('WITHDRAWN');
    expect(
      (await call(app, 'GET', '/customer/reservations/upcoming', ana.token))
        .body.data.requests,
    ).toEqual([]);
    // Staff can no longer approve a withdrawn request.
    expect(
      (await call(app, 'POST', `/requests/${requestId}/confirm`, staff, {}))
        .status,
    ).toBe(422);
  });
});
