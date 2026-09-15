import type {
  Charge,
  CustomerPackage,
  FixedCourtAgreement,
  FixedCourtOccurrence,
  Membership,
  MembershipPeriod,
  PackageDefinition,
  Payment,
  Plan,
} from '@court-manager/contracts';
import { describe, expect, it } from 'vitest';
import { dynamo, ensureTable } from '../db.js';
import { Phase3Repository } from '../persistence/phase3-repository.js';

process.env.DYNAMODB_ENDPOINT = 'http://localhost:8120';
process.env.DYNAMODB_TABLE = 'court-manager-integration';
process.env.AWS_REGION = 'us-east-1';

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const organizationId = `phase3-${suffix}`;
const customerId = `customer-${suffix}`;
const now = '2026-09-14T12:00:00.000Z';

const plan: Plan = {
  planId: `plan-${suffix}`,
  organizationId,
  name: 'Court hours',
  status: 'ACTIVE',
  basePrice: 500,
  currency: 'BRL',
  billingInterval: 'MONTHLY',
  benefits: [
    {
      type: 'COURT_TIME',
      period: 'MONTH',
      quantityType: 'FINITE',
      quantity: 600,
      unit: 'COURT_MINUTES',
    },
  ],
  createdAt: now,
  updatedAt: now,
};

