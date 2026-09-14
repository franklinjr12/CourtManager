import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { MemoryRepository } from './db.js';
import { hashToken } from './security.js';
import { buildServices } from './services/index.js';

const ownerContext = {
  organizationId: 'org-one',
  userId: 'owner-1',
  role: 'OWNER' as const,
};
const openingHours = Object.fromEntries(
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

const organization = (organizationId: string, slug: string) => ({
  PK: `ORG#${organizationId}`,
  SK: 'META',
  entity: 'organization' as const,
  organizationId,
  slug,
  name: slug,
  timezone: 'UTC',
  currency: 'BRL',
  active: true,
  features: { classes: false, finance: false },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

async function setup() {
  const repo = new MemoryRepository();
  await repo.put(organization('org-one', 'arena-one'));
  await repo.put(organization('org-two', 'arena-two'));
  const services = buildServices(repo);
  const first = await services.customerAccounts.register('arena-one', {
    name: 'Ana One',
    email: 'ana@example.test',
    phone: '41999990001',
    password: 'secret',
  });
  const second = await services.customerAccounts.register('arena-two', {
    name: 'Ana Two',
    email: 'ana@example.test',
    phone: '41999990002',
    password: 'secret',
  });
  return { app: createApp(repo), first, repo, second };
}

const login = async (app: ReturnType<typeof createApp>, slug: string) => {
  const response = await app.request('/customer-auth/login', {
    method: 'POST',
    body: JSON.stringify({
      slug,
      email: 'ana@example.test',
      password: 'secret',
    }),
    headers: { 'Content-Type': 'application/json' },
  });
  return response;
};

describe('customer authentication HTTP boundary', () => {
  it('returns only own reservation lifecycle, paginated history, and pending requests', async () => {
    const { app, first, repo } = await setup();
    const services = buildServices(repo);
    const court = await services.courts.create(ownerContext, {
      name: 'History court',
      sport: 'Tennis',
      slotMinutes: 30,
      defaultHourlyPrice: 80,
      publiclyRequestable: true,
      active: true,
      openingHours,
    });
    const other = await services.customerAccounts.register('arena-one', {
      name: 'Other',
      email: 'other@example.test',
      phone: '41999990003',
      password: 'secret',
    });
    const created = await services.reservations.create(ownerContext, {
      courtId: String(court.courtId),
      customerId: String(first.customer.customerId),
      startAt: '2027-01-03T18:00:00.000Z',
      endAt: '2027-01-03T19:00:00.000Z',
      source: 'STAFF',
    });
    await services.reservations.transition(
      ownerContext,
      String(created.reservationId),
      'CANCELLED',
    );
    const second = await services.reservations.create(ownerContext, {
      courtId: String(court.courtId),
      customerId: String(first.customer.customerId),
      startAt: '2027-01-04T18:00:00.000Z',
      endAt: '2027-01-04T19:00:00.000Z',
      source: 'STAFF',
    });
    await services.reservations.transition(
      ownerContext,
      String(second.reservationId),
      'NO_SHOW',
    );
    const foreign = await services.reservations.create(ownerContext, {
      courtId: String(court.courtId),
      customerId: String(other.customer.customerId),
      startAt: '2027-01-05T18:00:00.000Z',
      endAt: '2027-01-05T19:00:00.000Z',
      source: 'STAFF',
    });
    await services.organizations.update(ownerContext, {
      bookingPolicy: {
        reservationMode: 'REQUEST_APPROVAL',
        bookAheadDays: 365,
        cancellationCutoffHours: 6,
        minimumReservationMinutes: 60,
        maximumReservationMinutes: 60,
        maximumActiveBookings: 3,
      },
    });
    const loginResponse = await login(app, 'arena-one');
    const token = ((await loginResponse.json()) as { data: { token: string } })
      .data.token;
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    const future = new Date(Date.now() + 2 * 86400000);
    future.setUTCHours(18, 0, 0, 0);
    expect(
      (
        await app.request('/customer/reservations', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            courtId: court.courtId,
            startAt: future.toISOString(),
            endAt: new Date(future.getTime() + 3600000).toISOString(),
          }),
        })
      ).status,
    ).toBe(201);
    const upcoming = await app.request('/customer/reservations/upcoming', {
      headers,
    });
    expect(
      (await upcoming.json()) as {
        data: { requests: Array<{ itemType: string }> };
      },
    ).toMatchObject({
      data: { requests: [{ itemType: 'REQUEST' }] },
    });
    const history = await app.request(
      '/customer/reservations/history?limit=1',
      { headers },
    );
    const historyBody = (await history.json()) as {
      data: Array<{ status: string }>;
      nextCursor: string | null;
    };
    expect(historyBody.data).toHaveLength(1);
    expect(historyBody.data[0]?.status).toMatch(/CANCELLED|NO_SHOW/);
    expect(historyBody.nextCursor).toBeTruthy();
    const detail = await app.request(
      `/customer/reservations/${created.reservationId}`,
      { headers },
    );
    expect(
      (await detail.json()) as { data: Record<string, unknown> },
    ).toMatchObject({
      data: {
        reservationId: created.reservationId,
        court: { name: 'History court' },
        status: 'CANCELLED',
      },
    });
    expect(
      (
        await app.request(`/customer/reservations/${foreign.reservationId}`, {
          headers,
        })
      ).status,
    ).toBe(404);
  });

  it('scopes same email login to venue and derives customer identity from session', async () => {
    const { app, first, second } = await setup();
    const one = await login(app, 'arena-one');
    const two = await login(app, 'arena-two');
    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
    const oneBody = (await one.json()) as {
      data: { token: string; customerId: string };
    };
    const twoBody = (await two.json()) as {
      data: { token: string; customerId: string };
    };
    expect(oneBody.data.customerId).toBe(first.customer.customerId);
    expect(twoBody.data.customerId).toBe(second.customer.customerId);

    const mine = await app.request(
      `/customer/me?customerId=${encodeURIComponent(twoBody.data.customerId)}&organizationId=org-two`,
      { headers: { Authorization: `Bearer ${oneBody.data.token}` } },
    );
    expect(mine.status).toBe(200);
    expect(
      (await mine.json()) as {
        data: { customerId: string; organizationId: string };
      },
    ).toMatchObject({
      data: {
        customerId: first.customer.customerId,
        organizationId: 'org-one',
      },
    });
    expect(
      (
        await app.request('/customers', {
          headers: { Authorization: `Bearer ${oneBody.data.token}` },
        })
      ).status,
    ).toBe(401);
  });

  it('rejects disabled and expired sessions, then invalidates logout token', async () => {
    const { app, repo } = await setup();
    const initial = await login(app, 'arena-one');
    const { data } = (await initial.json()) as { data: { token: string } };
    const account = (
      await repo.query('ORG#org-one', {
        beginsWith: 'CUSTOMER_ACCOUNT#',
      })
    )[0]!;
    await repo.put({ ...account, status: 'DISABLED' });
    expect((await login(app, 'arena-one')).status).toBe(401);
    expect(
      (
        await app.request('/customer-auth/session', {
          headers: { Authorization: `Bearer ${data.token}` },
        })
      ).status,
    ).toBe(401);

    await repo.put({ ...account, status: 'ACTIVE' });
    const active = await login(app, 'arena-one');
    const activeToken = ((await active.json()) as { data: { token: string } })
      .data.token;
    const session = (await repo.scan()).find(
      (item) =>
        item.entity === 'customerSession' &&
        item.tokenHash === hashToken(activeToken),
    )!;
    await repo.put({ ...session, expiresAt: 1 });
    expect(
      (
        await app.request('/customer-auth/session', {
          headers: { Authorization: `Bearer ${activeToken}` },
        })
      ).status,
    ).toBe(401);

    const logoutLogin = await login(app, 'arena-one');
    const logoutToken = (
      (await logoutLogin.json()) as { data: { token: string } }
    ).data.token;
    expect(
      (
        await app.request('/customer-auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${logoutToken}` },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request('/customer-auth/session', {
          headers: { Authorization: `Bearer ${logoutToken}` },
        })
      ).status,
    ).toBe(401);
  });

  it('enforces policy for authenticated customer reservations', async () => {
    const { app, first, repo } = await setup();
    const services = buildServices(repo);
    await services.organizations.update(ownerContext, {
      bookingPolicy: {
        reservationMode: 'AUTO_CONFIRM',
        bookAheadDays: 365,
        cancellationCutoffHours: 6,
        minimumReservationMinutes: 60,
        maximumReservationMinutes: 60,
        maximumActiveBookings: 1,
      },
    });
    const court = await services.courts.create(ownerContext, {
      name: 'Public court',
      sport: 'Tennis',
      slotMinutes: 30,
      defaultHourlyPrice: 80,
      publiclyRequestable: true,
      active: true,
      openingHours,
    });
    const loginResponse = await login(app, 'arena-one');
    const token = ((await loginResponse.json()) as { data: { token: string } })
      .data.token;
    const start = new Date(Date.now() + 2 * 86400000);
    start.setUTCHours(18, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60000);
    const body = {
      courtId: court.courtId,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
    };
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    const created = await app.request('/customer/reservations', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    expect(created.status).toBe(201);
    expect(
      (await created.json()) as { data: { status: string } },
    ).toMatchObject({
      data: { status: 'BOOKED' },
    });
    const second = await app.request('/customer/reservations', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...body,
        startAt: new Date(start.getTime() + 2 * 3600000).toISOString(),
        endAt: new Date(end.getTime() + 2 * 3600000).toISOString(),
      }),
    });
    expect(second.status).toBe(409);
    expect(
      (await repo.scan()).some(
        (item) =>
          item.entity === 'charge' &&
          item.customerId === first.customer.customerId,
      ),
    ).toBe(true);
  });

  it('lets customer cancel own eligible reservation, releases locks, voids charge, and withdraws requests', async () => {
    const { app, first, repo } = await setup();
    const services = buildServices(repo);
    await services.organizations.update(ownerContext, {
      bookingPolicy: {
        reservationMode: 'REQUEST_APPROVAL',
        bookAheadDays: 365,
        cancellationCutoffHours: 6,
        minimumReservationMinutes: 60,
        maximumReservationMinutes: 60,
        maximumActiveBookings: 3,
      },
    });
    const court = await services.courts.create(ownerContext, {
      name: 'Cancellation court',
      sport: 'Tennis',
      slotMinutes: 30,
      defaultHourlyPrice: 80,
      publiclyRequestable: true,
      active: true,
      openingHours,
    });
    const start = new Date(Date.now() + 48 * 3600000);
    start.setUTCHours(18, 0, 0, 0);
    const reservation = await services.reservations.create(ownerContext, {
      courtId: String(court.courtId),
      customerId: String(first.customer.customerId),
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 3600000).toISOString(),
      source: 'STAFF',
    });
    const loginResponse = await login(app, 'arena-one');
    const token = ((await loginResponse.json()) as { data: { token: string } })
      .data.token;
    const headers = { Authorization: `Bearer ${token}` };
    const other = await services.customerAccounts.register('arena-one', {
      name: 'Other customer',
      email: 'other-cancellation@example.test',
      phone: '41999990004',
      password: 'secret',
    });
    const foreign = await services.reservations.create(ownerContext, {
      courtId: String(court.courtId),
      customerId: String(other.customer.customerId),
      startAt: new Date(start.getTime() + 2 * 3600000).toISOString(),
      endAt: new Date(start.getTime() + 3 * 3600000).toISOString(),
      source: 'STAFF',
    });
    expect(
      (
        await app.request(
          `/customer/reservations/${foreign.reservationId}/cancel`,
          {
            method: 'POST',
            headers,
          },
        )
      ).status,
    ).toBe(404);
    const detail = await app.request(
      `/customer/reservations/${reservation.reservationId}`,
      { headers },
    );
    expect((await detail.json()) as { data: unknown }).toMatchObject({
      data: { cancellationEligibility: { eligible: true } },
    });
    expect(
      (
        await app.request(
          `/customer/reservations/${reservation.reservationId}/cancel`,
          {
            method: 'POST',
            headers,
          },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await services.schedule.locks(
          ownerContext,
          String(court.courtId),
          start.toISOString().slice(0, 10),
        )
      ).some((lock) => lock.occupancyId === reservation.reservationId),
    ).toBe(false);
    const rows = await repo.scan();
    expect(
      rows.find((row) => row.reservationId === reservation.reservationId),
    ).toMatchObject({
      status: 'CANCELLED',
      cancellationActor: 'CUSTOMER',
      cancelledByCustomerAccountId: first.account.customerAccountId,
    });
    expect(
      rows.find(
        (row) => row.chargeId === `reservation-${reservation.reservationId}`,
      ),
    ).toMatchObject({
      status: 'VOID',
    });
    const request = await services.requests.createForCustomer(
      {
        organizationId: 'org-one',
        customerId: String(first.customer.customerId),
        customerAccountId: String(first.account.customerAccountId),
        actorType: 'CUSTOMER',
      },
      {
        courtId: String(court.courtId),
        startAt: new Date(start.getTime() + 2 * 3600000).toISOString(),
        endAt: new Date(start.getTime() + 3 * 3600000).toISOString(),
      },
    );
    expect(
      (
        await app.request(
          `/customer/reservations/${request.requestId}/cancel`,
          {
            method: 'POST',
            headers,
          },
        )
      ).status,
    ).toBe(200);
    expect(
      (await repo.scan()).find((row) => row.requestId === request.requestId),
    ).toMatchObject({ status: 'WITHDRAWN' });
  });

  it('searches all public courts and creates customer-linked approval requests', async () => {
    const { app, first, repo } = await setup();
    const services = buildServices(repo);
    await services.organizations.update(ownerContext, {
      bookingPolicy: {
        reservationMode: 'REQUEST_APPROVAL',
        bookAheadDays: 365,
        cancellationCutoffHours: 6,
        minimumReservationMinutes: 60,
        maximumReservationMinutes: 60,
        maximumActiveBookings: 3,
      },
    });
    const court = await services.courts.create(ownerContext, {
      name: 'Public tennis',
      sport: 'Tennis',
      slotMinutes: 30,
      defaultHourlyPrice: 80,
      publiclyRequestable: true,
      active: true,
      openingHours,
    });
    await services.courts.create(ownerContext, {
      name: 'Private court',
      sport: 'Tennis',
      slotMinutes: 30,
      defaultHourlyPrice: 80,
      publiclyRequestable: false,
      active: true,
      openingHours,
    });
    const loginResponse = await login(app, 'arena-one');
    const token = ((await loginResponse.json()) as { data: { token: string } })
      .data.token;
    const start = new Date(Date.now() + 2 * 86400000);
    start.setUTCHours(18, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60000);
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    const availability = await app.request(
      `/customer/availability?date=${start.toISOString().slice(0, 10)}&durationMinutes=60`,
      { headers },
    );
    expect(availability.status).toBe(200);
    expect((await availability.json()) as { data: unknown }).toMatchObject({
      data: { courts: [{ courtId: court.courtId, name: 'Public tennis' }] },
    });
    const created = await app.request('/customer/reservations', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        courtId: court.courtId,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
      }),
    });
    expect(created.status).toBe(201);
    expect((await created.json()) as { data: unknown }).toMatchObject({
      data: {
        status: 'REQUESTED',
        linkedCustomerId: first.customer.customerId,
      },
    });
    expect(
      await services.schedule.locks(
        ownerContext,
        String(court.courtId),
        start.toISOString().slice(0, 10),
      ),
    ).toHaveLength(0);
  });

  it('blocks customer and anonymous booking when venue policy is staff only', async () => {
    const { app, repo } = await setup();
    const services = buildServices(repo);
    await services.organizations.update(ownerContext, {
      bookingPolicy: {
        reservationMode: 'STAFF_ONLY',
        bookAheadDays: 365,
        cancellationCutoffHours: 6,
        minimumReservationMinutes: 60,
        maximumReservationMinutes: 60,
        maximumActiveBookings: 3,
      },
    });
    const court = await services.courts.create(ownerContext, {
      name: 'Staff court',
      sport: 'Tennis',
      slotMinutes: 30,
      defaultHourlyPrice: 80,
      publiclyRequestable: true,
      active: true,
      openingHours,
    });
    const loginResponse = await login(app, 'arena-one');
    const token = ((await loginResponse.json()) as { data: { token: string } })
      .data.token;
    const start = new Date(Date.now() + 2 * 86400000);
    start.setUTCHours(18, 0, 0, 0);
    const body = {
      courtId: court.courtId,
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 3600000).toISOString(),
    };
    expect(
      (
        await app.request('/customer/reservations', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request('/public/venues/arena-one/requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            courtId: court.courtId,
            requestedStartAt: body.startAt,
            requestedEndAt: body.endAt,
            customerName: 'Anonymous',
            phone: '41999990000',
          }),
        })
      ).status,
    ).toBe(403);
  });

  it('lets a customer update only own contact fields and keeps account email synced', async () => {
    const { app, first, repo } = await setup();
    const services = buildServices(repo);
    await services.customers.create(ownerContext, {
      name: 'Existing customer',
      phone: '41999991111',
      email: 'existing@example.test',
    });
    const loginResponse = await login(app, 'arena-one');
    const token = ((await loginResponse.json()) as { data: { token: string } })
      .data.token;
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    expect(
      (
        await app.request('/customer/me', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ email: 'existing@example.test' }),
        })
      ).status,
    ).toBe(409);
    const updated = await app.request('/customer/me', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        name: 'Ana Updated',
        phone: '41 98888-0000',
        email: 'ana.updated@example.test',
        notes: 'not allowed',
        tags: ['not allowed'],
      }),
    });
    expect(updated.status).toBe(200);
    expect((await updated.json()) as { data: unknown }).toMatchObject({
      data: {
        customer: {
          customerId: first.customer.customerId,
          name: 'Ana Updated',
          phone: '41 98888-0000',
          email: 'ana.updated@example.test',
        },
        account: { email: 'ana.updated@example.test' },
      },
    });
    expect(
      (
        await app.request('/customer/me', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ notes: 'not allowed', tags: ['not allowed'] }),
        })
      ).status,
    ).toBe(400);
    expect((await login(app, 'arena-one')).status).toBe(401);
    const relogin = await app.request('/customer-auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: 'arena-one',
        email: 'ana.updated@example.test',
        password: 'secret',
      }),
    });
    expect(relogin.status).toBe(200);
    const customer = await repo.get({
      PK: 'ORG#org-one',
      SK: `CUSTOMER#${first.customer.customerId}`,
    });
    expect(customer?.notes).toBeUndefined();
    expect(customer?.tags).toEqual([]);
    const session = await app.request('/customer/me', { headers });
    expect(session.status).toBe(200);
    expect((await session.json()) as { data: unknown }).toMatchObject({
      data: {
        customer: {
          customerId: first.customer.customerId,
          name: 'Ana Updated',
          email: 'ana.updated@example.test',
        },
      },
    });
    const sessionBody = (await (
      await app.request('/customer/me', { headers })
    ).json()) as { data: { customer: Record<string, unknown> } };
    expect(Object.keys(sessionBody.data.customer)).not.toContain('notes');
    expect(Object.keys(sessionBody.data.customer)).not.toContain('tags');
  });

  it('stores multiple active sports, preserves legacy preference reads, and rejects inactive sports', async () => {
    const { app, first, repo } = await setup();
    const services = buildServices(repo);
    const tennis = await services.sports.create(ownerContext, {
      name: 'Tennis',
    });
    const padel = await services.sports.create(ownerContext, { name: 'Padel' });
    const inactive = await services.sports.create(ownerContext, {
      name: 'Squash',
    });
    const tennisId = String(tennis.sportId);
    const padelId = String(padel.sportId);
    const inactiveId = String(inactive.sportId);
    await services.sports.update(ownerContext, inactiveId, {
      active: false,
    });
    const legacyCustomer = await repo.get({
      PK: 'ORG#org-one',
      SK: `CUSTOMER#${first.customer.customerId}`,
    });
    await repo.put({ ...legacyCustomer!, preferredSportId: tennisId });
    const token = (
      (await (await login(app, 'arena-one')).json()) as {
        data: { token: string };
      }
    ).data.token;
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    expect(
      (await (
        await app.request('/customer/me/sports', { headers })
      ).json()) as {
        data: { sportIds: string[]; preferredSportId: string };
      },
    ).toMatchObject({
      data: { sportIds: [tennisId], preferredSportId: tennisId },
    });
    const saved = await app.request('/customer/me/sports', {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        sportIds: [tennisId, padelId],
        preferredSportId: padelId,
      }),
    });
    expect(saved.status).toBe(200);
    expect((await saved.json()) as { data: unknown }).toMatchObject({
      data: {
        customerId: first.customer.customerId,
        sportIds: [tennisId, padelId],
        preferredSportId: padelId,
      },
    });
    expect(
      await repo.get({
        PK: `SPORT_PREFERENCE#org-one#${tennisId}`,
        SK: `CUSTOMER#${first.customer.customerId}`,
      }),
    ).toMatchObject({
      customerId: first.customer.customerId,
      preferred: false,
    });
    expect(
      await repo.get({
        PK: `SPORT_PREFERENCE#org-one#${padelId}`,
        SK: `CUSTOMER#${first.customer.customerId}`,
      }),
    ).toMatchObject({ customerId: first.customer.customerId, preferred: true });
    expect(
      (
        await app.request('/customer/me/sports', {
          method: 'PUT',
          headers,
          body: JSON.stringify({ sportIds: [inactiveId] }),
        })
      ).status,
    ).toBe(400);
    const previouslySelected = await services.sports.create(ownerContext, {
      name: 'Previously selected',
    });
    const previouslySelectedId = String(previouslySelected.sportId);
    await app.request('/customer/me/sports', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ sportIds: [previouslySelectedId] }),
    });
    await services.sports.update(ownerContext, previouslySelectedId, {
      active: false,
    });
    expect(
      (
        await app.request('/customer/me/sports', {
          method: 'PUT',
          headers,
          body: JSON.stringify({ sportIds: [previouslySelectedId, padelId] }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request('/customer/me/sports', {
          method: 'PUT',
          headers,
          body: JSON.stringify({ sportIds: [tennisId, tennisId] }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request('/customer/me/sports', {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            sportIds: Array.from(
              { length: 50 },
              (_, index) => `sport-${index}`,
            ),
          }),
        })
      ).status,
    ).toBe(400);
  });
});

