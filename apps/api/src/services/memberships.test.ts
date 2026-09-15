import type { AuthContext } from '@court-manager/contracts';
import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../db.js';
import { Phase3Repository } from '../persistence/phase3-repository.js';
import { ensureMembershipPeriodCharge } from './membership-charges.js';
import { periodDates } from './memberships.js';
import { buildServices } from './index.js';

const owner: AuthContext = {
  organizationId: 'org-memberships',
  userId: 'owner-1',
  role: 'OWNER',
};
const staff: AuthContext = { ...owner, userId: 'staff-1', role: 'STAFF' };
const coach: AuthContext = { ...owner, userId: 'coach-1', role: 'COACH' };

const benefit = {
  type: 'CLASS_ATTENDANCE' as const,
  period: 'MONTH' as const,
  quantityType: 'FINITE' as const,
  quantity: 8,
  unit: 'SESSION' as const,
};

async function setup() {
  const repo = new MemoryRepository();
  await repo.put({
    PK: 'ORG#org-memberships',
    SK: 'META',
    entity: 'organization',
    organizationId: owner.organizationId,
    timezone: 'UTC',
    currency: 'BRL',
  });
  const services = buildServices(repo);
  const customer = await services.customers.create(owner, {
    name: 'Carlos',
    phone: '41999991234',
  });
  const plan = await services.plans.create(owner, {
    name: 'Eight classes',
    basePrice: 300,
    billingInterval: 'MONTHLY',
    benefits: [benefit],
  });
  return {
    repo,
    services,
    customerId: String(customer.customerId),
    plan,
  };
}

