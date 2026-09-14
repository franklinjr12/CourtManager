import { describe, expect, it } from 'vitest';
import {
  call,
  dateAhead,
  journey,
  openingHours,
  slot,
} from '../testing/journey-fixture.js';

type AvailabilityCourt = {
  courtId: string;
  sport: string;
  available: string[];
};

describe('journey: customer availability search', () => {
  it('searches all public courts by date and duration, optionally by sport', async () => {
    const { app, venue, customer } = await journey({
      reservationMode: 'AUTO_CONFIRM',
    });
    const ana = await customer();
    const date = dateAhead(5);
    const all = await call(
      app,
      'GET',
      `/customer/availability?date=${date}&durationMinutes=60`,
      ana.token,
    );
    expect(all.status).toBe(200);
    const courts = all.body.data.courts as AvailabilityCourt[];
    expect(courts.map((court) => court.courtId).sort()).toEqual(
      [venue.courts.tennis, venue.courts.padel].sort(),
    );
    expect(courts.map((court) => court.courtId)).not.toContain(
      venue.courts.private,
    );
    expect(courts[0]!.available).toContain('07:00');
    expect(courts[0]!.available).toContain('22:00');
    expect(courts[0]!.available).not.toContain('22:30');
    expect(courts[0]!.available).not.toContain('06:30');

    const padelOnly = await call(
      app,
      'GET',
      `/customer/availability?date=${date}&durationMinutes=60&sport=padel`,
      ana.token,
    );
    expect(
      (padelOnly.body.data.courts as AvailabilityCourt[]).map((c) => c.courtId),
    ).toEqual([venue.courts.padel]);

    expect(
      (
        await call(
          app,
          'GET',
          `/customer/availability?date=${date}&durationMinutes=60&courtId=${venue.courts.private}`,
          ana.token,
        )
      ).status,
    ).toBe(404);
  });

  it('removes slots occupied by reservations, blocks, and classes', async () => {
    const { app, venue, customer, staffLogin } = await journey({
      reservationMode: 'AUTO_CONFIRM',
    });
    const staff = await staffLogin();
    const ana = await customer();
    const bea = await customer();
    const date = dateAhead(6);
    const available = async () =>
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

    const before = await available();
    expect(before).toEqual(expect.arrayContaining(['09:00', '12:00', '15:00']));

    expect(
      (
        await call(
          app,
          'POST',
          '/customer/reservations',
          bea.token,
          slot(venue.courts.tennis, 6, '09:00'),
        )
      ).status,
    ).toBe(201);
    const block = await call(app, 'POST', '/blocks', staff, {
      ...slot(venue.courts.tennis, 6, '12:00'),
      reason: 'MAINTENANCE',
    });
    expect(block.status).toBe(201);
    const cls = await call(app, 'POST', '/classes', staff, {
      name: 'Morning drills',
      sport: 'Tennis',
      coachId: 'coach',
      courtId: venue.courts.tennis,
      capacity: 4,
      pricePerParticipant: 30,
      scheduleType: 'SINGLE',
      startDate: date,
      startTime: '15:00',
      durationMinutes: 60,
    });
    expect(cls.status).toBe(201);

    const after = await available();
    for (const occupied of ['08:30', '09:00', '09:30', '12:00', '15:00'])
      expect(after).not.toContain(occupied);
    expect(after).toEqual(expect.arrayContaining(['08:00', '10:00', '13:00']));

    await call(app, 'POST', `/blocks/${block.body.data.blockId}/cancel`, staff);
    expect(await available()).toContain('12:00');
  });

  it('never offers past dates, elapsed times, or closed hours', async () => {
    const { app, venue, customer, staffLogin } = await journey({
      reservationMode: 'AUTO_CONFIRM',
    });
    const staff = await staffLogin();
    const ana = await customer();
    const query = (date: string) =>
      call(
        app,
        'GET',
        `/customer/availability?date=${date}&durationMinutes=60&courtId=${venue.courts.tennis}`,
        ana.token,
      );

    const yesterday = await query(dateAhead(-1));
    expect(yesterday.status).toBe(200);
    expect(yesterday.body.data.courts).toEqual([]);

    const today = (await query(dateAhead(0))).body.data
      .courts as AvailabilityCourt[];
    const nowTime = new Date().toISOString().slice(11, 16);
    for (const time of today[0]?.available ?? [])
      expect(time > nowTime).toBe(true);

    const patched = await call(
      app,
      'PATCH',
      `/courts/${venue.courts.tennis}`,
      staff,
      { openingHours: openingHours('10:00', '14:00') },
    );
    expect(patched.status).toBe(200);
    const narrowed = (
      (await query(dateAhead(3))).body.data.courts as AvailabilityCourt[]
    )[0]!.available;
    expect(narrowed[0]).toBe('10:00');
    expect(narrowed.at(-1)).toBe('13:00');
    expect(
      (
        await call(
          app,
          'POST',
          '/customer/reservations',
          ana.token,
          slot(venue.courts.tennis, 3, '08:00'),
        )
      ).status,
    ).not.toBe(201);
  });

  it('rejects customer approval requests for a private court', async () => {
    const { app, venue, customer } = await journey({
      reservationMode: 'REQUEST_APPROVAL',
    });
    const ana = await customer();
    expect(
      (
        await call(
          app,
          'POST',
          '/customer/reservations',
          ana.token,
          slot(venue.courts.private, 3, '10:00'),
        )
      ).status,
    ).toBe(400);
  });

  // BUG: AUTO_CONFIRM customer bookings skip the publiclyRequestable check.
  // CustomerBookingService.create only validates policy and limits, so a
  // customer who knows a private court ID gets 201 and a BOOKED reservation.
  // Expected: 400 "Court is not publicly available." as in REQUEST_APPROVAL.
  it.fails('rejects instant customer bookings on a private court', async () => {
    const { app, venue, customer } = await journey({
      reservationMode: 'AUTO_CONFIRM',
    });
    const ana = await customer();
    expect(
      (
        await call(
          app,
          'POST',
          '/customer/reservations',
          ana.token,
          slot(venue.courts.private, 3, '10:00'),
        )
      ).status,
    ).toBe(400);
  });
});
