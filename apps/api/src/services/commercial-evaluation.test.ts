import type { CustomerPackage, Membership } from '@court-manager/contracts';
import { describe, expect, it } from 'vitest';
import {
  evaluateMembership,
  evaluatePackage,
  outstandingChargeAmount,
} from './commercial-evaluation.js';

const membership = (overrides: Partial<Membership> = {}): Membership => ({
  membershipId: 'membership-1',
  organizationId: 'org-1',
  customerId: 'customer-1',
  planId: 'plan-1',
  planNameSnapshot: 'Monthly',
  status: 'ACTIVE',
  startDate: '2026-09-01',
  currentPeriodStart: '2026-09-01',
  currentPeriodEnd: '2026-09-30',
  nextRenewalDate: '2026-10-01',
  currentPeriodId: 'period-1',
  price: 300,
  currency: 'BRL',
  billingInterval: 'MONTHLY',
  benefitSnapshot: [
    {
      type: 'CLASS_ATTENDANCE',
      period: 'MONTH',
      quantityType: 'FINITE',
      quantity: 8,
      unit: 'SESSION',
    },
  ],
  createdAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-09-01T12:00:00.000Z',
  ...overrides,
});

const customerPackage = (overrides: Partial<CustomerPackage> = {}) =>
  ({
    customerPackageId: 'package-1',
    organizationId: 'org-1',
    customerId: 'customer-1',
    packageDefinitionId: 'definition-1',
    packageNameSnapshot: 'Court hours',
    status: 'ACTIVE',
    issuedAt: '2026-09-01T12:00:00.000Z',
    startsAt: '2026-09-01T12:00:00.000Z',
    expiresAt: '2026-09-30T12:00:00.000Z',
    price: 300,
    currency: 'BRL',
    benefitSnapshot: [
      {
        type: 'COURT_TIME',
        period: 'PACKAGE_LIFETIME',
        quantityType: 'FINITE',
        quantity: 120,
        unit: 'COURT_MINUTES',
      },
    ],
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    ...overrides,
  }) satisfies CustomerPackage;

describe('commercial evaluation', () => {
  it('requires an outstanding charge for overdue membership status', () => {
    const value = membership({
      currentPeriodEnd: '2026-10-31',
      nextRenewalDate: '2026-09-01',
    });
    expect(
      evaluateMembership(value, {
        today: '2026-09-15',
        outstandingAmount: 0,
      }).overdue,
    ).toBe(false);
    expect(
      evaluateMembership(value, {
        today: '2026-09-15',
        outstandingAmount: 300,
      }).overdue,
    ).toBe(true);
  });

  it('uses the venue timezone for package expiry windows', () => {
    const value = customerPackage({ expiresAt: '2026-09-30T02:00:00.000Z' });
    expect(
      evaluatePackage(value, {
        today: '2026-09-29',
        asOf: '2026-09-29T23:00:00.000Z',
        timezone: 'America/Sao_Paulo',
        windowDays: 1,
      }).expiringSoon,
    ).toBe(true);
    expect(
      evaluatePackage(value, {
        today: '2026-09-30',
        asOf: '2026-09-30T03:00:00.000Z',
        timezone: 'America/Sao_Paulo',
      }).expired,
    ).toBe(true);
  });

  it('calculates overdue money from the charge and its recorded payments', () => {
    expect(
      outstandingChargeAmount(
        { chargeId: 'charge-1', amount: 300, status: 'ACTIVE' },
        [{ chargeId: 'charge-1', amount: 100 }],
      ),
    ).toBe(200);
    expect(
      outstandingChargeAmount(
        { chargeId: 'charge-1', amount: 300, status: 'VOID' },
        [],
      ),
    ).toBe(0);
  });
});
