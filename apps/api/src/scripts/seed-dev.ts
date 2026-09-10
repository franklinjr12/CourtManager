import { ensureTable, dynamo } from '../db.js';
import { hashPassword } from '../security.js';
await ensureTable();
if ((process.env.NODE_ENV ?? 'development') === 'production')
  throw new Error('seed:dev refuses NODE_ENV=production.');
const repo = dynamo(),
  found = (await repo.scan((x) => x.entity === 'organization'))[0];
if (found) {
  console.log('Development seed already exists.');
  process.exit(0);
}
const organizationId = 'seed-org',
  userId = 'seed-owner',
  timestamp = new Date().toISOString();
await repo.put({
  PK: `ORG#${organizationId}`,
  SK: 'META',
  entity: 'organization',
  organizationId,
  name: 'Arena Central',
  slug: 'arena-central',
  timezone: 'America/Sao_Paulo',
  currency: 'BRL',
  phone: '(41) 3333-0000',
  email: 'contato@arena.test',
  active: true,
  features: { classes: false, finance: true },
  createdAt: timestamp,
  updatedAt: timestamp,
});
await repo.put({
  PK: `ORG#${organizationId}`,
  SK: `USER#${userId}`,
  entity: 'user',
  userId,
  organizationId,
  name: 'Owner',
  email: 'owner@arena.test',
  role: 'OWNER',
  passwordHash: await hashPassword('dev-password'),
  active: true,
  createdAt: timestamp,
  updatedAt: timestamp,
});
const days = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
];
for (let i = 1; i <= 4; i++) {
  const courtId = `seed-court-${i}`;
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: `COURT#${courtId}`,
    entity: 'court',
    courtId,
    organizationId,
    name: `Court ${i}`,
    sport: i % 2 ? 'Beach volleyball' : 'Tennis',
    active: true,
    publiclyRequestable: true,
    slotMinutes: 30,
    defaultHourlyPrice: 80,
    openingHours: Object.fromEntries(
      days.map((day) => [day, { open: '07:00', close: '23:00' }]),
    ),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}
for (let i = 1; i <= 20; i++) {
  const customerId = `seed-customer-${i}`;
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: `CUSTOMER#${customerId}`,
    entity: 'customer',
    customerId,
    organizationId,
    name: `Customer ${i}`,
    phone: `4199999${String(i).padStart(4, '0')}`,
    normalizedPhone: `4199999${String(i).padStart(4, '0')}`,
    normalizedEmail: `customer${i}@arena.test`,
    tags: [],
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}
console.log(
  'Seeded Arena Central with owner, courts, and customers. Login: owner@arena.test / dev-password',
);