describe('reservation participant HTTP authorization', () => {
  it('uses the authenticated owner and rejects directory IDs without disclosing links', async () => {
    const { app, first, repo } = await setup();
    await repo.put({
      PK: 'RESERVATION#participants-http',
      SK: 'META',
      organizationId: 'org-one',
      customerId: first.customer.customerId,
      status: 'BOOKED',
      startAt: '2099-01-01T12:00:00.000Z',
    });
    const response = await login(app, 'arena-one');
    const { data } = (await response.json()) as { data: { token: string } };
    const headers = {
      Authorization: `Bearer ${data.token}`,
      'Content-Type': 'application/json',
    };
    const base = '/customer/reservations/participants-http/participants';
    const id = '00000000-0000-4000-8000-000000000001';
    const saved = await app.request(`${base}/${id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ name: 'Maria' }),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      data: { participantId: id, name: 'Maria', status: 'ACTIVE' },
    });
    expect(
      (
        await app.request(`${base}/${id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ name: 'Maria', customerId: 'foreign' }),
        })
      ).status,
    ).toBe(400);
    expect((await app.request(base)).status).toBe(401);
    const foreign = await login(app, 'arena-two');
    const foreignBody = (await foreign.json()) as { data: { token: string } };
    const foreignHeaders = {
      ...headers,
      Authorization: `Bearer ${foreignBody.data.token}`,
    };
    expect((await app.request(base, { headers: foreignHeaders })).status).toBe(
      404,
    );
    expect(
      (
        await app.request(`${base}/${id}`, {
          method: 'DELETE',
          headers: foreignHeaders,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`${base}/${id}`, {
          method: 'PUT',
          headers: foreignHeaders,
          body: JSON.stringify({ name: 'Other' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (await app.request('/customers?search=Maria', { headers })).status,
    ).toBe(401);
    expect(
      (await app.request(`${base}/${id}`, { method: 'DELETE', headers }))
        .status,
    ).toBe(200);
    const history = await app.request(base, { headers });
    expect(await history.json()).toMatchObject({
      data: { participants: [{ name: 'Maria', status: 'REMOVED' }] },
    });
  });

  it('cannot read or edit another customer reservation participants in same venue', async () => {
    const { app, repo } = await setup();
    const services = buildServices(repo);
    const court = await services.courts.create(ownerContext, {
      name: 'Participant isolation court',
      sport: 'Tennis',
      slotMinutes: 30,
      defaultHourlyPrice: 80,
      publiclyRequestable: true,
      active: true,
      openingHours,
    });
    const other = await services.customerAccounts.register('arena-one', {
      name: 'Other participant owner',
      email: 'other-participant@example.test',
      phone: '41999990005',
      password: 'secret',
    });
    const reservation = await services.reservations.create(ownerContext, {
      courtId: court.courtId,
      customerId: other.customer.customerId,
      startAt: '2099-01-01T12:00:00.000Z',
      endAt: '2099-01-01T13:00:00.000Z',
      source: 'STAFF',
    });
    const loginResponse = await login(app, 'arena-one');
    const { data } = (await loginResponse.json()) as {
      data: { token: string };
    };
    const headers = {
      Authorization: `Bearer ${data.token}`,
      'Content-Type': 'application/json',
    };
    const base = `/customer/reservations/${reservation.reservationId}/participants`;
    expect((await app.request(base, { headers })).status).toBe(404);
    expect(
      (
        await app.request(`${base}/00000000-0000-4000-8000-000000000002`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ name: 'Should not save' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`${base}/00000000-0000-4000-8000-000000000002`, {
          method: 'DELETE',
          headers,
        })
      ).status,
    ).toBe(404);
  });
});
