import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { call, journey, slot } from '../testing/journey-fixture.js';

describe('journey: reservation participants', () => {
  it('adds, edits, and removes participants, keeping them after the booking ends', async () => {
    const { app, venue, customer, staffLogin } = await journey({
      reservationMode: 'AUTO_CONFIRM',
    });
    const staff = await staffLogin();
    const ana = await customer();
    const booked = await call(
      app,
      'POST',
      '/customer/reservations',
      ana.token,
      slot(venue.courts.tennis, 3),
    );
    const reservationId = booked.body.data.reservationId as string;
    const base = `/customer/reservations/${reservationId}/participants`;
    const joao = randomUUID();
    const carla = randomUUID();

    expect(
      (await call(app, 'PUT', `${base}/${joao}`, ana.token, { name: 'João' }))
        .status,
    ).toBe(200);
    expect(
      (
        await call(app, 'PUT', `${base}/${carla}`, ana.token, {
          name: 'Carla',
          phone: '41911112222',
        })
      ).status,
    ).toBe(200);
    const renamed = await call(app, 'PUT', `${base}/${joao}`, ana.token, {
      name: 'João Pedro',
    });
    expect(renamed.body.data).toMatchObject({
      participantId: joao,
      name: 'João Pedro',
      status: 'ACTIVE',
    });
    expect(
      (await call(app, 'DELETE', `${base}/${carla}`, ana.token)).status,
    ).toBe(200);

    const listed = await call(app, 'GET', base, ana.token);
    expect(listed.body.data).toMatchObject({ mutable: true });
    expect(listed.body.data.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ participantId: joao, name: 'João Pedro', status: 'ACTIVE' }),
        expect.objectContaining({ participantId: carla, status: 'REMOVED' }),
      ]),
    );

    // Staff cancel the reservation: participants stay visible, but frozen.
    await call(app, 'POST', `/reservations/${reservationId}/cancel`, staff);
    const frozen = await call(app, 'GET', base, ana.token);
    expect(frozen.status).toBe(200);
    expect(frozen.body.data.mutable).toBe(false);
    expect(frozen.body.data.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ participantId: joao, name: 'João Pedro' }),
      ]),
    );
    expect(
      (
        await call(app, 'PUT', `${base}/${randomUUID()}`, ana.token, {
          name: 'Too late',
        })
      ).status,
    ).not.toBe(200);
    const detail = await call(
      app,
      'GET',
      `/customer/reservations/${reservationId}`,
      ana.token,
    );
    expect(detail.body.data.participantsMutable).toBe(false);
  });

  it('matches participant contacts to registered customers without revealing it', async () => {
    const { app, venue, customer } = await journey({
      reservationMode: 'AUTO_CONFIRM',
    });
    const ana = await customer();
    await customer({ email: 'registered@journey.test', name: 'Registered Rui' });
    const booked = await call(
      app,
      'POST',
      '/customer/reservations',
      ana.token,
      slot(venue.courts.tennis, 3),
    );
    const base = `/customer/reservations/${booked.body.data.reservationId}/participants`;
    const known = await call(app, 'PUT', `${base}/${randomUUID()}`, ana.token, {
      name: 'Rui',
      email: 'registered@journey.test',
    });
    const unknown = await call(app, 'PUT', `${base}/${randomUUID()}`, ana.token, {
      name: 'Stranger',
      email: 'nobody@journey.test',
    });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(Object.keys(known.body.data).sort()).toEqual(
      Object.keys(unknown.body.data).sort(),
    );
    expect(JSON.stringify(known.body)).not.toMatch(
      /customerId|Registered Rui|linked/i,
    );
    const listed = await call(app, 'GET', base, ana.token);
    expect(JSON.stringify(listed.body)).not.toMatch(/customerId|Registered Rui/);
  });

  it("refuses changes to another customer's participants", async () => {
    const { app, venue, customer, otherVenue } = await journey({
      reservationMode: 'AUTO_CONFIRM',
    });
    const ana = await customer();
    const bea = await customer();
    const foreigner = await customer({}, otherVenue);
    const booked = await call(
      app,
      'POST',
      '/customer/reservations',
      ana.token,
      slot(venue.courts.tennis, 3),
    );
    const base = `/customer/reservations/${booked.body.data.reservationId}/participants`;
    const participantId = randomUUID();
    await call(app, 'PUT', `${base}/${participantId}`, ana.token, {
      name: 'Ana friend',
    });
    for (const intruder of [bea.token, foreigner.token]) {
      expect((await call(app, 'GET', base, intruder)).status).toBe(404);
      expect(
        (
          await call(app, 'PUT', `${base}/${participantId}`, intruder, {
            name: 'Hijacked',
          })
        ).status,
      ).toBe(404);
      expect(
        (await call(app, 'DELETE', `${base}/${participantId}`, intruder))
          .status,
      ).toBe(404);
    }
    const listed = await call(app, 'GET', base, ana.token);
    expect(listed.body.data.participants).toEqual([
      expect.objectContaining({ name: 'Ana friend', status: 'ACTIVE' }),
    ]);
  });
});
