import { describe, expect, it } from 'vitest';
import { classFixture } from '../testing/class-fixture.js';
import { MemoryRepository } from '../db.js';
import {
  consumeClassCredit,
  createCommercialVenue,
  createCourtMinutesPackage,
  createMonthlyClassMembership,
  issuePackageToCustomer,
  localDate,
} from '../testing/phase3-fixture.js';

describe('entitlement selection priority', () => {
  it('prefers makeup credits over membership and package class credits', async () => {
    const repo = new MemoryRepository();
    const fixture = await classFixture(repo);
    const { services, owner, ctx, classId } = fixture;
    const customerId = ctx.customerId;
    const plan = await services.plans.create(owner, {
      name: '8 Classes / Month',
      basePrice: 280,
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
    await services.memberships.create(owner, {
      customerId,
      planId: plan.planId,
      startDate: localDate(2026, 9, 1),
    });
    const definition = await services.packages.createDefinition(owner, {
      name: 'Court package',
      price: 100,
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
    await services.packages.issue(owner, customerId, {
      packageDefinitionId: definition.packageDefinitionId,
    });
    const makeup = await services.makeupCredits.issue(owner, customerId, {
      originClassId: classId,
      originSessionId: `${classId}-2099-01-05`,
      reason: 'STAFF_GRANTED',
      issuedAt: '2026-09-01T12:00:00.000Z',
      expiresAt: '2026-09-30T23:59:59.999Z',
    });

    const activity = {
      activityType: 'CLASS_ATTENDANCE' as const,
      activityId: 'class-priority-1',
      quantity: 1,
      unit: 'SESSION' as const,
      occurredAt: '2026-09-15T10:00:00.000Z',
      venueDate: '2026-09-15',
      classType: 'GROUP' as const,
      coveredAmount: 35,
      currency: 'BRL',
    };
    const available = await services.entitlements.getAvailableEntitlements(
      { organizationId: owner.organizationId, customerId },
      activity,
    );
    expect(available[0]).toMatchObject({
      sourceType: 'MAKEUP',
      sourceId: makeup.makeupCreditId,
    });
  });

  it('surfaces package expiration on available court-time entitlements', async () => {
    const venue = await createCommercialVenue({ label: 'priority-package' });
    const customer = await venue.createCustomer('Package priority');
    const customerId = String(customer.customerId);
    const definition = await venue.services.packages.createDefinition(
      venue.owner,
      {
        name: 'Soon package',
        price: 100,
        validityDays: 10,
        benefits: [
          {
            type: 'COURT_TIME',
            period: 'PACKAGE_LIFETIME',
            quantityType: 'FINITE',
            quantity: 60,
            unit: 'COURT_MINUTES',
          },
        ],
      },
    );
    const customerPackage = await issuePackageToCustomer(
      venue,
      customerId,
      definition.packageDefinitionId,
      { issuedAt: '2026-09-01T12:00:00.000Z' },
    );

    const activity = {
      activityType: 'RESERVATION' as const,
      activityId: 'reservation-priority-1',
      quantity: 60,
      unit: 'COURT_MINUTES' as const,
      occurredAt: '2026-09-05T18:00:00.000Z',
      coveredAmount: 80,
      currency: 'BRL',
    };
    const available =
      await venue.services.entitlements.getAvailableEntitlements(
        { organizationId: venue.organizationId, customerId },
        activity,
      );
    expect(available).toEqual([
      expect.objectContaining({
        sourceType: 'PACKAGE',
        sourceId: customerPackage.customerPackageId,
        expiresAt: customerPackage.expiresAt,
      }),
    ]);
  });

  it('skips paused memberships and expired packages', async () => {
    const venue = await createCommercialVenue({ label: 'priority-skip' });
    const customer = await venue.createCustomer('Skip inactive');
    const customerId = String(customer.customerId);
    const { membership } = await createMonthlyClassMembership(venue, {
      customerId,
      startDate: localDate(2026, 9, 1),
    });
    await venue.services.memberships.pause(
      venue.staff,
      membership.membershipId,
    );
    const definition = await createCourtMinutesPackage(venue, { minutes: 60 });
    await issuePackageToCustomer(
      venue,
      customerId,
      definition.packageDefinitionId,
      { issuedAt: '2020-01-01T12:00:00.000Z' },
    );

    const activity = {
      activityType: 'CLASS_ATTENDANCE' as const,
      activityId: 'class-skip-1',
      quantity: 1,
      unit: 'SESSION' as const,
      occurredAt: '2026-09-15T10:00:00.000Z',
      venueDate: '2026-09-15',
      classType: 'GROUP' as const,
      coveredAmount: 35,
      currency: 'BRL',
    };
    const available =
      await venue.services.entitlements.getAvailableEntitlements(
        { organizationId: venue.organizationId, customerId },
        activity,
      );
    expect(available).toEqual([]);
  });

  it('consumes class credits exactly once through attendance', async () => {
    const venue = await createCommercialVenue({ label: 'priority-once' });
    const customer = await venue.createCustomer('Once customer');
    const customerId = String(customer.customerId);
    await createMonthlyClassMembership(venue, {
      customerId,
      startDate: localDate(2026, 9, 1),
    });
    const activity = {
      activityType: 'CLASS_ATTENDANCE' as const,
      activityId: 'class-once-1',
      quantity: 1,
      unit: 'SESSION' as const,
      occurredAt: '2026-09-15T10:00:00.000Z',
      venueDate: '2026-09-15',
      classType: 'GROUP' as const,
      coveredAmount: 35,
      currency: 'BRL',
    };
    const [entitlement] =
      await venue.services.entitlements.getAvailableEntitlements(
        { organizationId: venue.organizationId, customerId },
        activity,
      );
    expect(entitlement).toBeTruthy();
    const first = await consumeClassCredit(venue, {
      customerId,
      activityId: activity.activityId,
      occurredAt: activity.occurredAt,
      entitlement: entitlement!,
    });
    const second = await consumeClassCredit(venue, {
      customerId,
      activityId: activity.activityId,
      occurredAt: activity.occurredAt,
      entitlement: entitlement!,
    });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
  });
});
