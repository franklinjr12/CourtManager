import { describe, expect, it } from 'vitest';
import {
  CreditTransactionSchema,
  CustomerPackageSchema,
  FixedCourtAgreementSchema,
  MembershipPeriodSchema,
  MembershipSchema,
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

describe('Phase 3 commercial contracts', () => {
  it('represents normalized finite and explicit unlimited benefits', () => {
    expect(PlanBenefitSchema.parse(finiteCourtBenefit)).toMatchObject({
      quantity: 240,
      unit: 'COURT_MINUTES',
      quantityType: 'FINITE',
    });

    expect(
      PlanBenefitSchema.parse({
        type: 'OPEN_GAME',
        period: 'MONTH',
        quantityType: 'UNLIMITED',
        unit: 'GAME',
      }),
    ).toMatchObject({ quantityType: 'UNLIMITED' });
  });

  it('rejects invalid benefit quantity and unit combinations', () => {
    expect(
      PlanBenefitSchema.safeParse({
        ...finiteCourtBenefit,
        quantity: 90.5,
      }).success,
    ).toBe(false);
    expect(
      PlanBenefitSchema.safeParse({
        ...finiteCourtBenefit,
        quantity: 0,
      }).success,
    ).toBe(false);
    expect(
      PlanBenefitSchema.safeParse({
        ...finiteCourtBenefit,
        quantityType: 'FINITE',
        quantity: undefined,
      }).success,
    ).toBe(false);
    expect(
      PlanBenefitSchema.safeParse({
        type: 'COURT_TIME',
        period: 'MONTH',
        quantityType: 'UNLIMITED',
        quantity: 240,
        unit: 'COURT_MINUTES',
      }).success,
    ).toBe(false);
    expect(
      PlanBenefitSchema.safeParse({
        ...finiteCourtBenefit,
        unit: 'SESSION',
      }).success,
    ).toBe(false);
  });

  it('requires a duration only for custom billing intervals', () => {
    const plan = {
      planId: 'plan-1',
      organizationId: 'org-1',
      name: 'Custom plan',
      status: 'ACTIVE' as const,
      basePrice: 300,
      currency: 'BRL',
      benefits: [finiteCourtBenefit],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    };
    expect(
      PlanSchema.safeParse({ ...plan, billingInterval: 'CUSTOM' }).success,
    ).toBe(false);
    expect(
      PlanSchema.safeParse({
        ...plan,
        billingInterval: 'CUSTOM',
        customIntervalDays: 45,
      }).success,
    ).toBe(true);
  });

  it('validates fixed court slot structure and time boundaries', () => {
    const fixedSlot = {
      type: 'FIXED_COURT_SLOT' as const,
      period: 'MEMBERSHIP_PERIOD' as const,
      unit: 'OCCURRENCE' as const,
      courtId: 'court-2',
      weekday: 'WEDNESDAY' as const,
      startTime: '19:00',
      endTime: '21:00',
    };
    expect(PlanBenefitSchema.safeParse(fixedSlot).success).toBe(true);
    expect(
      PlanBenefitSchema.safeParse({ ...fixedSlot, endTime: '19:00' }).success,
    ).toBe(false);
  });

  it('keeps customer-specific membership and package prices as snapshots', () => {
    const plan = PlanSchema.parse({
      planId: 'plan-1',
      organizationId: 'org-1',
      name: 'Monthly court time',
      status: 'ACTIVE',
      basePrice: 500,
      currency: 'BRL',
      billingInterval: 'MONTHLY',
      benefits: [finiteCourtBenefit],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
    const membership = MembershipSchema.parse({
      membershipId: 'membership-1',
      organizationId: 'org-1',
      customerId: 'customer-1',
      planId: plan.planId,
      planNameSnapshot: plan.name,
      status: 'ACTIVE',
      startDate: '2026-09-01',
      currentPeriodStart: '2026-09-01',
      currentPeriodEnd: '2026-09-30',
      nextRenewalDate: '2026-10-01',
      currentPeriodId: 'period-1',
      price: 450,
      currency: 'BRL',
      billingInterval: 'MONTHLY',
      benefitSnapshot: [finiteCourtBenefit],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
    const customerPackage = CustomerPackageSchema.parse({
      customerPackageId: 'customer-package-1',
      organizationId: 'org-1',
      customerId: 'customer-1',
      packageDefinitionId: 'package-1',
      packageNameSnapshot: 'Ten court hours',
      status: 'ACTIVE',
      issuedAt: '2026-09-01T12:00:00.000Z',
      startsAt: '2026-09-01T12:00:00.000Z',
      expiresAt: '2026-12-01T12:00:00.000Z',
      price: 700,
      currency: 'BRL',
      benefitSnapshot: [
        {
          ...finiteCourtBenefit,
          period: 'PACKAGE_LIFETIME' as const,
          quantity: 600,
        },
      ],
      createdAt: '2026-09-01T12:00:00.000Z',
      updatedAt: '2026-09-01T12:00:00.000Z',
    });

    expect(membership.price).toBe(450);
    expect(customerPackage.price).toBe(700);
    expect(plan.basePrice).toBe(500);
  });

  it('validates period, package, credit, and fixed-slot lifecycle boundaries', () => {
    expect(
      MembershipPeriodSchema.safeParse({
        membershipPeriodId: 'period-1',
        organizationId: 'org-1',
        membershipId: 'membership-1',
        periodNumber: 0,
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
      CustomerPackageSchema.safeParse({
        customerPackageId: 'customer-package-1',
        organizationId: 'org-1',
        customerId: 'customer-1',
        packageDefinitionId: 'package-1',
        packageNameSnapshot: 'Package',
        status: 'CONSUMED',
        issuedAt: '2026-09-01T12:00:00.000Z',
        startsAt: '2026-10-01T12:00:00.000Z',
        expiresAt: '2026-09-30T12:00:00.000Z',
        price: 100,
        currency: 'BRL',
        benefitSnapshot: [finiteCourtBenefit],
        createdAt: '2026-09-01T12:00:00.000Z',
        updatedAt: '2026-09-01T12:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      CreditTransactionSchema.safeParse({
        creditTransactionId: 'credit-1',
        organizationId: 'org-1',
        customerId: 'customer-1',
        sourceType: 'PACKAGE',
        sourceId: 'customer-package-1',
        transactionType: 'CONSUMED',
        unit: 'COURT_MINUTES',
        quantity: 0,
        occurredAt: '2026-09-01T19:00:00.000Z',
        createdBy: 'user-1',
        createdAt: '2026-09-01T19:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      FixedCourtAgreementSchema.safeParse({
        agreementId: 'agreement-1',
        organizationId: 'org-1',
        customerId: 'customer-1',
        courtId: 'court-1',
        status: 'PAUSED',
        weekday: 'WEDNESDAY',
        startTime: '19:00',
        startDate: '2026-09-01',
        intervalWeeks: 1,
        durationMinutes: 0,
        monthlyPrice: 500,
        currency: 'BRL',
        billingInterval: 'MONTHLY',
        timezone: 'America/Sao_Paulo',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('requires activity references for consumed credit transactions', () => {
    expect(
      CreditTransactionSchema.safeParse({
        creditTransactionId: 'credit-1',
        organizationId: 'org-1',
        customerId: 'customer-1',
        sourceType: 'MEMBERSHIP',
        sourceId: 'membership-1',
        transactionType: 'CONSUMED',
        unit: 'SESSION',
        quantity: -1,
        occurredAt: '2026-09-01T19:00:00.000Z',
        createdBy: 'user-1',
        createdAt: '2026-09-01T19:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});
