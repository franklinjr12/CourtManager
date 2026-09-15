import type { AuthContext } from '@court-manager/contracts';
import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../db.js';
import { buildServices } from './index.js';

const owner: AuthContext = {
  organizationId: 'org-customer-balance',
  userId: 'owner-1',
  role: 'OWNER',
};

async function setup() {
  const repo = new MemoryRepository();
  await repo.put({
    PK: 'ORG#org-customer-balance',
    SK: 'META',
    entity: 'organization',
    organizationId: owner.organizationId,
    currency: 'BRL',
    timezone: 'UTC',
  });
  const services = buildServices(repo);
  const customer = await services.customers.create(owner, {
    name: 'João',
    phone: '41999990000',
  });
  return { repo, services, customerId: String(customer.customerId) };
}

describe('CustomerCommercialBalanceService', () => {
  it('separates financial money from ledger-backed service entitlements', async () => {
    const { services, customerId } = await setup();
    const plan = await services.plans.create(owner, {
      name: 'Monthly classes',
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
    const membership = await services.memberships.create(owner, {
      customerId,
      planId: plan.planId,
      startDate: '2026-09-01',
    });
    const definition = await services.packages.createDefinition(owner, {
      name: 'Court time',
      price: 700,
      validityDays: 90,
      benefits: [
        {
          type: 'COURT_TIME',
          period: 'PACKAGE_LIFETIME',
          quantityType: 'FINITE',
          quantity: 600,
          unit: 'COURT_MINUTES',
        },
      ],
    });
    const customerPackage = await services.packages.issue(owner, customerId, {
      packageDefinitionId: definition.packageDefinitionId,
      issuedAt: '2026-09-01T12:00:00.000Z',
    });
    await services.payments.create(owner, {
      chargeId: `membership-${membership.currentPeriodId}`,
      customerId,
      amount: 300,
      method: 'PIX',
      paidAt: '2026-09-02T12:00:00.000Z',
    });
    await services.entitlements.consume({
      organizationId: owner.organizationId,
      customerId,
      sourceType: 'PACKAGE',
      sourceId: customerPackage.customerPackageId,
      ...(definition.benefits[0]!.benefitId
        ? { benefitId: definition.benefits[0]!.benefitId }
        : {}),
      activityType: 'RESERVATION',
      activityId: 'reservation-covered-1',
      unit: 'COURT_MINUTES',
      quantity: 120,
      coveredAmount: 160,
      currency: 'BRL',
      createdBy: owner.userId,
      occurredAt: '2026-09-03T19:00:00.000Z',
    });

    const summary = await services.customerCommercialBalance.get(
      owner,
      customerId,
    );

    expect(summary.balance).toMatchObject({
      totalCharges: 1000,
      totalPayments: 300,
      totalCovered: 160,
      outstandingAmount: 700,
      financialCreditAmount: 0,
    });
    expect(summary.balance.credits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: 'PACKAGE',
          quantityType: 'FINITE',
          issuedQuantity: 600,
          consumedQuantity: 120,
          remainingQuantity: 480,
        }),
      ]),
    );
    expect(summary.memberships).toHaveLength(1);
    expect(summary.packages).toHaveLength(1);
    expect(summary.activity.activeMembershipCount).toBe(1);
  });

  it('makes an overpayment explicit without reducing entitlement usage to cash', async () => {
    const { services, customerId } = await setup();
    const plan = await services.plans.create(owner, {
      name: 'Small plan',
      basePrice: 100,
      billingInterval: 'MONTHLY',
      benefits: [
        {
          type: 'CLASS_ATTENDANCE',
          period: 'MONTH',
          quantityType: 'FINITE',
          quantity: 1,
          unit: 'SESSION',
        },
      ],
    });
    const membership = await services.memberships.create(owner, {
      customerId,
      planId: plan.planId,
      startDate: '2026-09-01',
    });
    await services.payments.create(owner, {
      chargeId: `membership-${membership.currentPeriodId}`,
      customerId,
      amount: 125,
      method: 'CASH',
      paidAt: '2026-09-02T12:00:00.000Z',
    });

    const summary = await services.customerCommercialBalance.get(
      owner,
      customerId,
    );
    expect(summary.balance).toMatchObject({
      totalCharges: 100,
      totalPayments: 125,
      outstandingAmount: 0,
      financialCreditAmount: 25,
    });
  });
});
