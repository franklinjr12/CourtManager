import { describe, expect, it } from 'vitest';
import { call, dateAhead, journey, slot } from '../testing/journey-fixture.js';

type AvailabilityResponse = { available: string[] };

describe('journey: staff regression pass after Phase 2', () => {
  it('keeps staff operational screens working', async () => {
    const { app, venue, staffLogin, customer } = await journey({
      reservationMode: 'AUTO_CONFIRM',
    });
    const staff = await staffLogin();
    const ana = await customer();
    await call(
      app,
      'POST',
      '/customer/reservations',
      ana.token,
      slot(venue.courts.tennis, 0, '23:00', 60),
    );
    for (const path of [
      '/today',
      `/schedule?date=${dateAhead(1)}`,
      '/reservations',
      '/requests',
      '/customers',
      '/classes',
      '/finance/summary',
      '/charges',
      '/waitlists',
      '/blocks',
      '/organization',
      '/courts',
    ]) {
      const response = await call(app, 'GET', path, staff);
      expect({ path, status: response.status }).toEqual({ path, status: 200 });
    }
  });

  it('handles anonymous public requests through staff confirmation', async () => {
    const { app, venue, staffLogin } = await journey({
      reservationMode: 'REQUEST_APPROVAL',
    });
    const staff = await staffLogin();
    const target = slot(venue.courts.tennis, 3, '09:00', 90);
    const publicAvailability = await call(
      app,
      'GET',
      `/public/venues/${venue.slug}/availability?courtId=${venue.courts.tennis}&date=${dateAhead(3)}&durationMinutes=90`,
    );
    expect(publicAvailability.status).toBe(200);
    const request = await call(
      app,
      'POST',
      `/public/venues/${venue.slug}/requests`,
      undefined,
      {
        courtId: target.courtId,
        requestedStartAt: target.startAt,
        requestedEndAt: target.endAt,
        customerName: 'Walk-up Wanda',
        phone: '41922223333',
      },
    );
    expect(request.status).toBe(201);
    const confirmed = await call(
      app,
      'POST',
      `/requests/${request.body.data.requestId}/confirm`,
      staff,
      {},
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.status).toBe('BOOKED');
    const customers = await call(app, 'GET', '/customers?search=Wanda', staff);
    expect(customers.body.data).toEqual([
      expect.objectContaining({ name: 'Walk-up Wanda' }),
    ]);
  });

  it('runs check-in, completion, no-show, recurring series, and court blocks', async () => {
    const { app, venue, staffLogin } = await journey();
    const staff = await staffLogin();
    const created = await call(app, 'POST', '/customers', staff, {
      name: 'Regular Rita',
      phone: '41944445555',
    });
    const customerId = created.body.data.customerId as string;

    const first = await call(app, 'POST', '/reservations', staff, {
      ...slot(venue.courts.tennis, 1, '08:00'),
      customerId,
    });
    const id = first.body.data.reservationId as string;
    expect(
      (await call(app, 'POST', `/reservations/${id}/check-in`, staff)).body.data
        .status,
    ).toBe('CHECKED_IN');
    expect(
      (await call(app, 'POST', `/reservations/${id}/complete`, staff)).body.data
        .status,
    ).toBe('COMPLETED');
    const second = await call(app, 'POST', '/reservations', staff, {
      ...slot(venue.courts.tennis, 1, '10:00'),
      customerId,
    });
    expect(
      (
        await call(
          app,
          'POST',
          `/reservations/${second.body.data.reservationId}/no-show`,
          staff,
        )
      ).body.data.status,
    ).toBe('NO_SHOW');
    // A completed booking keeps its time; a no-show releases it.
    expect(
      (
        await call(app, 'POST', '/reservations', staff, {
          ...slot(venue.courts.tennis, 1, '08:30'),
          customerId,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(app, 'POST', '/reservations', staff, {
          ...slot(venue.courts.tennis, 1, '10:00'),
          customerId,
        })
      ).status,
    ).toBe(201);

    const start = slot(venue.courts.padel, 2, '19:00');
    const recurring = await call(
      app,
      'POST',
      '/reservations/recurring',
      staff,
      {
        ...start,
        customerId,
        untilDate: dateAhead(2 + 21),
      },
    );
    expect(recurring.status).toBe(201);
    expect(
      (
        await call(app, 'POST', '/reservations', staff, {
          ...slot(venue.courts.padel, 9, '19:00'),
          customerId,
        })
      ).status,
    ).toBe(409);

    const availability = async () =>
      (
        (
          await call(
            app,
            'GET',
            `/availability?courtId=${venue.courts.tennis}&date=${dateAhead(4)}&durationMinutes=60`,
            staff,
          )
        ).body.data as AvailabilityResponse
      ).available;
    expect(await availability()).toContain('14:00');
    const block = await call(app, 'POST', '/blocks', staff, {
      ...slot(venue.courts.tennis, 4, '14:00', 120),
      reason: 'TOURNAMENT',
    });
    expect(block.status).toBe(201);
    expect(await availability()).not.toContain('14:00');
    expect(
      (
        await call(app, 'POST', '/reservations', staff, {
          ...slot(venue.courts.tennis, 4, '15:00'),
          customerId,
        })
      ).status,
    ).toBe(409);
    await call(app, 'POST', `/blocks/${block.body.data.blockId}/cancel`, staff);
    expect(await availability()).toContain('14:00');
  });
});