describe('MembershipService', () => {
  it('creates one charge per period and settles membership charges through recorded payments', async () => {
    const { repo, services, customerId, plan } = await setup();
    const membership = await services.memberships.create(owner, {
      customerId,
      planId: plan.planId,
      startDate: '2026-09-01',
      price: 270,
    });

    const firstCharges = await services.charges.list(owner, {
      sourceType: 'MEMBERSHIP',
    });
    expect(firstCharges).toEqual([
      expect.objectContaining({
        chargeId: `membership-${membership.currentPeriodId}`,
        sourceType: 'MEMBERSHIP',
        sourceId: membership.currentPeriodId,
        membershipId: membership.membershipId,
        membershipPeriodId: membership.currentPeriodId,
        amount: 270,
        outstanding: 270,
        paymentStatus: 'UNPAID',
      }),
    ]);
    const firstPeriod = (
      await services.memberships.periods(owner, membership.membershipId)
    )[0]!;
    await ensureMembershipPeriodCharge(
      repo,
      new Phase3Repository(repo),
      membership,
      firstPeriod,
      owner.userId,
    );
    const repeatedCharges = (await services.charges.list(owner, {
      sourceType: 'MEMBERSHIP',
    })) as Array<Record<string, unknown>>;
    expect(
      repeatedCharges.filter(
        (charge) => charge.sourceId === firstPeriod.membershipPeriodId,
      ),
    ).toHaveLength(1);

    const renewed = await services.memberships.renew(
      owner,
      membership.membershipId,
      { price: 300 },
    );
    const chargesAfterRenewal = await services.charges.list(owner, {
      sourceType: 'MEMBERSHIP',
    });
    expect(chargesAfterRenewal).toHaveLength(2);
    expect(chargesAfterRenewal).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: 270, outstanding: 270 }),
        expect.objectContaining({
          chargeId: `membership-${renewed.currentPeriodId}`,
          amount: 300,
          outstanding: 300,
        }),
      ]),
    );

    const payment = await services.payments.create(owner, {
      chargeId: `membership-${renewed.currentPeriodId}`,
      customerId,
      amount: 300,
      method: 'PIX',
      paidAt: '2026-10-01T12:00:00.000Z',
    });
    expect(payment).toMatchObject({
      chargeId: `membership-${renewed.currentPeriodId}`,
      customerId,
    });
    expect(
      await services.charges.get(
        owner,
        `membership-${renewed.currentPeriodId}`,
      ),
    ).toMatchObject({
      amount: 300,
      paidAmount: 300,
      outstanding: 0,
      paymentStatus: 'PAID',
    });
    expect(
      await services.charges.get(
        owner,
        `membership-${membership.currentPeriodId}`,
      ),
    ).toMatchObject({
      amount: 270,
      outstanding: 270,
      paymentStatus: 'UNPAID',
    });
  });

  it('snapshots the plan, preserves periods, and advances on renewal', async () => {
    const { repo, services, customerId, plan } = await setup();
    const membership = await services.memberships.create(owner, {
      customerId,
      planId: plan.planId,
      startDate: '2026-09-01',
      price: 270,
    });
    expect(membership).toMatchObject({
      planNameSnapshot: 'Eight classes',
      price: 270,
      billingInterval: 'MONTHLY',
      currentPeriodStart: '2026-09-01',
      currentPeriodEnd: '2026-09-30',
      nextRenewalDate: '2026-10-01',
    });
    const firstPeriodId = membership.currentPeriodId;
    expect(firstPeriodId).toBeTruthy();

    await services.plans.update(owner, plan.planId, {
      name: 'Changed plan name',
      basePrice: 999,
      benefits: [
        {
          ...benefit,
          quantity: 12,
        },
      ],
    });
    expect(
      await services.memberships.get(owner, membership.membershipId),
    ).toMatchObject({
      planNameSnapshot: 'Eight classes',
      price: 270,
      benefitSnapshot: [benefit],
    });

    const renewed = await services.memberships.renew(
      owner,
      membership.membershipId,
    );
    expect(renewed).toMatchObject({
      currentPeriodStart: '2026-10-01',
      currentPeriodEnd: '2026-10-31',
      nextRenewalDate: '2026-11-01',
      price: 270,
    });
    expect(renewed.currentPeriodId).not.toBe(firstPeriodId);
    expect(
      await services.memberships.periods(owner, membership.membershipId),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          membershipPeriodId: firstPeriodId,
          status: 'COMPLETED',
        }),
        expect.objectContaining({
          membershipPeriodId: renewed.currentPeriodId,
          periodNumber: 2,
          status: 'ACTIVE',
        }),
      ]),
    );
    expect(
      await repo.get({ PK: `PLAN#${plan.planId}`, SK: 'META' }),
    ).toMatchObject({ name: 'Changed plan name' });
  });

  it('converges repeated renewal requests with the same idempotency key', async () => {
    const { services, customerId, plan } = await setup();
    const membership = await services.memberships.create(owner, {
      customerId,
      planId: plan.planId,
      startDate: '2026-09-01',
    });

    const first = await services.memberships.renew(
      staff,
      membership.membershipId,
      { idempotencyKey: 'renewal-1', price: 310 },
    );
    const repeated = await services.memberships.renew(
      staff,
      membership.membershipId,
      { idempotencyKey: 'renewal-1', price: 310 },
    );

    expect(repeated.currentPeriodId).toBe(first.currentPeriodId);
    expect(
      await services.memberships.periods(owner, membership.membershipId),
    ).toHaveLength(2);
    expect(
      await services.charges.list(owner, { sourceType: 'MEMBERSHIP' }),
    ).toHaveLength(2);
  });

  it('does not create two periods when the same renewal is submitted concurrently', async () => {
    const { services, customerId, plan } = await setup();
    const membership = await services.memberships.create(owner, {
      customerId,
      planId: plan.planId,
      startDate: '2026-09-01',
    });
    const results = await Promise.allSettled([
      services.memberships.renew(staff, membership.membershipId, {
        idempotencyKey: 'renewal-race',
      }),
      services.memberships.renew(staff, membership.membershipId, {
        idempotencyKey: 'renewal-race',
      }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(2);
    expect(
      await services.memberships.periods(owner, membership.membershipId),
    ).toHaveLength(2);
  });

  it('stops and restores entitlement eligibility through pause and resume', async () => {
    const { services, customerId, plan } = await setup();
    const membership = await services.memberships.create(owner, {
      customerId,
      planId: plan.planId,
      startDate: new Date().toISOString().slice(0, 10),
    });
    const paused = await services.memberships.pause(
      staff,
      membership.membershipId,
    );
    expect(paused.status).toBe('PAUSED');
    expect(
      (await services.memberships.get(staff, membership.membershipId)).status,
    ).toBe('PAUSED');
    expect(
      (await services.memberships.resume(staff, membership.membershipId))
        .status,
    ).toBe('ACTIVE');
    await expect(
      services.memberships.pause(coach, membership.membershipId),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('supports scheduled and immediate cancellation without deleting usage history', async () => {
    const { services, customerId, plan } = await setup();
    const membership = await services.memberships.create(owner, {
      customerId,
      planId: plan.planId,
      startDate: new Date().toISOString().slice(0, 10),
    });
    const scheduled = await services.memberships.cancel(
      owner,
      membership.membershipId,
      {
        effectiveDate: membership.currentPeriodEnd,
        reason: 'Customer requested end of term',
      },
    );
    expect(scheduled).toMatchObject({
      status: 'ACTIVE',
      cancellationEffectiveDate: membership.currentPeriodEnd,
      cancellationReason: 'Customer requested end of term',
    });

    const immediate = await services.memberships.cancel(
      owner,
      membership.membershipId,
      {
        effectiveDate: membership.currentPeriodStart,
        reason: 'Immediate request',
      },
    );
    expect(immediate).toMatchObject({
      status: 'CANCELLED',
      cancellationEffectiveDate: membership.currentPeriodStart,
      cancellationReason: 'Immediate request',
      cancelledBy: owner.userId,
    });
    expect(
      (await services.memberships.periods(owner, membership.membershipId))[0],
    ).toMatchObject({ status: 'CANCELLED' });
    await expect(
      services.memberships.renew(owner, membership.membershipId),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('evaluates an ended period as expired and keeps it distinct from cancellation', async () => {
    const { services, customerId, plan } = await setup();
    const membership = await services.memberships.create(owner, {
      customerId,
      planId: plan.planId,
      startDate: '2020-01-01',
    });
    const expired = await services.memberships.get(
      owner,
      membership.membershipId,
    );
    expect(expired.status).toBe('EXPIRED');
    expect(
      (await services.memberships.periods(owner, membership.membershipId))[0],
    ).toMatchObject({ status: 'EXPIRED' });
    await expect(
      services.memberships.get(
        { ...owner, organizationId: 'another-org' },
        membership.membershipId,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reports overdue only when the renewal charge still has an outstanding amount', async () => {
    const { repo, services, customerId, plan } = await setup();
    const membership = await services.memberships.create(owner, {
      customerId,
      planId: plan.planId,
      startDate: '2026-09-01',
    });
    const persistence = new Phase3Repository(repo);
    const due = {
      ...membership,
      currentPeriodEnd: '2026-12-31',
      nextRenewalDate: '2020-01-01',
      updatedAt: '2026-09-15T12:00:00.000Z',
    };
    await persistence.putMembership(due, membership);
    expect(await services.memberships.list(owner, { overdue: true })).toEqual([
      expect.objectContaining({ membershipId: membership.membershipId }),
    ]);

    await services.payments.create(owner, {
      chargeId: `membership-${membership.currentPeriodId}`,
      customerId,
      amount: membership.price,
      method: 'PIX',
      paidAt: '2026-09-15T12:00:00.000Z',
    });
    expect(await services.memberships.list(owner, { overdue: true })).toEqual(
      [],
    );
  });

  it('calculates calendar periods without shortening February or custom terms', () => {
    expect(periodDates('2026-01-31', 'MONTHLY')).toEqual({
      startDate: '2026-01-31',
      endDate: '2026-02-27',
      nextRenewalDate: '2026-02-28',
    });
    expect(periodDates('2026-09-01', 'CUSTOM', 10)).toEqual({
      startDate: '2026-09-01',
      endDate: '2026-09-10',
      nextRenewalDate: '2026-09-11',
    });
  });
});
