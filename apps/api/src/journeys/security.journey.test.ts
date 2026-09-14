import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { call, dateAhead, journey, slot } from '../testing/journey-fixture.js';

describe('journey: authorization boundaries', () => {
  async function twoCustomersWithActivity() {
    const fixture = await journey({ reservationMode: 'AUTO_CONFIRM' });
    const { app, venue, otherVenue, customer, staffLogin } = fixture;
    const staff = await staffLogin();
    const ana = await customer();
    const bea = await customer();
    const foreigner = await customer({}, otherVenue);

    const booking = await call(
      app,
      'POST',
      '/customer/reservations',
      bea.token,
      slot(venue.courts.tennis, 3),
    );
    const reservationId = booking.body.data.reservationId as string;
    const participantId = randomUUID();
    await call(
      app,
      'PUT',
      `/customer/reservations/${reservationId}/participants/${participantId}`,
      bea.token,
      { name: 'Bea guest' },
    );
    const occupied = await call(
      app,
      'POST',
      '/customer/reservations',
      ana.token,
      slot(venue.courts.padel, 3),
    );
    const waitlist = await call(
      app,
      'POST',
      '/customer/waitlists/court',
      bea.token,
      {
        courtId: venue.courts.padel,
        desiredDate: dateAhead(3),
        desiredStartTime: '18:00',
        durationMinutes: 60,
      },
    );
    expect(occupied.status).toBe(201);
    expect(waitlist.status).toBe(201);
    return {
      ...fixture,
      staff,
      ana,
      bea,
      foreigner,
      reservationId,
      participantId,
      waitlistId: waitlist.body.data.waitlistId as string,
    };
  }

  it("keeps customer A out of customer B's reservations, participants, and waitlists", async () => {
    const { app, repo, ana, foreigner, bea, reservationId, participantId, waitlistId } =
      await twoCustomersWithActivity();
    for (const intruder of [ana.token, foreigner.token]) {
      const attempts = [
        call(app, 'GET', `/customer/reservations/${reservationId}`, intruder),
        call(app, 'POST', `/customer/reservations/${reservationId}/cancel`, intruder),
        call(app, 'GET', `/customer/reservations/${reservationId}/rebook`, intruder),
        call(app, 'GET', `/customer/reservations/${reservationId}/participants`, intruder),
        call(
          app,
          'PUT',
          `/customer/reservations/${reservationId}/participants/${participantId}`,
          intruder,
          { name: 'Hijack' },
        ),
        call(
          app,
          'DELETE',
          `/customer/reservations/${reservationId}/participants/${participantId}`,
          intruder,
        ),
        call(app, 'DELETE', `/customer/waitlists/${waitlistId}`, intruder),
      ];
      for (const response of await Promise.all(attempts))
        expect(response.status).toBe(404);
      const waitlists = await call(app, 'GET', '/customer/waitlists', intruder);
      expect(JSON.stringify(waitlists.body)).not.toContain(waitlistId);
      const upcoming = await call(
        app,
        'GET',
        '/customer/reservations/upcoming',
        intruder,
      );
      expect(JSON.stringify(upcoming.body)).not.toContain(reservationId);
    }
    // Forged identity in query or body is ignored in favour of the session.
    const me = await call(
      app,
      'GET',
      `/customer/me?customerId=${bea.customerId}`,
      ana.token,
    );
    expect(me.body.data.customerId).toBe(ana.customerId);
    // Nothing of B's changed.
    expect(
      await repo.get({ PK: `RESERVATION#${reservationId}`, SK: 'META' }),
    ).toMatchObject({ status: 'BOOKED' });
    expect(
      await repo.get({ PK: `WAITLIST#${waitlistId}`, SK: 'META' }),
    ).toMatchObject({ status: 'ACTIVE' });
    expect(
      (
        await call(
          app,
          'GET',
          `/customer/reservations/${reservationId}/participants`,
          bea.token,
        )
      ).body.data.participants,
    ).toEqual([expect.objectContaining({ name: 'Bea guest', status: 'ACTIVE' })]);
  });

  it('never lets a venue A customer act on venue B', async () => {
    const { app, otherVenue, ana, staffLogin } = await twoCustomersWithActivity();
    const otherStaff = await staffLogin(otherVenue);
    const foreignCustomer = await call(app, 'POST', '/customers', otherStaff, {
      name: 'Other venue customer',
      phone: '41955556666',
    });
    const foreignReservation = await call(app, 'POST', '/reservations', otherStaff, {
      ...slot(otherVenue.courts.tennis, 3),
      customerId: foreignCustomer.body.data.customerId,
    });
    const id = foreignReservation.body.data.reservationId as string;
    expect(
      (await call(app, 'GET', `/customer/reservations/${id}`, ana.token)).status,
    ).toBe(404);
    expect(
      (await call(app, 'POST', `/customer/reservations/${id}/cancel`, ana.token))
        .status,
    ).toBe(404);
    expect(
      (
        await call(
          app,
          'POST',
          '/customer/reservations',
          ana.token,
          slot(otherVenue.courts.tennis, 4),
        )
      ).status,
    ).toBe(404);
    const availability = await call(
      app,
      'GET',
      `/customer/availability?date=${dateAhead(3)}&durationMinutes=60&courtId=${otherVenue.courts.tennis}`,
      ana.token,
    );
    expect(availability.status).toBe(404);
  });

  it('keeps customer and staff tokens on their own routes, with sessions coexisting', async () => {
    const { app, ana, staff, customerLogin, password } =
      await twoCustomersWithActivity();
    for (const path of [
      '/customers',
      '/reservations',
      '/requests',
      '/waitlists',
      '/organization',
      '/schedule',
      '/finance/summary',
    ])
      expect((await call(app, 'GET', path, ana.token)).status).toBe(401);
    expect(
      (
        await call(app, 'PATCH', '/organization', ana.token, {
          bookingPolicy: { reservationMode: 'AUTO_CONFIRM' },
        })
      ).status,
    ).toBe(401);
    for (const path of [
      '/customer/me',
      '/customer/reservations/upcoming',
      '/customer/waitlists',
      '/customer-auth/session',
    ])
      expect((await call(app, 'GET', path, staff)).status).toBe(401);

    // Both sessions work side by side; logging one out leaves the other.
    expect((await call(app, 'GET', '/customer/me', ana.token)).status).toBe(200);
    expect((await call(app, 'GET', '/organization', staff)).status).toBe(200);
    await call(app, 'POST', '/auth/logout', staff);
    expect((await call(app, 'GET', '/organization', staff)).status).toBe(401);
    expect((await call(app, 'GET', '/customer/me', ana.token)).status).toBe(200);
    // A second customer session for the same account also coexists.
    const second = await customerLogin(ana.email, password);
    await call(app, 'POST', '/customer-auth/logout', ana.token);
    expect(
      (await call(app, 'GET', '/customer/me', second.body.data.token)).status,
    ).toBe(200);
    // A customer token cannot log out staff sessions or vice versa.
    expect(
      (await call(app, 'POST', '/auth/logout', second.body.data.token)).status,
    ).toBe(401);
  });
});
