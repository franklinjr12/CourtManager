import type { AuthContext, Membership } from '@court-manager/contracts';
import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../db.js';
import { buildServices } from './index.js';

const owner: AuthContext = {
  organizationId: 'org-plans',
  userId: 'owner-1',
  role: 'OWNER',
};
const staff: AuthContext = { ...owner, userId: 'staff-1', role: 'STAFF' };
const coach: AuthContext = { ...owner, userId: 'coach-1', role: 'COACH' };

const benefit = {
  type: 'COURT_TIME' as const,
  period: 'MONTH' as const,
  quantityType: 'FINITE' as const,
  quantity: 240,
  unit: 'COURT_MINUTES' as const,
};

async function setup() {
  const repo = new MemoryRepository();
  await repo.put({
    PK: 'ORG#org-plans',
    SK: 'META',
    entity: 'organization',
    organizationId: owner.organizationId,
    currency: 'BRL',
  });
  return { repo, services: buildServices(repo) };
}

describe('PlanService', () => {
  it('creates multiple finite/unlimited benefits and preserves membership snapshots on edit', async () => {
    const { repo, services } = await setup();
    const created = await services.plans.create(owner, {
      name: 'Monthly player',
      basePrice: 280,
      billingInterval: 'MONTHLY',
      benefits: [
        benefit,
        {
          type: 'OPEN_GAME',
          period: 'MONTH',
          quantityType: 'UNLIMITED',
          unit: 'GAME',
        },
      ],
    });
    expect(created.currency).toBe('BRL');
    expect(created.benefits).toHaveLength(2);
    expect(created.benefits.every((item) => item.benefitId)).toBe(true);

    const snapshot = structuredClone(created.benefits);
    const membership: Membership = {
      membershipId: 'membership-1',
      organizationId: owner.organizationId,
      customerId: 'customer-1',
      planId: created.planId,
      planNameSnapshot: created.name,
      status: 'ACTIVE',
      startDate: '2026-09-01',
      currentPeriodStart: '2026-09-01',
      currentPeriodEnd: '2026-09-30',
      price: created.basePrice,
      currency: created.currency,
      billingInterval: created.billingInterval,
      benefitSnapshot: snapshot,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
    await services.repo.put({
      PK: `MEMBERSHIP#${membership.membershipId}`,
      SK: 'META',
      entity: 'membership',
      ...membership,
    });

    const updated = await services.plans.update(owner, created.planId, {
      name: 'Updated monthly player',
      basePrice: 320,
      benefits: [
        {
          ...benefit,
          quantity: 480,
        },
      ],
    });
    expect(updated.name).toBe('Updated monthly player');
    expect(updated.basePrice).toBe(320);
    expect(await services.plans.get(owner, created.planId)).toMatchObject({
      name: 'Updated monthly player',
    });
    expect(
      await repo.get({ PK: 'MEMBERSHIP#membership-1', SK: 'META' }),
    ).toMatchObject({
      planNameSnapshot: 'Monthly player',
      price: 280,
      benefitSnapshot: snapshot,
    });
  });

  it('allows staff to manage plans, archives them without deleting history, and enforces tenant/role boundaries', async () => {
    const { services } = await setup();
    const created = await services.plans.create(owner, {
      name: 'Staff managed plan',
      basePrice: 100,
      benefits: [benefit],
    });
    expect(await services.plans.list(staff)).toHaveLength(1);
    await expect(
      services.plans.get(coach, created.planId),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      services.plans.get(
        { ...owner, organizationId: 'other-org' },
        created.planId,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const archived = await services.plans.archive(staff, created.planId);
    expect(archived.status).toBe('ARCHIVED');
    expect(await services.plans.get(staff, created.planId)).toMatchObject({
      status: 'ARCHIVED',
    });
    await expect(
      services.plans.update(staff, created.planId, { status: 'ACTIVE' }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});
