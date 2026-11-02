import { randomUUID } from 'node:crypto';
import type { AuthContext } from '@court-manager/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dynamo, ensureTable } from '../db.js';
import { buildServices } from '../services/index.js';
import { Phase3Repository } from '../persistence/phase3-repository.js';

process.env.DYNAMODB_ENDPOINT = 'http://localhost:8120';
process.env.DYNAMODB_TABLE = 'court-manager-integration';
process.env.AWS_REGION = 'us-east-1';

async function setup() {
  await ensureTable();
  const repo = dynamo();
  const organizationId = `membership-${randomUUID()}`;
  const ctx: AuthContext = { organizationId, userId: 'owner-1', role: 'OWNER' };
  const timestamp = new Date().toISOString();
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: 'META',
    entity: 'organization',
    organizationId,
    name: 'Membership Arena',
    slug: organizationId,
    timezone: 'UTC',
    currency: 'BRL',
    active: true,
    features: { classes: true, finance: true },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const services = buildServices(repo);
  const customer = await services.customers.create(ctx, {
    name: 'Carlos',
    phone: '41999991234',
  });
  const plan = await services.plans.create(ctx, {
    name: 'Eight classes',
    basePrice: 300,
    billingInterval: 'MONTHLY',
    benefits: [
      {
        type: 'CLASS_ATTENDANCE',
        period: 'MONTH',
        quantityType: 'FINITE',
        quantity: 8,
        unit: 'SESSION',
      },
    ],
  });
  return {
    repo,
    ctx,
    services,
    customerId: String(customer.customerId),
    plan,
    organizationId,
  };
}

const today = () => new Date().toISOString().slice(0, 10);

describe('membership lifecycle on DynamoDB Local', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('pauses, resumes and cancels a renewed membership', async () => {
    const { ctx, services, customerId, plan, organizationId, repo } =
      await setup();
    const phase3 = new Phase3Repository(repo);
    const created = await services.memberships.create(ctx, {
      customerId,
      planId: plan.planId,
      startDate: today(),
    });
    const id = created.membershipId;
    const renewed = await services.memberships.renew(ctx, id);
    expect((await services.memberships.pause(ctx, id)).status).toBe('PAUSED');
    expect((await services.memberships.resume(ctx, id)).status).toBe('ACTIVE');
    expect((await services.memberships.pause(ctx, id)).status).toBe('PAUSED');

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${renewed.currentPeriodStart}T12:00:00.000Z`));
    const cancelled = await services.memberships.cancel(ctx, id, {
      effectiveDate: renewed.currentPeriodStart,
    });
    expect(cancelled.status).toBe('CANCELLED');
    expect(await services.memberships.periods(ctx, id)).toHaveLength(2);
    expect(
      await phase3.listMembershipsByCustomer(organizationId, customerId, {
        activeOnly: true,
      }),
    ).toEqual([]);
  });

  it('schedules a cancellation at the end of a renewed period', async () => {
    const { ctx, services, customerId, plan } = await setup();
    const created = await services.memberships.create(ctx, {
      customerId,
      planId: plan.planId,
      startDate: today(),
    });
    const id = created.membershipId;
    const renewed = await services.memberships.renew(ctx, id);
    const scheduled = await services.memberships.cancel(ctx, id, {
      effectiveDate: renewed.currentPeriodEnd,
    });
    expect(scheduled).toMatchObject({
      status: 'ACTIVE',
      cancellationEffectiveDate: renewed.currentPeriodEnd,
    });
  });

  it('expires a membership whose period ended', async () => {
    const { ctx, services, customerId, plan } = await setup();
    const created = await services.memberships.create(ctx, {
      customerId,
      planId: plan.planId,
      startDate: '2020-01-01',
    });
    const expired = await services.memberships.get(ctx, created.membershipId);
    expect(expired.status).toBe('EXPIRED');
    const periods = await services.memberships.periods(
      ctx,
      created.membershipId,
    );
    expect(periods.map((period) => period.status)).toEqual(['EXPIRED']);
  });

  it('rejects a transaction touching one key twice without leaking DynamoDB text', async () => {
    await ensureTable();
    const repo = dynamo();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const key = { PK: `DUP#${randomUUID()}`, SK: 'ITEM' };
    const error = await repo
      .transactWrite([
        { type: 'put', item: { ...key, entity: 'customer', n: 1 } },
        { type: 'put', item: { ...key, entity: 'customer', n: 2 } },
      ])
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );
    expect(error).toBeInstanceOf(Error);
    const failure = error as Error & { code?: string };
    expect(failure.code).toBeUndefined();
    expect(failure.message).toBe('DynamoDB transaction was rejected.');
    expect(failure.message).not.toContain('100 actions');
    expect(await repo.get(key)).toBeUndefined();
  });
});
