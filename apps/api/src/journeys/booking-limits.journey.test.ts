import { describe, expect, it } from 'vitest';
import { call, journey, slot } from '../testing/journey-fixture.js';

describe('journey: booking policy limits', () => {
  it('accepts bookings exactly at the horizon and rejects one day beyond', async () => {
    const { app, venue, customer } = await journey({
      reservationMode: 'AUTO_CONFIRM',
      bookAheadDays: 10,
    });
    const ana = await customer();
    const atHorizon = await call(
      app,
      'POST',
      '/customer/reservations',
      ana.token,
      slot(venue.courts.tennis, 10),
    );
    expect(atHorizon.status).toBe(201);
    const beyond = await call(
      app,
      'POST',
      '/customer/reservations',
      ana.token,
      slot(venue.courts.tennis, 11),
    );
    expect(beyond.status).toBe(400);
    expect(beyond.body.error.message).toMatch(/booking window/);
  });

  it('rejects durations below minimum and above maximum', async () => {
    const { app, venue, customer } = await journey({
      reservationMode: 'AUTO_CONFIRM',
      minimumReservationMinutes: 60,
      maximumReservationMinutes: 90,
    });
    const ana = await customer();
    const book = (minutes: number, time: string) =>
      call(
        app,
        'POST',
        '/customer/reservations',
        ana.token,
        slot(venue.courts.tennis, 2, time, minutes),
      );
    expect((await book(30, '08:00')).status).toBe(400);
    expect((await book(120, '10:00')).status).toBe(400);
    expect((await book(60, '12:00')).status).toBe(201);
    expect((await book(90, '14:00')).status).toBe(201);
    const availability = await call(
      app,
      'GET',
      `/customer/availability?date=${slot(venue.courts.tennis, 2).startAt.slice(0, 10)}&durationMinutes=120`,
      ana.token,
    );
    expect(availability.status).toBe(400);
  });

  it('stops at maximum active bookings, counting pending requests', async () => {
    const { app, venue, customer, staffLogin, setPolicy } = await journey({
      reservationMode: 'AUTO_CONFIRM',
      maximumActiveBookings: 2,
    });
    const staff = await staffLogin();
    const ana = await customer();
    const book = (time: string) =>
      call(
        app,
        'POST',
        '/customer/reservations',
        ana.token,
        slot(venue.courts.tennis, 3, time),
      );
    expect((await book('08:00')).status).toBe(201);
    expect((await book('10:00')).status).toBe(201);
    const third = await book('12:00');
    expect(third.status).toBe(409);
    expect(third.body.error.message).toMatch(/Maximum active/);

    // Switch to approval: the limit counts bookings plus pending requests.
    await setPolicy(staff, {
      reservationMode: 'REQUEST_APPROVAL',
      maximumActiveBookings: 3,
    });
    expect((await book('14:00')).status).toBe(201);
    const overRequest = await book('16:00');
    expect(overRequest.status).toBe(409);

    // Staff are never limited by customer booking policy.
    const staffBooking = await call(app, 'POST', '/reservations', staff, {
      ...slot(venue.courts.tennis, 3, '18:00', 150),
      customerId: ana.customerId,
    });
    expect(staffBooking.status).toBe(201);
    const staffBeyondHorizon = await call(app, 'POST', '/reservations', staff, {
      ...slot(venue.courts.tennis, 120, '18:00', 30),
      customerId: ana.customerId,
    });
    expect(staffBeyondHorizon.status).toBe(201);
  });

  it('applies booking mode changes from Settings on the next customer request', async () => {
    const { app, venue, customer, staffLogin, setPolicy } = await journey({
      reservationMode: 'AUTO_CONFIRM',
    });
    const staff = await staffLogin();
    const ana = await customer();
    const book = (time: string) =>
      call(
        app,
        'POST',
        '/customer/reservations',
        ana.token,
        slot(venue.courts.tennis, 4, time),
      );

    const confirmed = await book('08:00');
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.data.status).toBe('BOOKED');

    await setPolicy(staff, { reservationMode: 'STAFF_ONLY' });
    expect(
      (await call(app, 'GET', '/customer/booking-policy', ana.token)).body.data
        .reservationMode,
    ).toBe('STAFF_ONLY');
    expect((await book('10:00')).status).toBe(403);

    await setPolicy(staff, { reservationMode: 'REQUEST_APPROVAL' });
    const requested = await book('10:00');
    expect(requested.status).toBe(201);
    expect(requested.body.data.status).toBe('REQUESTED');

    // Staff booking is unaffected by any mode.
    await setPolicy(staff, { reservationMode: 'STAFF_ONLY' });
    expect(
      (
        await call(app, 'POST', '/reservations', staff, {
          ...slot(venue.courts.tennis, 4, '12:00'),
          customerId: ana.customerId,
        })
      ).status,
    ).toBe(201);
  });
});
