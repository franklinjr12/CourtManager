import { randomUUID } from 'node:crypto';
import type { AuthContext } from '@court-manager/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { dynamo, ensureTable } from '../db.js';
import { hashPassword } from '../security.js';
import { buildServices } from '../services/index.js';

process.env.DYNAMODB_ENDPOINT = 'http://localhost:8120';
process.env.DYNAMODB_TABLE = 'court-manager-integration';
process.env.AWS_REGION = 'us-east-1';

// Pilot scale assumption: 1 venue, 6 courts, ~3,000 reservations and 500
// customers over 90 days, next to a second organization in the same table.
const COURTS = 6;
const CUSTOMERS = 500;
const RESERVATIONS = 3000;
const DAYS = 90;
const LIMIT_MS = 2000;
const seededOrganizations: string[] = [];

const hours = Object.fromEntries(
  [
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
    'SATURDAY',
    'SUNDAY',
  ].map((day) => [day, { open: '06:00', close: '23:00' }]),
);

const dateAfter = (days: number) => {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

async function inBatches<T>(
  items: T[],
  size: number,
  work: (item: T) => Promise<unknown>,
) {
  for (let offset = 0; offset < items.length; offset += size)
    await Promise.all(items.slice(offset, offset + size).map(work));
}

async function seedOrganization(
  label: string,
  courtCount: number,
  customerCount: number,
  reservationCount: number,
) {
  const repo = dynamo();
  const organizationId = randomUUID();
  seededOrganizations.push(organizationId);
  const timestamp = new Date().toISOString();
  const email = `owner-${organizationId}@pilot.test`;
  const password = 'pilot-scale-password';
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: 'META',
    entity: 'organization',
    organizationId,
    name: label,
    slug: `pilot-${organizationId}`,
    timezone: 'UTC',
    currency: 'BRL',
    active: true,
    features: { classes: true, finance: true },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: 'USER#owner',
    entity: 'user',
    organizationId,
    userId: 'owner',
    name: `${label} Owner`,
    email,
    role: 'OWNER',
    active: true,
    passwordHash: await hashPassword(password),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const ctx: AuthContext = { organizationId, userId: 'owner', role: 'OWNER' };
  const services = buildServices(repo);
  const courts: Record<string, unknown>[] = [];
  for (let index = 0; index < courtCount; index += 1)
    courts.push(
      await services.courts.create(ctx, {
        name: `${label} Court ${index + 1}`,
        sport: 'Tennis',
        slotMinutes: 30,
        defaultHourlyPrice: 80,
        publiclyRequestable: true,
        active: true,
        openingHours: hours,
      }),
    );
  const customers: Awaited<ReturnType<typeof services.customers.create>>[] = [];
  await inBatches(
    Array.from({ length: customerCount }, (_, index) => index),
    25,
    async (index) =>
      customers.push(
        await services.customers.create(ctx, {
          name: `${label} Customer ${index}`,
          phone: `41${String(900000000 + index + Math.floor(Math.random() * 1e6) * 1000).slice(0, 9)}`,
        }),
      ),
  );
  // Slots spread over DAYS days starting today: day = i % DAYS, hour/court
  // advance every full cycle, so no two reservations overlap.
  const reservations: { id: string; customerId: string }[] = [];
  await inBatches(
    Array.from({ length: reservationCount }, (_, index) => index),
    25,
    async (index) => {
      const date = dateAfter(index % DAYS);
      const cycle = Math.floor(index / DAYS);
      const court = courts[cycle % courtCount]!;
      const hour = 6 + (Math.floor(cycle / courtCount) % 16);
      const hh = String(hour).padStart(2, '0');
      const startAt = `${date}T${hh}:00:00Z`;
      const endAt = `${date}T${String(hour + 1).padStart(2, '0')}:00:00Z`;
      const customer = customers[index % customers.length]!;
      const reservation = await services.reservations.create(ctx, {
        courtId: court.courtId,
        customerId: customer.customerId,
        startAt,
        endAt,
        source: 'STAFF',
      });
      reservations.push({
        customerId: String(customer.customerId),
        id: String(reservation.reservationId),
      });
    },
  );
  return {
    repo,
    ctx,
    services,
    courts,
    customers,
    reservations,
    email,
    password,
    organizationId,
  };
}

// The shared integration table is also used by tests that still scan it, so
// the seeded pilot data is removed when this test ends.
async function removeOrganizations(organizationIds: string[]) {
  const repo = dynamo();
  const rows = await repo.scan((item) => {
    const text = JSON.stringify(item);
    return organizationIds.some((id) => text.includes(id));
  });
  for (let offset = 0; offset < rows.length; offset += 25)
    await Promise.all(
      rows
        .slice(offset, offset + 25)
        .map((row) =>
          repo.batchWrite([
            { type: 'delete', key: { PK: row.PK, SK: row.SK } },
          ]),
        ),
    );
}

describe('pilot-scale front-desk performance (DynamoDB Local)', () => {
  afterAll(() => removeOrganizations(seededOrganizations), 300_000);

  it('serves Hoje, Agenda and Reservas under 2 s without other-org data', async () => {
    await ensureTable();
    const pilot = await seedOrganization(
      'Pilot',
      COURTS,
      CUSTOMERS,
      RESERVATIONS,
    );
    const other = await seedOrganization('Other', 2, 20, 60);

    const { services, ctx, reservations, courts } = pilot;
    // Blocks and payments on the pilot venue.
    await services.blocks.create(ctx, {
      courtId: courts[0]!.courtId,
      startAt: `${dateAfter(0)}T21:00:00Z`,
      endAt: `${dateAfter(0)}T22:00:00Z`,
      reason: 'MAINTENANCE',
    });
    await services.blocks.create(ctx, {
      courtId: courts[1]!.courtId,
      startAt: `${dateAfter(1)}T21:00:00Z`,
      endAt: `${dateAfter(1)}T22:00:00Z`,
      reason: 'CLEANING',
    });
    for (const reservation of reservations.slice(0, 40))
      await services.payments.create(ctx, {
        reservationId: reservation.id,
        customerId: reservation.customerId,
        amount: 10,
        method: 'PIX',
        paidAt: new Date().toISOString(),
      });

    const app = createApp(pilot.repo);
    const login = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pilot.email, password: pilot.password }),
    });
    const token = ((await login.json()) as { data: { token: string } }).data
      .token;
    const get = async (path: string) => {
      const started = performance.now();
      const response = await app.request(path, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const text = await response.text();
      const elapsed = performance.now() - started;
      expect(response.status, `${path}: ${text.slice(0, 300)}`).toBe(200);
      return { elapsed, text, body: JSON.parse(text) };
    };

    const busyDay = dateAfter(1);
    const today = await get('/today');
    const schedule = await get(`/schedule?date=${busyDay}`);
    const list = await get('/reservations');
    console.info(
      `pilot-scale timings ms: today=${today.elapsed.toFixed(0)} schedule=${schedule.elapsed.toFixed(0)} reservations=${list.elapsed.toFixed(0)}`,
    );

    expect(today.elapsed).toBeLessThan(LIMIT_MS);
    expect(schedule.elapsed).toBeLessThan(LIMIT_MS);
    expect(list.elapsed).toBeLessThan(LIMIT_MS);

    expect(list.body.data.length).toBeGreaterThan(0);
    expect(list.body.nextCursor ?? list.body.meta?.nextCursor).toBeTruthy();
    const dayRows = schedule.text.match(/"reservationId"/g)?.length ?? 0;
    expect(dayRows).toBeGreaterThan(0);

    const otherIds = [
      other.organizationId,
      ...other.reservations.map((reservation) => reservation.id),
      ...other.customers.map((customer) => String(customer.customerId)),
    ];
    for (const result of [today, schedule, list])
      for (const id of otherIds) expect(result.text).not.toContain(id);
  }, 600_000);
});
