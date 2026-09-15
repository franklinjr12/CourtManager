import { describe, expect, it } from 'vitest';
import {
  CommercialActivityEventSchema,
  CreditBalanceSummarySchema,
  CreditTransactionSchema,
  EntitlementAllocationSchema,
  MakeupCreditSchema,
  MembershipPeriodSchema,
  MembershipSchema,
  PackageDefinitionSchema,
  PlanBenefitSchema,
  PlanSchema,
} from './index.js';

const finiteCourtBenefit = {
  type: 'COURT_TIME' as const,
  period: 'MONTH' as const,
  quantityType: 'FINITE' as const,
  quantity: 240,
  unit: 'COURT_MINUTES' as const,
};

describe('Phase 3 extended contract validation', () => {
  it('rejects every invalid enum and lifecycle status value', () => {
    const planBase = {
      planId: 'plan-1',
      organizationId: 'org-1',
      name: 'Plan',
      basePrice: 100,
      currency: 'BRL',
      billingInterval: 'MONTHLY' as const,
      benefits: [finiteCourtBenefit],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    };
    expect(
      PlanSchema.safeParse({ ...planBase, status: 'DELETED' }).success,
    ).toBe(false);
    expect(
      MembershipSchema.safeParse({
        membershipId: 'membership-1',
        organizationId: 'org-1',
        customerId: 'customer-1',
        planId: 'plan-1',
        planNameSnapshot: 'Plan',
        status: 'RUNNING',
        startDate: '2026-09-01',
        currentPeriodStart: '2026-09-01',
        currentPeriodEnd: '2026-09-30',
        nextRenewalDate: '2026-10-01',
        currentPeriodId: 'period-1',
        price: 100,
        currency: 'BRL',
        billingInterval: 'MONTHLY',
        benefitSnapshot: [finiteCourtBenefit],
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      PackageDefinitionSchema.safeParse({
        packageDefinitionId: 'package-1',
        organizationId: 'org-1',
        name: 'Package',
        status: 'HIDDEN',
        price: 100,
        currency: 'BRL',
        validityDays: 30,
        benefits: [
          {
            ...finiteCourtBenefit,
            period: 'PACKAGE_LIFETIME' as const,
          },
        ],
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      CreditTransactionSchema.safeParse({ transactionType: 'REFUNDED' })
        .success,
    ).toBe(false);
    expect(
      EntitlementAllocationSchema.safeParse({ status: 'PENDING' }).success,
    ).toBe(false);
    expect(MakeupCreditSchema.safeParse({ reason: 'UNKNOWN' }).success).toBe(
      false,
    );
  });

  it('rejects nonsensical benefit combinations across all benefit types', () => {
    expect(
      PlanBenefitSchema.safeParse({
        type: 'CLASS_ATTENDANCE',
        period: 'MONTH',
        quantityType: 'FINITE',
        quantity: 8,
        unit: 'COURT_MINUTES',
      }).success,
    ).toBe(false);
    expect(
      PlanBenefitSchema.safeParse({
        type: 'PRIVATE_LESSON',
        period: 'WEEK',
        quantityType: 'FINITE',
        quantity: 2,
        unit: 'GAME',
      }).success,
    ).toBe(false);
    expect(
      PlanBenefitSchema.safeParse({
        type: 'OPEN_GAME',
        period: 'MONTH',
        quantityType: 'UNLIMITED',
        unit: 'SESSION',
      }).success,
    ).toBe(false);
  });

  it('rejects invalid money limits and date ordering', () => {
    expect(
      PlanSchema.safeParse({
        planId: 'plan-1',
        organizationId: 'org-1',
        name: 'Plan',
        status: 'ACTIVE',
        basePrice: -1,
        currency: 'BRL',
        billingInterval: 'MONTHLY',
        benefits: [finiteCourtBenefit],
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      MembershipPeriodSchema.safeParse({
        membershipPeriodId: 'period-1',
        organizationId: 'org-1',
        membershipId: 'membership-1',
        periodNumber: 1,
        startDate: '2026-10-01',
        endDate: '2026-09-30',
        status: 'ACTIVE',
        price: 300,
        currency: 'BRL',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      MakeupCreditSchema.safeParse({
        makeupCreditId: 'makeup-1',
        organizationId: 'org-1',
        customerId: 'customer-1',
        originClassId: 'class-1',
        originSessionId: 'session-1',
        reason: 'STAFF_GRANTED',
        status: 'ACTIVE',
        issuedAt: '2026-10-01T12:00:00.000Z',
        expiresAt: '2026-09-01T12:00:00.000Z',
        createdBy: 'staff-1',
        createdAt: '2026-09-01T12:00:00.000Z',
        updatedAt: '2026-09-01T12:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('validates credit balance and commercial activity event references', () => {
    expect(
      CreditBalanceSummarySchema.safeParse({
        sourceType: 'PACKAGE',
        sourceId: 'package-1',
        unit: 'COURT_MINUTES',
        quantityType: 'FINITE',
        issuedQuantity: 60,
        consumedQuantity: 10,
        restoredQuantity: 5,
        expiredQuantity: 0,
        adjustedQuantity: 0,
        remainingQuantity: 55,
      }).success,
    ).toBe(true);
    expect(
      CommercialActivityEventSchema.safeParse({
        eventId: 'event-1',
        organizationId: 'org-1',
        customerId: 'customer-1',
        eventType: 'MEMBERSHIP_STARTED',
        sourceType: 'MEMBERSHIP',
        sourceId: 'membership-1',
        occurredAt: '2026-09-01T12:00:00.000Z',
        createdAt: '2026-09-01T12:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});
