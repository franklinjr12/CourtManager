import { randomUUID } from 'node:crypto';
import {
  DEFAULT_BOOKING_POLICY,
  type BookingPolicy,
} from '@court-manager/contracts';
import { vi } from 'vitest';
import { createApp } from '../app.js';
import { MemoryRepository, type Key } from '../db.js';
import { hashPassword } from '../security.js';
import { buildServices } from '../services/index.js';

/**
 * HTTP-level fixture for Phase 2 user journeys. Everything a journey does goes
 * through `createApp`; services are exposed only for seeding and assertions.
 */

// Journeys make many requests and hash several passwords; the 5s default is
// too tight when the whole suite runs in parallel.
vi.setConfig({ testTimeout: 30_000 });

export const openingHours = (open = '07:00', close = '23:00') =>
  Object.fromEntries(
    [
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
      'SATURDAY',
      'SUNDAY',
    ].map((day) => [day, { open, close }]),
  );

export type Api = ReturnType<typeof createApp>;
export type Response<T = any> = { status: number; body: T }; // eslint-disable-line @typescript-eslint/no-explicit-any

export const call = async <T = any>( // eslint-disable-line @typescript-eslint/no-explicit-any
  app: Api,
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<Response<T>> => {
  const response = await app.request(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    body: (await response.json().catch(() => ({}))) as T,
  };
};

const PASSWORD = 'journey-password';

export type Venue = Awaited<ReturnType<typeof seedVenue>>;

async function seedVenue(
  repo: MemoryRepository,
  label: string,
  policy: Partial<BookingPolicy>,
) {
  const organizationId = randomUUID();
  const slug = `${label}-${organizationId.slice(0, 8)}`;
  const owner = {
    organizationId,
    userId: `owner-${organizationId}`,
    role: 'OWNER' as const,
  };
  const ownerEmail = `owner-${organizationId}@journey.test`;
  const timestamp = new Date().toISOString();
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: 'META',
    entity: 'organization',
    organizationId,
    name: `${label} arena`,
    slug,
    timezone: 'UTC',
    currency: 'BRL',
    active: true,
    features: { classes: true, finance: true },
    bookingPolicy: {
      ...DEFAULT_BOOKING_POLICY,
      bookAheadDays: 30,
      ...policy,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: `USER#${owner.userId}`,
    entity: 'user',
    organizationId,
    userId: owner.userId,
    role: 'OWNER',
    name: 'Journey Owner',
    email: ownerEmail,
    passwordHash: await hashPassword(PASSWORD),
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: 'USER#coach',
    entity: 'user',
    organizationId,
    userId: 'coach',
    role: 'COACH',
    name: 'Coach Maria',
    email: `coach-${organizationId}@journey.test`,
    passwordHash: 'private-hash',
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const services = buildServices(repo);
  const court = (input: Record<string, unknown>) =>
    services.courts.create(owner, {
      slotMinutes: 30,
      defaultHourlyPrice: 80,
      publiclyRequestable: true,
      active: true,
      openingHours: openingHours(),
      ...input,
    } as Parameters<typeof services.courts.create>[1]);
  const tennis = await court({ name: `${label} Tennis`, sport: 'Tennis' });
  const padel = await court({ name: `${label} Padel`, sport: 'Padel' });
  const privateCourt = await court({
    name: `${label} Private`,
    sport: 'Tennis',
    publiclyRequestable: false,
  });
  return {
    organizationId,
    slug,
    owner,
    ownerEmail,
    courts: {
      tennis: String(tennis.courtId),
      padel: String(padel.courtId),
      private: String(privateCourt.courtId),
    },
  };
}

export async function journey(policy: Partial<BookingPolicy> = {}) {
  const repo = new MemoryRepository();
  const app = createApp(repo);
  const services = buildServices(repo);
  const venue = await seedVenue(repo, 'alpha', policy);
  const otherVenue = await seedVenue(repo, 'beta', policy);
  let sequence = 0;

  const staffLogin = async (target: Venue = venue) => {
    const response = await call<{ data: { token: string } }>(
      app,
      'POST',
      '/auth/login',
      undefined,
      { email: target.ownerEmail, password: PASSWORD },
    );
    if (response.status !== 200)
      throw new Error(`Staff login failed: ${JSON.stringify(response.body)}`);
    return response.body.data.token;
  };

  const customerLogin = async (
    email: string,
    password = PASSWORD,
    target: Venue = venue,
  ) =>
    call<{ data: { token: string; customerId: string } }>(
      app,
      'POST',
      '/customer-auth/login',
      undefined,
      { slug: target.slug, email, password },
    );

  /** Registers through the portal and signs in, returning the session. */
  const customer = async (
    overrides: { name?: string; email?: string; phone?: string } = {},
    target: Venue = venue,
  ) => {
    sequence += 1;
    const email = overrides.email ?? `customer-${sequence}@journey.test`;
    const registered = await call(
      app,
      'POST',
      '/customer-auth/register',
      undefined,
      {
        slug: target.slug,
        name: overrides.name ?? `Customer ${sequence}`,
        email,
        phone: overrides.phone ?? `4199999${String(sequence).padStart(4, '0')}`,
        password: PASSWORD,
      },
    );
    if (registered.status !== 201)
      throw new Error(`Register failed: ${JSON.stringify(registered.body)}`);
    const login = await customerLogin(email, PASSWORD, target);
    if (login.status !== 200)
      throw new Error(`Customer login failed: ${JSON.stringify(login.body)}`);
    return {
      email,
      token: login.body.data.token,
      customerId: login.body.data.customerId,
    };
  };

  const setPolicy = async (
    token: string,
    patch: Partial<BookingPolicy>,
    current: Partial<BookingPolicy> = {},
  ) => {
    const organization = await call(app, 'GET', '/organization', token);
    const response = await call(app, 'PATCH', '/organization', token, {
      bookingPolicy: {
        ...DEFAULT_BOOKING_POLICY,
        ...organization.body.data.bookingPolicy,
        ...current,
        ...patch,
      },
    });
    if (response.status !== 200)
      throw new Error(`Policy update failed: ${JSON.stringify(response.body)}`);
    return response.body.data;
  };

  return {
    repo,
    app,
    services,
    venue,
    otherVenue,
    password: PASSWORD,
    staffLogin,
    customerLogin,
    customer,
    setPolicy,
  };
}

/** UTC calendar date `daysAhead` days from today. Journey venues use UTC. */
export const dateAhead = (daysAhead: number, from = new Date()) => {
  const date = new Date(from);
  date.setUTCDate(date.getUTCDate() + daysAhead);
  return date.toISOString().slice(0, 10);
};

export const slot = (
  courtId: string,
  daysAhead: number,
  time = '18:00',
  minutes = 60,
) => {
  const startAt = new Date(`${dateAhead(daysAhead)}T${time}:00.000Z`);
  return {
    courtId,
    startAt: startAt.toISOString(),
    endAt: new Date(startAt.getTime() + minutes * 60000).toISOString(),
  };
};

/** Next date (at least one day ahead) that falls on the given UTC weekday. */
export const nextWeekday = (weekday: number) => {
  for (let days = 1; days <= 7; days++) {
    const date = dateAhead(days);
    if (new Date(`${date}T12:00:00Z`).getUTCDay() === weekday)
      return { date, daysAhead: days };
  }
  throw new Error('unreachable');
};

export const forceExpire = async (repo: MemoryRepository, key: Key) => {
  const item = await repo.get(key);
  if (!item) throw new Error(`Nothing to expire at ${key.PK}/${key.SK}`);
  await repo.put({ ...item, expiresAt: 1 });
};

export const tokenFromLink = (link: string) =>
  decodeURIComponent(new URL(link, 'http://local').searchParams.get('token')!);