describe('DynamoDB Local Phase 3 persistence', () => {
  it('queries commercial indexes and atomically prevents duplicate/overspend usage', async () => {
    await ensureTable();
    const repository = new Phase3Repository(dynamo());
    await repository.putPlan(plan);
    expect(
      await repository.listPlans(organizationId, { status: 'ACTIVE' }),
    ).toHaveLength(1);
    expect(
      await repository.getPlan('another-organization', plan.planId),
    ).toBeUndefined();

    const membership: Membership = {
      membershipId: `membership-${suffix}`,
      organizationId,
      customerId,
      planId: plan.planId,
      planNameSnapshot: plan.name,
      status: 'ACTIVE',
      startDate: '2026-09-01',
      currentPeriodStart: '2026-09-01',
      currentPeriodEnd: '2026-09-30',
      nextRenewalDate: '2026-10-01',
      currentPeriodId: `period-${suffix}`,
      price: 450,
      currency: 'BRL',
      billingInterval: 'MONTHLY',
      benefitSnapshot: plan.benefits,
      createdAt: now,
      updatedAt: now,
    };
    await repository.putMembership(membership);
    expect(
      await repository.listMembershipsByCustomer(organizationId, customerId, {
        activeOnly: true,
      }),
    ).toHaveLength(1);
    expect(
      await repository.listMembershipsByPlan(organizationId, plan.planId),
    ).toHaveLength(1);
    expect(
      await repository.listMembershipsRenewing(
        organizationId,
        '2026-10-01',
        '2026-10-01',
      ),
    ).toHaveLength(1);
    expect(
      await repository.listMembershipsByStatus(organizationId, 'ACTIVE'),
    ).toHaveLength(1);

    const period: MembershipPeriod = {
      membershipPeriodId: membership.currentPeriodId!,
      organizationId,
      membershipId: membership.membershipId,
      periodNumber: 1,
      startDate: membership.currentPeriodStart,
      endDate: membership.currentPeriodEnd,
      status: 'ACTIVE',
      price: membership.price,
      currency: membership.currency,
      createdAt: now,
      updatedAt: now,
    };
    await repository.putMembershipPeriod(period);
    expect(
      await repository.listMembershipPeriods(
        organizationId,
        membership.membershipId,
      ),
    ).toHaveLength(1);

    const definition: PackageDefinition = {
      packageDefinitionId: `definition-${suffix}`,
      organizationId,
      name: 'Package',
      status: 'ACTIVE',
      price: 250,
      currency: 'BRL',
      validityDays: 90,
      benefits: [
        {
          type: 'COURT_TIME',
          period: 'PACKAGE_LIFETIME',
          quantityType: 'FINITE',
          quantity: 240,
          unit: 'COURT_MINUTES',
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    await repository.putPackageDefinition(definition);
    expect(
      await repository.listPackageDefinitions(organizationId, {
        status: 'ACTIVE',
      }),
    ).toHaveLength(1);
    const customerPackage: CustomerPackage = {
      customerPackageId: `package-${suffix}`,
      organizationId,
      customerId,
      packageDefinitionId: definition.packageDefinitionId,
      packageNameSnapshot: definition.name,
      status: 'ACTIVE',
      issuedAt: now,
      startsAt: now,
      expiresAt: '2026-12-13T12:00:00.000Z',
      price: definition.price,
      currency: definition.currency,
      benefitSnapshot: definition.benefits,
      createdAt: now,
      updatedAt: now,
    };
    await repository.putCustomerPackage(customerPackage);
    expect(
      await repository.listPackagesByCustomer(organizationId, customerId, {
        activeOnly: true,
      }),
    ).toHaveLength(1);
    expect(
      await repository.listPackagesExpiring(
        organizationId,
        '2026-12-01',
        '2026-12-31',
      ),
    ).toHaveLength(1);

    await repository.putCreditBalance({
      organizationId,
      customerId,
      sourceType: 'PACKAGE',
      sourceId: customerPackage.customerPackageId,
      benefitId: 'court-time',
      unit: 'COURT_MINUTES',
      quantityType: 'FINITE',
      issuedQuantity: 10,
      consumedQuantity: 0,
      restoredQuantity: 0,
      expiredQuantity: 0,
      remainingQuantity: 10,
      updatedAt: now,
    });
    const consume = (activityId: string) =>
      repository.consumeEntitlement({
        organizationId,
        customerId,
        sourceType: 'PACKAGE',
        sourceId: customerPackage.customerPackageId,
        benefitId: 'court-time',
        activityType: 'RESERVATION',
        activityId,
        unit: 'COURT_MINUTES',
        quantity: 6,
        coveredAmount: 100,
        currency: 'BRL',
        createdBy: 'staff-1',
        occurredAt: now,
        createdAt: now,
      });
    const results = await Promise.allSettled([
      consume('reservation-1'),
      consume('reservation-2'),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const successful = results.find((result) => result.status === 'fulfilled');
    const successfulActivityId =
      successful?.status === 'fulfilled'
        ? successful.value.allocation.activityId
        : undefined;
    expect(successfulActivityId).toBeTruthy();
    const duplicate = await consume(successfulActivityId ?? 'reservation-1');
    expect(duplicate.duplicate).toBe(true);
    expect(
      await repository.listAllocationsByActivity(
        organizationId,
        'RESERVATION',
        successfulActivityId ?? 'reservation-1',
      ),
    ).toHaveLength(1);
    expect(
      (
        await repository.getCreditBalance({
          sourceType: 'PACKAGE',
          sourceId: customerPackage.customerPackageId,
          benefitId: 'court-time',
        })
      )?.remainingQuantity,
    ).toBe(4);

    const agreement: FixedCourtAgreement = {
      agreementId: `agreement-${suffix}`,
      organizationId,
      customerId,
      courtId: 'court-1',
      status: 'ACTIVE',
      weekday: 'WEDNESDAY',
      startTime: '19:00',
      durationMinutes: 120,
      startDate: '2026-09-01',
      intervalWeeks: 1,
      monthlyPrice: 500,
      currency: 'BRL',
      billingInterval: 'MONTHLY',
      timezone: 'America/Sao_Paulo',
      createdAt: now,
      updatedAt: now,
    };
    await repository.putFixedCourtAgreement(agreement);
    expect(
      await repository.listActiveFixedCourtAgreementsByOrganization(
        organizationId,
      ),
    ).toHaveLength(1);
    const occurrence: FixedCourtOccurrence = {
      occurrenceId: `occurrence-${suffix}`,
      organizationId,
      agreementId: agreement.agreementId,
      customerId,
      courtId: agreement.courtId,
      date: '2026-09-02',
      startAt: '2026-09-02T22:00:00.000Z',
      endAt: '2026-09-03T00:00:00.000Z',
      status: 'SCHEDULED',
      price: 500,
      currency: 'BRL',
      createdAt: now,
      updatedAt: now,
    };
    await repository.putFixedCourtOccurrence(occurrence);
    expect(
      await repository.listFixedCourtOccurrencesByAgreement(
        organizationId,
        agreement.agreementId,
      ),
    ).toHaveLength(1);

    await repository.indexCharge({
      chargeId: `charge-${suffix}`,
      organizationId,
      customerId,
      serviceAt: now,
    } as Charge);
    await repository.indexPayment({
      paymentId: `payment-${suffix}`,
      organizationId,
      customerId,
      paidAt: now,
    } as Payment);
    expect(
      await repository.listCustomerCharges(organizationId, customerId),
    ).toHaveLength(1);
    expect(
      await repository.listCustomerPayments(organizationId, customerId),
    ).toHaveLength(1);
    expect(
      (
        await repository.listCustomerCommercialRecords(
          organizationId,
          customerId,
        )
      ).length,
    ).toBeGreaterThan(3);
  });
});
