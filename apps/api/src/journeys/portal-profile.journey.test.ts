import { describe, expect, it } from 'vitest';
import { call, journey } from '../testing/journey-fixture.js';

const STAFF_ONLY_FIELDS =
  /"(notes|tags|normalizedPhone|normalizedEmail|passwordHash|archived)"/;

describe('journey: customer portal profile', () => {
  it('edits own contact details and sports without exposing staff-only fields', async () => {
    const { app, services, venue, customer, customerLogin, password } =
      await journey();
    const ana = await customer({ email: 'profile@journey.test' });
    // Staff annotate the customer record with private data.
    await services.customers.update(venue.owner, ana.customerId, {
      notes: 'Owes for last month',
      tags: ['vip'],
    });

    const session = await call(app, 'GET', '/customer-auth/session', ana.token);
    const me = await call(app, 'GET', '/customer/me', ana.token);
    const login = await customerLogin('profile@journey.test', password);
    for (const response of [session, me, login]) {
      expect(response.status).toBe(200);
      expect(JSON.stringify(response.body.data.customer)).not.toMatch(
        STAFF_ONLY_FIELDS,
      );
      expect(JSON.stringify(response.body)).not.toMatch(/"passwordHash"|vip/);
      expect(JSON.stringify(response.body)).not.toContain(
        'Owes for last month',
      );
    }

    const updated = await call(app, 'PATCH', '/customer/me', ana.token, {
      name: 'Ana Maria',
      phone: '41 97777-1234',
      email: 'ana.maria@journey.test',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.customer).toMatchObject({
      name: 'Ana Maria',
      phone: '41 97777-1234',
      email: 'ana.maria@journey.test',
    });
    expect(
      (
        await call(app, 'PATCH', '/customer/me', ana.token, {
          tags: ['self-promoted'],
          notes: 'self-written',
        })
      ).status,
    ).toBe(400);
    const staffView = await services.customers.get(venue.owner, ana.customerId);
    expect(staffView).toMatchObject({
      notes: 'Owes for last month',
      tags: ['vip'],
      name: 'Ana Maria',
    });
    expect(
      (await customerLogin('ana.maria@journey.test', password)).status,
    ).toBe(200);

    const tennis = await services.sports.create(venue.owner, {
      name: 'Squash',
    });
    const padel = await services.sports.create(venue.owner, {
      name: 'Beach Tennis',
    });
    const sports = await call(app, 'PUT', '/customer/me/sports', ana.token, {
      sportIds: [tennis.sportId, padel.sportId],
      preferredSportId: padel.sportId,
    });
    expect(sports.status).toBe(200);
    expect(
      (await call(app, 'GET', '/customer/me/sports', ana.token)).body.data,
    ).toMatchObject({
      sportIds: [tennis.sportId, padel.sportId],
      preferredSportId: padel.sportId,
    });
  });
});
