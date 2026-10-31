import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { MemoryRepository } from './db.js';
import { hashPassword } from './security.js';
import { buildServices } from './services/index.js';

const timestamp = '2026-09-01T00:00:00.000Z';

async function setup() {
  const repo = new MemoryRepository();
  const clock = { ms: Date.parse(timestamp) };
  await repo.put({
    PK: 'ORG#org-t',
    SK: 'META',
    entity: 'organization',
    organizationId: 'org-t',
    slug: 'arena-t',
    name: 'Arena T',
    timezone: 'UTC',
    currency: 'BRL',
    active: true,
    features: { classes: false, finance: false },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await repo.put({
    PK: 'ORG#org-t',
    SK: 'USER#owner',
    entity: 'user',
    organizationId: 'org-t',
    userId: 'owner',
    role: 'OWNER',
    name: 'Owner',
    email: 'owner@throttle.test',
    passwordHash: await hashPassword('right-password'),
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await buildServices(repo).customerAccounts.register('arena-t', {
    name: 'Cus',
    email: 'cus@throttle.test',
    phone: '41999990001',
    password: 'right-password',
  });
  const app = createApp(repo, { now: () => clock.ms });
  const post = (path: string, data: unknown, ip = '10.0.0.1') =>
    app.request(path, {
      method: 'POST',
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    });
  return { clock, post };
}

type Post = Awaited<ReturnType<typeof setup>>['post'];

const failureThenRecovery = (
  path: string,
  credentials: Record<string, string>,
) => {
  it('rejects after 5 failures and recovers after the window', async () => {
    const { clock, post } = await setup();
    for (let i = 0; i < 5; i++)
      expect(
        (await post(path, { ...credentials, password: 'wrong' })).status,
      ).toBe(401);
    const blocked = await post(path, credentials);
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as {
      error: { code: string; requestId: string };
    };
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.requestId).toBeTruthy();
    clock.ms += 901_000;
    expect((await post(path, credentials)).status).toBe(200);
  });
  it('never throttles repeated successful logins', async () => {
    const { post } = await setup();
    for (let i = 0; i < 20; i++)
      expect((await post(path, credentials)).status).toBe(200);
  });
};

const burst = async (
  post: Post,
  path: string,
  data: unknown,
  allowed: number,
) => {
  for (let i = 0; i < allowed; i++)
    expect((await post(path, data)).status).not.toBe(429);
  expect((await post(path, data)).status).toBe(429);
};

describe('staff login throttling', () => {
  failureThenRecovery('/auth/login', {
    email: 'owner@throttle.test',
    password: 'right-password',
  });
});

describe('customer login throttling', () => {
  failureThenRecovery('/customer-auth/login', {
    slug: 'arena-t',
    email: 'cus@throttle.test',
    password: 'right-password',
  });
});

describe('public endpoint throttling', () => {
  const request = {
    courtId: 'court-1',
    requestedStartAt: '2027-01-03T18:00:00.000Z',
    requestedEndAt: '2027-01-03T19:00:00.000Z',
    customerName: 'Walk In',
    phone: '41999990000',
  };
  it('rejects the 21st request from one client but not another', async () => {
    const { post } = await setup();
    const path = '/public/venues/arena-t/requests';
    await burst(post, path, request, 20);
    expect((await post(path, request, '10.0.0.2')).status).not.toBe(429);
  });
  it('throttles registration', async () => {
    const { post } = await setup();
    await burst(
      post,
      '/public/venues/arena-t/portal/register',
      { name: 'X', email: 'x@y.test', phone: '41999990009', password: 'p' },
      20,
    );
  });
  it('throttles customer-auth registration', async () => {
    const { post } = await setup();
    await burst(
      post,
      '/customer-auth/register',
      {
        slug: 'arena-t',
        name: 'X',
        email: 'x@y.test',
        phone: '41999990009',
        password: 'p',
      },
      20,
    );
  });
  it.each([
    '/public/venues/arena-t/portal/activate',
    '/public/venues/arena-t/portal/reset-password',
  ])('throttles %s', async (path) => {
    const { post } = await setup();
    await burst(post, path, { token: 'bad', password: 'p' }, 20);
  });
  it.each(['/customer-auth/activate', '/customer-auth/reset-password'])(
    'throttles %s',
    async (path) => {
      const { post } = await setup();
      await burst(
        post,
        path,
        { slug: 'arena-t', token: 'bad', password: 'p' },
        20,
      );
    },
  );
});
