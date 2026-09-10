import { randomUUID } from 'node:crypto';
import { ensureTable, dynamo } from '../db.js';
import { hashPassword } from '../security.js';

if (
  process.env.NODE_ENV === 'production' &&
  (!process.env.OWNER_EMAIL || !process.env.OWNER_PASSWORD)
)
  throw new Error(
    'Production bootstrap requires OWNER_EMAIL and OWNER_PASSWORD.',
  );
await ensureTable();
const repo = dynamo(),
  email = (process.env.OWNER_EMAIL ?? 'owner@example.test')
    .trim()
    .toLowerCase(),
  password = process.env.OWNER_PASSWORD ?? 'change-me-local',
  name = process.env.ORGANIZATION_NAME ?? 'Court Manager Demo';
const existing = (
  await repo.scan((x) => x.entity === 'user' && x.email === email)
)[0];
if (existing) {
  console.log('Owner already exists; bootstrap is idempotent.');
  process.exit(0);
}
const organizationId = randomUUID(),
  userId = randomUUID(),
  timestamp = new Date().toISOString();
const slug =
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'sports-center';
await repo.put({
  PK: `ORG#${organizationId}`,
  SK: 'META',
  entity: 'organization',
  organizationId,
  name,
  slug,
  timezone: process.env.ORGANIZATION_TIMEZONE ?? 'America/Sao_Paulo',
  currency: process.env.CURRENCY ?? 'BRL',
  phone: process.env.ORGANIZATION_PHONE,
  email: process.env.ORGANIZATION_EMAIL,
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
  email,
  role: 'OWNER',
  passwordHash: await hashPassword(password),
  active: true,
  createdAt: timestamp,
  updatedAt: timestamp,
});
console.log(`Created organization ${name} (${slug}) and owner ${email}.`);
