import { describe, expect, it } from 'vitest';
import {
  call,
  dateAhead,
  journey,
  openingHours,
  slot,
} from '../testing/journey-fixture.js';

describe('journey: Book Again', () => {
  async function pastBooking(policy: Parameters<typeof journey>[0] = {}) {
    const fixture = await journey({ reservationMode: 'AUTO_CONFIRM', ...policy });
    const staff = await fixture.staffLogin();
    const ana = await fixture.customer();
    const booked = await call(
      fixture.app,
      'POST',
      '/customer/reservations',
      ana.token,
      slot(fixture.venue.courts.tennis, 2, '16:00', 90),
    );
    expect(booked.status).toBe(201);
    const reservationId = booked.body.data.reservationId as string;
    // Staff close the booking so it becomes history.
    await call(fixture.app, 'POST', `/reservations/${reservationId}/cancel`, staff);
    return { ...fixture, staff, ana, reservationId };
  }

  it('prefills court, time, and duration on a future date and rechecks availability', async () => {
    const { app, venue, ana, reservationId } = await pastBooking();
    const draft = await call(
      app,
      'GET',
      `/customer/reservations/${reservationId}/rebook`,
      ana.token,
    );
    expect(draft.status).toBe(200);
    expect(draft.body.data).toMatchObject({
      sourceReservationId: reservationId,
      preferredCourtId: venue.courts.tennis,
      startTime: '16:00',
      durationMinutes: 90,
      sport: 'Tennis',
    });
    expect(draft.body.data.date > dateAhead(0)).toBe(true);
    const { date, startTime, durationMinutes } = draft.body.data as {
      date: string;
      startTime: string;
      durationMinutes: number;
    };
    expect(
      draft.body.data.availability.courts.find(
        (court: { courtId: string }) => court.courtId === venue.courts.tennis,
      ).available,
    ).toContain(startTime);
    const startAt = new Date(`${date}T${startTime}:00.000Z`);
    const rebooked = await call(
      app,
      'POST',
      '/customer/reservations',
      ana.token,
      {
        courtId: venue.courts.tennis,
        startAt: startAt.toISOString(),
        endAt: new Date(startAt.getTime() + durationMinutes * 60000).toISOString(),
      },
    );
    expect(rebooked.status).toBe(201);
    expect(rebooked.body.data.status).toBe('BOOKED');
  });

  it('still enforces current availability and policy when submitting the draft', async () => {
    const { app, venue, staff, ana, reservationId, setPolicy } =
      await pastBooking();
    const draft = (
      await call(app, 'GET', `/customer/reservations/${reservationId}/rebook`, ana.token)
    ).body.data as { date: string; startTime: string; durationMinutes: number };
    const startAt = new Date(`${draft.date}T${draft.startTime}:00.000Z`);
    const input = {
      courtId: venue.courts.tennis,
      startAt: startAt.toISOString(),
      endAt: new Date(startAt.getTime() + draft.durationMinutes * 60000).toISOString(),
    };
    // Someone else takes the time after the draft was loaded.
    const bea = await call(app, 'POST', '/customers', staff, {
      name: 'Bea',
      phone: '41900001111',
    });
    expect(
      (
        await call(app, 'POST', '/reservations', staff, {
          ...input,
          customerId: bea.body.data.customerId,
        })
      ).status,
    ).toBe(201);
    const refreshed = await call(
      app,
      'GET',
      `/customer/reservations/${reservationId}/rebook`,
      ana.token,
    );
    expect(
      refreshed.body.data.availability.courts.find(
        (court: { courtId: string }) => court.courtId === venue.courts.tennis,
      ).available,
    ).not.toContain(draft.startTime);
    expect(
      (await call(app, 'POST', '/customer/reservations', ana.token, input))
        .status,
    ).toBe(409);

    await setPolicy(staff, { reservationMode: 'STAFF_ONLY' });
    expect(
      (
        await call(app, 'POST', '/customer/reservations', ana.token, {
          ...input,
          courtId: venue.courts.padel,
        })
      ).status,
    ).toBe(403);
  });

  it('drops an archived or private original court from the draft and offers alternatives', async () => {
    const { app, venue, staff, ana, reservationId } = await pastBooking();
    const alternative = await call(app, 'POST', '/courts', staff, {
      name: 'Alternative Tennis',
      sport: 'Tennis',
      slotMinutes: 30,
      defaultHourlyPrice: 80,
      publiclyRequestable: true,
      active: true,
      openingHours: openingHours(),
    });
    expect(alternative.status).toBe(201);
    expect(
      (
        await call(app, 'PATCH', `/courts/${venue.courts.tennis}`, staff, {
          publiclyRequestable: false,
        })
      ).status,
    ).toBe(200);
    const privateDraft = await call(
      app,
      'GET',
      `/customer/reservations/${reservationId}/rebook`,
      ana.token,
    );
    expect(privateDraft.status).toBe(200);
    expect(privateDraft.body.data.preferredCourtId).toBeNull();
    expect(
      (privateDraft.body.data.availability.courts as { courtId: string }[]).map(
        (court) => court.courtId,
      ),
    ).toEqual([alternative.body.data.courtId]);

    await call(app, 'PATCH', `/courts/${venue.courts.tennis}`, staff, {
      publiclyRequestable: true,
    });
    expect(
      (await call(app, 'POST', `/courts/${venue.courts.tennis}/archive`, staff))
        .status,
    ).toBe(200);
    const archivedDraft = await call(
      app,
      'GET',
      `/customer/reservations/${reservationId}/rebook`,
      ana.token,
    );
    expect(archivedDraft.status).toBe(200);
    expect(archivedDraft.body.data.preferredCourtId).toBeNull();
  });

  // BUG: when the original court becomes private/archived and no other public
  // court of the same sport remains, GET /customer/reservations/:id/rebook
  // returns 400 "Reservation duration is not allowed by venue policy."
  // (CustomerBookingService.availability throws when no court matches).
  // Expected: a draft with preferredCourtId null and no available courts, so
  // the portal can explain the court is unavailable.
  it.fails('still returns a draft when no public court of the sport remains', async () => {
    const { app, venue, staff, ana, reservationId } = await pastBooking();
    await call(app, 'POST', `/courts/${venue.courts.tennis}/archive`, staff);
    const draft = await call(
      app,
      'GET',
      `/customer/reservations/${reservationId}/rebook`,
      ana.token,
    );
    expect(draft.status).toBe(200);
    expect(draft.body.data).toMatchObject({
      preferredCourtId: null,
      availability: { courts: [] },
    });
  });

  it('refuses Book Again for an active booking or another customer', async () => {
    const { app, venue, ana, reservationId, customer } = await pastBooking();
    const active = await call(
      app,
      'POST',
      '/customer/reservations',
      ana.token,
      slot(venue.courts.padel, 3),
    );
    expect(
      (
        await call(
          app,
          'GET',
          `/customer/reservations/${active.body.data.reservationId}/rebook`,
          ana.token,
        )
      ).status,
    ).toBe(422);
    const bea = await customer();
    expect(
      (
        await call(
          app,
          'GET',
          `/customer/reservations/${reservationId}/rebook`,
          bea.token,
        )
      ).status,
    ).toBe(404);
  });
});
