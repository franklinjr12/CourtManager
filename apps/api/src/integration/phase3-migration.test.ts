import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { dynamo, ensureTable } from '../db.js';
import { migratePhase3 } from '../migrations/phase3.js';
import { hashPassword } from '../security.js';
import { buildServices } from '../services/index.js';

process.env.DYNAMODB_ENDPOINT = 'http://localhost:8120';
process.env.DYNAMODB_TABLE = 'court-manager-phase3-migration';
process.env.AWS_REGION = 'us-east-1';

describe('Phase 3 migration on DynamoDB Local', () => {
  it('backfills indexes without inventing commercial relationships and is idempotent', async () => {
    await ensureTable();
    const repo = dynamo();
    const organizationId = `migrate-${randomUUID()}`;
    const timestamp = '2026-09-01T00:00:00.000Z';
    await repo.put({
      PK: `ORG#${organizationId}`,
      SK: 'META',
      entity: 'organization',
      organizationId,
      name: 'Migration Arena',
      slug: organizationId,
      timezone: 'UTC',
      currency: 'BRL',
      active: true,
      features: { classes: true, finance: true },
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await repo.put({
      PK: `ORG#${organizationId}`,
      SK: 'CUSTOMER#customer-1',
      entity: 'customer',
      organizationId,
      customerId: 'customer-1',
      name: 'Legacy customer',
      phone: '41999990000',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await repo.put({
      PK: 'CHARGE#legacy-charge',
      SK: 'META',
      entity: 'charge',
      chargeId: 'legacy-charge',
      organizationId,
      customerId: 'customer-1',
      serviceAt: '2026-09-10T19:00:00.000Z',
      amount: 100,
    });
    await repo.put({
      PK: 'PAYMENT#legacy-payment',
      SK: 'META',
      entity: 'payment',
      paymentId: 'legacy-payment',
      organizationId,
      customerId: 'customer-1',
      paidAt: '2026-09-10T19:05:00.000Z',
      amount: 100,
    });
    await repo.put({
      PK: `ORG#${organizationId}`,
      SK: 'USER#owner',
      entity: 'user',
      organizationId,
      userId: 'owner',
      role: 'OWNER',
      name: 'Owner',
      email: `owner-${organizationId}@migrate.test`,
      passwordHash: await hashPassword('password'),
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const first = await migratePhase3(repo);
    expect(first.financialIndexesCreated).toBeGreaterThan(0);
    const second = await migratePhase3(repo);
    expect(second.financialIndexesCreated).toBe(0);
    expect(await migratePhase3(repo)).toMatchObject({
      financialIndexesCreated: 0,
    });

    const services = buildServices(repo);
    const owner = {
      organizationId,
      userId: 'owner',
      role: 'OWNER' as const,
    };
    expect(await services.memberships.list(owner)).toEqual([]);
    expect(
      await services.packages.listCustomerPackages(owner, 'customer-1'),
    ).toEqual([]);
    expect(await services.customers.get(owner, 'customer-1')).toMatchObject({
      customerId: 'customer-1',
    });
  }, 60000);
});
