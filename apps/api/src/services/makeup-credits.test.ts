import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../db.js';
import { classFixture } from '../testing/class-fixture.js';

describe('makeup credits', () => {
  it('issues an origin-linked ledger credit and consumes it once at attendance', async () => {
    const repo = new MemoryRepository();
    const { services, owner, ctx, classId } = await classFixture(repo);
    const sessionId = `${classId}-2099-01-05`;

    const credit = await services.makeupCredits.issue(owner, ctx.customerId, {
      originClassId: classId,
      originSessionId: sessionId,
      reason: 'EXCUSED_ABSENCE',
      issuedAt: '2099-01-01T12:00:00.000Z',
      expiresAt: '2099-02-01T00:00:00.000Z',
      idempotencyKey: 'absence-1',
    });
    expect(credit).toMatchObject({
      customerId: ctx.customerId,
      originClassId: classId,
      originSessionId: sessionId,
      reason: 'EXCUSED_ABSENCE',
      status: 'ACTIVE',
    });
    expect(
      await services.makeupCredits.issue(owner, ctx.customerId, {
        originClassId: classId,
        originSessionId: sessionId,
        reason: 'EXCUSED_ABSENCE',
        issuedAt: '2099-01-01T12:00:00.000Z',
        idempotencyKey: 'absence-1',
      }),
    ).toMatchObject({ makeupCreditId: credit.makeupCreditId });

    await services.classes.enroll(owner, classId, ctx.customerId);
    await services.classes.participantTransition(
      owner,
      sessionId,
      ctx.customerId,
      'CHECKED_IN',
    );

    const allocations = await repo.scan(
      (item) =>
        item.entity === 'entitlementAllocation' &&
        item.sourceType === 'MAKEUP' &&
        item.PK.startsWith('ENTITLEMENT_ALLOCATION#'),
    );
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({
      sourceId: credit.makeupCreditId,
      activityType: 'CLASS_ATTENDANCE',
      activityId: `${sessionId}-${ctx.customerId}`,
    });
    expect(
      await services.makeupCredits.list(owner, ctx.customerId),
    ).toMatchObject([
      {
        makeupCreditId: credit.makeupCreditId,
        status: 'CONSUMED',
        remainingQuantity: 0,
      },
    ]);
  });

  it('does not offer an expired credit and prefers the earliest expiry', async () => {
    const repo = new MemoryRepository();
    const { services, owner, ctx, classId } = await classFixture(repo);
    const sessionId = `${classId}-2099-01-05`;
    await services.makeupCredits.issue(owner, ctx.customerId, {
      originClassId: classId,
      originSessionId: sessionId,
      reason: 'VENUE_CANCELLED',
      issuedAt: '2099-01-01T12:00:00.000Z',
      expiresAt: '2099-01-04T00:00:00.000Z',
    });
    const available = await services.entitlements.getAvailableEntitlements(
      { organizationId: owner.organizationId, customerId: ctx.customerId },
      {
        activityType: 'CLASS_ATTENDANCE',
        activityId: 'future-attendance',
        quantity: 1,
        unit: 'SESSION',
        occurredAt: '2099-01-05T13:00:00.000Z',
        classId,
        classType: 'GROUP',
      },
    );
    expect(available).toHaveLength(0);

    const second = await services.makeupCredits.issue(owner, ctx.customerId, {
      originClassId: classId,
      originSessionId: sessionId,
      reason: 'STAFF_GRANTED',
      issuedAt: '2099-01-01T12:00:00.000Z',
      expiresAt: '2099-03-01T00:00:00.000Z',
    });
    const current = await services.entitlements.getAvailableEntitlements(
      { organizationId: owner.organizationId, customerId: ctx.customerId },
      {
        activityType: 'CLASS_ATTENDANCE',
        activityId: 'future-attendance-2',
        quantity: 1,
        unit: 'SESSION',
        occurredAt: '2099-01-05T13:00:00.000Z',
        classId,
        classType: 'GROUP',
      },
    );
    expect(current[0]?.sourceId).toBe(second.makeupCreditId);
  });

  it('can issue one venue-cancellation credit for each active enrollee', async () => {
    const repo = new MemoryRepository();
    const { services, owner, ctx, classId } = await classFixture(repo);
    await services.classes.enroll(owner, classId, ctx.customerId);
    await services.classes.cancelSession(
      owner,
      `${classId}-2099-01-05`,
      'Venue maintenance',
      true,
    );
    expect(
      await services.makeupCredits.list(owner, ctx.customerId),
    ).toMatchObject([
      {
        originClassId: classId,
        originSessionId: `${classId}-2099-01-05`,
        reason: 'VENUE_CANCELLED',
        status: 'ACTIVE',
        remainingQuantity: 1,
      },
    ]);
  });

  it('reconciles a duplicate attendance retry and rejects reused keys with different origins', async () => {
    const repo = new MemoryRepository();
    const { services, owner, ctx, classId } = await classFixture(repo);
    const sessionId = `${classId}-2099-01-05`;
    const credit = await services.makeupCredits.issue(owner, ctx.customerId, {
      originClassId: classId,
      originSessionId: sessionId,
      reason: 'STAFF_GRANTED',
      idempotencyKey: 'makeup-retry',
    });

    await services.classes.enroll(owner, classId, ctx.customerId);
    await services.classes.participantTransition(
      owner,
      sessionId,
      ctx.customerId,
      'CHECKED_IN',
    );

    // Simulate the small window where ledger persistence succeeded but the
    // denormalized status update did not.
    await repo.put({
      ...(await repo.get({
        PK: `MAKEUP_CREDIT#${credit.makeupCreditId}`,
        SK: 'META',
      }))!,
      status: 'ACTIVE',
      consumedAt: undefined,
    });
    await services.entitlements.consume({
      sourceType: 'MAKEUP',
      sourceId: credit.makeupCreditId,
      benefitId: 'makeup-attendance',
      organizationId: owner.organizationId,
      customerId: ctx.customerId,
      activityType: 'CLASS_ATTENDANCE',
      activityId: `${sessionId}-${ctx.customerId}`,
      unit: 'SESSION',
      quantity: 1,
      coveredAmount: 40,
      currency: 'BRL',
      createdBy: owner.userId,
      occurredAt: '2099-01-05T10:00:00.000Z',
      createdAt: '2099-01-05T10:00:00.000Z',
    });
    expect(
      await services.makeupCredits.list(owner, ctx.customerId),
    ).toMatchObject([
      { makeupCreditId: credit.makeupCreditId, status: 'CONSUMED' },
    ]);

    await expect(
      services.makeupCredits.issue(owner, ctx.customerId, {
        originClassId: classId,
        originSessionId: sessionId,
        reason: 'OTHER',
        idempotencyKey: 'makeup-retry',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
