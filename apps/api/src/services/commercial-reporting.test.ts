import { describe, expect, it } from 'vitest';
import { buildCommercialReporting } from './commercial-reporting.js';

const base = {
  from: '2026-09-01',
  to: '2026-09-30',
  timezone: 'America/Sao_Paulo',
};

describe('commercial reporting', () => {
  it('separates membership charges, recorded payments, and outstanding balances', () => {
    const result = buildCommercialReporting({
      ...base,
      memberships: [
        {
          membershipId: 'membership-1',
          planId: 'plan-1',
          planNameSnapshot: 'Monthly court',
          status: 'ACTIVE',
          startDate: '2026-08-01',
        },
        {
          membershipId: 'membership-2',
          planId: 'plan-1',
          planNameSnapshot: 'Monthly court',
          status: 'CANCELLED',
          startDate: '2026-08-01',
          cancellationEffectiveDate: '2026-09-12',
        },
      ],
      packages: [],
      creditTransactions: [],
      charges: [
        {
          chargeId: 'membership-charge-1',
          sourceType: 'MEMBERSHIP',
          status: 'ACTIVE',
          amount: 300,
          serviceAt: '2026-09-01T03:00:00.000Z',
        },
      ],
      payments: [
        {
          chargeId: 'membership-charge-1',
          amount: 125,
          paidAt: '2026-09-30T02:30:00.000Z',
        },
      ],
      fixedCourtAgreements: [],
    });

    expect(result.activeMemberships).toBe(1);
    expect(result.membershipsByPlan).toEqual([
      { planId: 'plan-1', planName: 'Monthly court', count: 1 },
    ]);
    expect(result.newMemberships).toBe(0);
    expect(result.cancelledMemberships).toBe(1);
    expect(result.membershipExpectedRevenue).toBe(300);
    expect(result.membershipRecordedPayments).toBe(125);
    expect(result.membershipOutstandingAmount).toBe(175);
  });

  it('reports package quantities per unit and excludes unlimited benefits', () => {
    const result = buildCommercialReporting({
      ...base,
      memberships: [],
      packages: [
        {
          customerPackageId: 'package-1',
          issuedAt: '2026-09-01T03:00:00.000Z',
          price: 500,
          benefitSnapshot: [
            {
              benefitId: 'minutes',
              unit: 'COURT_MINUTES',
              quantityType: 'FINITE',
              quantity: 600,
            },
            {
              benefitId: 'games',
              unit: 'GAME',
              quantityType: 'UNLIMITED',
            },
          ],
        },
      ],
      creditTransactions: [
        {
          sourceType: 'PACKAGE',
          sourceId: 'package-1',
          benefitId: 'minutes',
          unit: 'COURT_MINUTES',
          transactionType: 'ISSUED',
          quantity: 600,
          occurredAt: '2026-09-01T03:00:00.000Z',
        },
        {
          sourceType: 'PACKAGE',
          sourceId: 'package-1',
          benefitId: 'minutes',
          unit: 'COURT_MINUTES',
          transactionType: 'CONSUMED',
          quantity: -420,
          occurredAt: '2026-09-15T03:00:00.000Z',
        },
        {
          sourceType: 'PACKAGE',
          sourceId: 'package-1',
          benefitId: 'minutes',
          unit: 'COURT_MINUTES',
          transactionType: 'EXPIRED',
          quantity: -30,
          occurredAt: '2026-09-30T03:00:00.000Z',
        },
        {
          sourceType: 'PACKAGE',
          sourceId: 'package-1',
          benefitId: 'games',
          unit: 'GAME',
          transactionType: 'ISSUED',
          quantity: 1,
          occurredAt: '2026-09-01T03:00:00.000Z',
        },
      ],
      charges: [],
      payments: [],
      fixedCourtAgreements: [],
    });

    expect(result.packagesIssued).toBe(1);
    expect(result.packageSalesValue).toBe(500);
    expect(result.packageUtilization).toEqual([
      {
        unit: 'COURT_MINUTES',
        issuedQuantity: 600,
        consumedQuantity: 420,
        expiredQuantity: 30,
        utilizationPercent: 70,
      },
    ]);
  });

  it('reports fixed-agreement charges and organization-local date boundaries', () => {
    const result = buildCommercialReporting({
      ...base,
      memberships: [],
      packages: [],
      creditTransactions: [],
      charges: [
        {
          sourceType: 'FIXED_COURT_AGREEMENT',
          status: 'ACTIVE',
          amount: 450,
          serviceAt: '2026-09-30T23:30:00.000Z',
        },
        {
          sourceType: 'FIXED_COURT_AGREEMENT',
          status: 'ACTIVE',
          amount: 300,
          serviceAt: '2026-10-01T03:30:00.000Z',
        },
      ],
      payments: [],
      fixedCourtAgreements: [
        { status: 'ACTIVE', startDate: '2026-09-01' },
        { status: 'CANCELLED', startDate: '2026-09-01' },
      ],
    });

    expect(result.fixedCourtAgreements).toBe(1);
    expect(result.fixedCourtExpectedRevenue).toBe(450);
  });
});
