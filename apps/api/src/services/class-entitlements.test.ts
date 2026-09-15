import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../db.js';
import { classFixture } from '../testing/class-fixture.js';

const weeklyClass = async (
  services: Awaited<ReturnType<typeof classFixture>>['services'],
  owner: { organizationId: string; userId: string; role: 'OWNER' },
  courtId: string,
) =>
  services.classes.create(owner, {
    name: 'Weekly Tennis',
    sport: 'Tennis',
    coachId: 'coach',
    courtId,
    capacity: 5,
    pricePerParticipant: 40,
    scheduleType: 'WEEKLY',
    weekday: 1,
    startDate: '2099-01-05',
    endDate: '2099-01-31',
    startTime: '11:00',
    durationMinutes: 60,
  });

describe('class entitlement consumption', () => {
  it('consumes membership weekly allowances once per attended session and resets on Monday', async () => {
    const repo = new MemoryRepository();
    const { services, owner, ctx, classId } = await classFixture(repo);
    const court = (await repo.get({
      PK: `CLASS#${classId}`,
      SK: 'META',
    }))!.courtId as string;
    const secondClass = await weeklyClass(services, owner, court);
    const plan = await services.plans.create(owner, {
      name: 'Two classes weekly',
      basePrice: 100,
      benefits: [
        {
          benefitId: 'weekly-classes',
          type: 'CLASS_ATTENDANCE',
          unit: 'SESSION',
          period: 'WEEK',
          quantityType: 'FINITE',
          quantity: 2,
        },
      ],
    });
    const membership = await services.memberships.create(owner, {
      customerId: ctx.customerId,
      planId: plan.planId,
      startDate: '2099-01-01',
    });
    await services.classes.enroll(owner, classId, ctx.customerId);
    await services.classes.enroll(
      owner,
      String(secondClass.classId),
      ctx.customerId,
    );

    expect(
      await services.entitlements.getAvailableEntitlements(
        { organizationId: owner.organizationId, customerId: ctx.customerId },
        {
          activityType: 'CLASS_ATTENDANCE',
          activityId: 'debug-attendance',
          quantity: 1,
          unit: 'SESSION',
          occurredAt: '2099-01-05T13:00:00.000Z',
          venueDate: '2099-01-05',
          classId,
          classType: 'GROUP',
          coveredAmount: 40,
          currency: 'BRL',
        },
      ),
    ).toHaveLength(1);

    await services.classes.participantTransition(
      owner,
      `${classId}-2099-01-05`,
      ctx.customerId,
      'CHECKED_IN',
    );
    await services.classes.participantTransition(
      owner,
      `${secondClass.classId}-2099-01-05`,
      ctx.customerId,
      'CHECKED_IN',
    );
    await services.classes.participantTransition(
      owner,
      `${secondClass.classId}-2099-01-12`,
      ctx.customerId,
      'CHECKED_IN',
    );

    const allocations = await repo.scan(
      (item) =>
        item.entity === 'entitlementAllocation' &&
        item.activityType === 'CLASS_ATTENDANCE' &&
        item.PK.startsWith('ENTITLEMENT_ALLOCATION#'),
    );
    expect(allocations).toHaveLength(3);
    expect(allocations.map((item) => item.sourceId)).toEqual([
      membership.membershipId,
      membership.membershipId,
      membership.membershipId,
    ]);
    expect(
      allocations.filter((item) => item.benefitPeriodKey === 'WEEK:2099-01-05'),
    ).toHaveLength(2);
    expect(
      allocations.filter((item) => item.benefitPeriodKey === 'WEEK:2099-01-12'),
    ).toHaveLength(1);
  });

  it('consumes package class credits, but does not consume for no-show or cancelled sessions', async () => {
    const repo = new MemoryRepository();
    const { services, owner, ctx, classId } = await classFixture(repo);
    const definition = await services.packages.createDefinition(owner, {
      name: 'One class credit',
      price: 40,
      validityDays: null,
      benefits: [
        {
          benefitId: 'class-credit',
          type: 'CLASS_ATTENDANCE',
          unit: 'SESSION',
          period: 'PACKAGE_LIFETIME',
          quantityType: 'FINITE',
          quantity: 1,
        },
      ],
    });
    const customerPackage = await services.packages.issue(
      owner,
      ctx.customerId,
      {
        packageDefinitionId: definition.packageDefinitionId,
      },
    );
    await services.classes.enroll(owner, classId, ctx.customerId);
    await services.classes.participantTransition(
      owner,
      `${classId}-2099-01-05`,
      ctx.customerId,
      'CHECKED_IN',
    );
    expect(
      await repo.scan(
        (item) =>
          item.entity === 'entitlementAllocation' &&
          item.PK.startsWith('ENTITLEMENT_ALLOCATION#'),
      ),
    ).toHaveLength(1);
    expect(
      await services.entitlements.getRemainingBalance({
        organizationId: owner.organizationId,
        customerId: ctx.customerId,
        sourceType: 'PACKAGE',
        sourceId: customerPackage.customerPackageId,
        benefitId: 'class-credit',
      }),
    ).toMatchObject({ remainingQuantity: 0, consumedQuantity: 1 });

    const secondRepo = new MemoryRepository();
    const second = await classFixture(secondRepo);
    const secondDefinition = await second.services.packages.createDefinition(
      second.owner,
      {
        name: 'No-show credit',
        price: 40,
        validityDays: null,
        benefits: [
          {
            benefitId: 'no-show-credit',
            type: 'CLASS_ATTENDANCE',
            unit: 'SESSION',
            period: 'PACKAGE_LIFETIME',
            quantityType: 'FINITE',
            quantity: 1,
          },
        ],
      },
    );
    await second.services.packages.issue(second.owner, second.ctx.customerId, {
      packageDefinitionId: secondDefinition.packageDefinitionId,
    });
    await second.services.classes.enroll(
      second.owner,
      second.classId,
      second.ctx.customerId,
    );
    await second.services.classes.participantTransition(
      second.owner,
      `${second.classId}-2099-01-05`,
      second.ctx.customerId,
      'NO_SHOW',
    );
    await second.services.classes.cancelSession(
      second.owner,
      `${second.classId}-2099-01-05`,
      'Venue cancellation',
    );
    expect(
      await secondRepo.scan(
        (item) =>
          item.entity === 'entitlementAllocation' &&
          item.PK.startsWith('ENTITLEMENT_ALLOCATION#'),
      ),
    ).toHaveLength(0);
  });

  it('limits monthly benefits within the membership commercial period', async () => {
    const repo = new MemoryRepository();
    const { services, owner, ctx, classId } = await classFixture(repo);
    const classRecord = (await repo.get({
      PK: `CLASS#${classId}`,
      SK: 'META',
    }))!;
    const secondClass = await weeklyClass(
      services,
      owner,
      String(classRecord.courtId),
    );
    const plan = await services.plans.create(owner, {
      name: 'One class monthly',
      basePrice: 100,
      benefits: [
        {
          benefitId: 'monthly-classes',
          type: 'CLASS_ATTENDANCE',
          unit: 'SESSION',
          period: 'MONTH',
          quantityType: 'FINITE',
          quantity: 1,
        },
      ],
    });
    const membership = await services.memberships.create(owner, {
      customerId: ctx.customerId,
      planId: plan.planId,
      startDate: '2099-01-01',
    });
    await services.classes.enroll(owner, classId, ctx.customerId);
    await services.classes.enroll(
      owner,
      String(secondClass.classId),
      ctx.customerId,
    );
    await services.classes.participantTransition(
      owner,
      `${classId}-2099-01-05`,
      ctx.customerId,
      'CHECKED_IN',
    );
    await services.classes.participantTransition(
      owner,
      `${secondClass.classId}-2099-01-12`,
      ctx.customerId,
      'CHECKED_IN',
    );
    const allocations = await repo.scan(
      (item) =>
        item.PK.startsWith('ENTITLEMENT_ALLOCATION#') &&
        item.activityType === 'CLASS_ATTENDANCE',
    );
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({
      sourceId: membership.membershipId,
      benefitPeriodKey: 'MONTH:2099-01',
    });
    expect(
      await repo.get({
        PK: `CHARGE#class-${secondClass.classId}-2099-01-12-${ctx.customerId}`,
        SK: 'META',
      }),
    ).toMatchObject({ status: 'ACTIVE', amount: 40 });
  });

  it('does not let a private-lesson credit cover a group class', async () => {
    const repo = new MemoryRepository();
    const { services, owner, ctx, classId } = await classFixture(repo);
    const definition = await services.packages.createDefinition(owner, {
      name: 'Private lesson',
      price: 40,
      validityDays: null,
      benefits: [
        {
          benefitId: 'private-credit',
          type: 'PRIVATE_LESSON',
          unit: 'SESSION',
          period: 'PACKAGE_LIFETIME',
          quantityType: 'FINITE',
          quantity: 1,
        },
      ],
    });
    await services.packages.issue(owner, ctx.customerId, {
      packageDefinitionId: definition.packageDefinitionId,
    });
    await services.classes.enroll(owner, classId, ctx.customerId);
    await services.classes.participantTransition(
      owner,
      `${classId}-2099-01-05`,
      ctx.customerId,
      'CHECKED_IN',
    );
    expect(
      await repo.scan(
        (item) =>
          item.entity === 'entitlementAllocation' &&
          item.PK.startsWith('ENTITLEMENT_ALLOCATION#'),
      ),
    ).toHaveLength(0);
    expect(
      await repo.get({
        PK: `CHARGE#class-${classId}-2099-01-05-${ctx.customerId}`,
        SK: 'META',
      }),
    ).toMatchObject({ status: 'ACTIVE', amount: 40 });
  });
});
