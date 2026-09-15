import { createHash, randomUUID } from 'node:crypto';
import {
  MembershipCancelInputSchema,
  MembershipInputSchema,
  MembershipPeriodSchema,
  MembershipRenewInputSchema,
  MembershipSchema,
  MembershipUpdateInputSchema,
  type AuthContext,
  type Membership,
  type MembershipPeriod,
} from '@court-manager/contracts';
import type { Repository, RecordItem } from '../db.js';
import { dayKeyInTimezone } from '../domain.js';
import { AppError } from '../errors.js';
import type { Phase3Persistence } from '../persistence/phase3-repository.js';
import type { CommercialActivityEventService } from './commercial-activity-events.js';
import {
  addCommercialDays,
  evaluateMembership,
  outstandingChargeAmount,
} from './commercial-evaluation.js';
import { EntitlementService, benefitPeriodKey } from './entitlements.js';
import { ensureMembershipPeriodCharge } from './membership-charges.js';

const now = () => new Date().toISOString();
const membershipId = () => `membership-${randomUUID()}`;
const periodId = () => `membership-period-${randomUUID()}`;
const renewalPeriodId = (
  membershipId: string,
  previousPeriodId: string,
  idempotencyKey?: string,
) =>
  idempotencyKey
    ? `membership-period-${createHash('sha256')
        .update(`${membershipId}|${previousPeriodId}|${idempotencyKey}`)
        .digest('hex')
        .slice(0, 40)}`
    : periodId();

const assertStaff = (ctx: AuthContext) => {
  if (!['OWNER', 'STAFF'].includes(ctx.role))
    throw new AppError(
      'FORBIDDEN',
      'You do not have permission for this operation.',
    );
};

const validationError = (error: { flatten: () => unknown }) =>
  new AppError(
    'VALIDATION_ERROR',
    'Membership validation failed.',
    error.flatten() as Record<string, unknown>,
  );

const dateValue = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new AppError('VALIDATION_ERROR', 'Expected a valid calendar date.');
  return date;
};

export const addCalendarDays = (value: string, days: number) => {
  const date = dateValue(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const addCalendarMonths = (value: string, months: number) => {
  const date = dateValue(value);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
};

export const nextPeriodStart = (
  startDate: string,
  billingInterval: Membership['billingInterval'],
  customIntervalDays?: number,
) => {
  if (billingInterval === 'WEEKLY') return addCalendarDays(startDate, 7);
  if (billingInterval === 'MONTHLY') return addCalendarMonths(startDate, 1);
  if (customIntervalDays === undefined)
    throw new AppError(
      'VALIDATION_ERROR',
      'Custom billing intervals require a duration in days.',
    );
  return addCalendarDays(startDate, customIntervalDays);
};

export const periodDates = (
  startDate: string,
  billingInterval: Membership['billingInterval'],
  customIntervalDays?: number,
) => {
  const nextStart = nextPeriodStart(
    startDate,
    billingInterval,
    customIntervalDays,
  );
  return {
    startDate,
    endDate: addCalendarDays(nextStart, -1),
    nextRenewalDate: nextStart,
  };
};

const organizationTimezone = async (repo: Repository, organizationId: string) =>
  String(
    (
      await repo.get<RecordItem>({
        PK: `ORG#${organizationId}`,
        SK: 'META',
      })
    )?.timezone ?? 'UTC',
  );

const validMembership = (value: unknown) => {
  const parsed = MembershipSchema.safeParse(value);
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
};

const validPeriod = (value: unknown) => {
  const parsed = MembershipPeriodSchema.safeParse(value);
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
};

export class MembershipService {
  constructor(
    private readonly persistence: Phase3Persistence,
    private readonly repo: Repository,
    private readonly entitlements: EntitlementService,
    private readonly activityEvents?: CommercialActivityEventService,
  ) {}

  private async recordEvent(
    eventType:
      | 'MEMBERSHIP_STARTED'
      | 'MEMBERSHIP_RENEWED'
      | 'MEMBERSHIP_PAUSED'
      | 'MEMBERSHIP_RESUMED'
      | 'MEMBERSHIP_CANCELLED'
      | 'MEMBERSHIP_EXPIRED',
    membership: Membership,
    occurredAt: string,
    dedupeKey?: string,
  ) {
    await this.activityEvents?.record({
      organizationId: membership.organizationId,
      customerId: membership.customerId,
      eventType,
      sourceType: 'MEMBERSHIP',
      sourceId: membership.membershipId,
      occurredAt,
      ...(dedupeKey ? { dedupeKey } : {}),
    });
  }

  private async issuePeriodEntitlements(
    membership: Membership,
    period: MembershipPeriod,
    createdBy: string,
  ) {
    for (const benefit of membership.benefitSnapshot) {
      const quantityType =
        'quantityType' in benefit ? benefit.quantityType : ('FINITE' as const);
      const quantity =
        'quantity' in benefit && typeof benefit.quantity === 'number'
          ? benefit.quantity
          : 1;
      const windowKey = benefitPeriodKey(benefit.period, period.startDate);
      await this.entitlements.issue({
        organizationId: membership.organizationId,
        customerId: membership.customerId,
        sourceType: 'MEMBERSHIP',
        sourceId: membership.membershipId,
        membershipPeriodId: period.membershipPeriodId,
        ...(benefit.benefitId ? { benefitId: benefit.benefitId } : {}),
        ...(windowKey ? { benefitPeriodKey: windowKey } : {}),
        unit: benefit.unit,
        quantityType,
        ...(quantityType === 'FINITE' ? { quantity } : {}),
        expiresAt: `${period.endDate}T23:59:59.999Z`,
        occurredAt: `${period.startDate}T00:00:00.000Z`,
        createdBy,
        createdAt: period.createdAt,
      });
    }
  }

  private async today(ctx: AuthContext) {
    return dayKeyInTimezone(
      new Date().toISOString(),
      await organizationTimezone(this.repo, ctx.organizationId),
    );
  }

  private async customerExists(ctx: AuthContext, customerId: string) {
    const customer = await this.repo.get<RecordItem>({
      PK: `ORG#${ctx.organizationId}`,
      SK: `CUSTOMER#${customerId}`,
    });
    if (!customer || customer.entity !== 'customer' || customer.archived)
      throw new AppError('NOT_FOUND', 'Customer was not found.');
  }

  private async expireIfNeeded(
    ctx: AuthContext,
    membership: Membership,
  ): Promise<Membership> {
    const today = await this.today(ctx);
    const evaluation = evaluateMembership(membership, { today });
    if (!evaluation.expired) return membership;

    if (
      membership.cancellationEffectiveDate &&
      membership.cancellationEffectiveDate <= today
    )
      return this.finalizeCancellation(ctx, membership);

    const timestamp = now();
    const currentPeriod = membership.currentPeriodId
      ? await this.persistence.getMembershipPeriod(
          ctx.organizationId,
          membership.currentPeriodId,
        )
      : undefined;
    const expired = validMembership({
      ...membership,
      status: 'EXPIRED',
      expiredAt: membership.expiredAt ?? timestamp,
      updatedAt: timestamp,
    });
    await this.persistence.putMembership(expired, membership);
    await this.recordEvent(
      'MEMBERSHIP_EXPIRED',
      expired,
      `${expired.currentPeriodEnd}T23:59:59.999Z`,
    );
    if (currentPeriod) {
      const expiredPeriod = validPeriod({
        ...currentPeriod,
        status: 'EXPIRED',
        completedAt: currentPeriod.completedAt ?? timestamp,
        updatedAt: timestamp,
      });
      await this.persistence.putMembershipPeriod(expiredPeriod, currentPeriod);
      await this.expirePeriodEntitlements(ctx, membership, currentPeriod);
    }
    return expired;
  }

  private async expirePeriodEntitlements(
    ctx: AuthContext,
    membership: Membership,
    period: MembershipPeriod,
  ) {
    const balances = await this.persistence.listCreditBalancesBySource(
      membership.organizationId,
      'MEMBERSHIP',
      membership.membershipId,
      100,
    );
    for (const balance of balances) {
      if (balance.membershipPeriodId !== period.membershipPeriodId) continue;
      await this.entitlements.expire({
        organizationId: membership.organizationId,
        customerId: membership.customerId,
        sourceType: 'MEMBERSHIP',
        sourceId: membership.membershipId,
        membershipPeriodId: period.membershipPeriodId,
        ...(balance.benefitId ? { benefitId: balance.benefitId } : {}),
        ...(balance.benefitPeriodKey
          ? { benefitPeriodKey: balance.benefitPeriodKey }
          : {}),
        createdBy: ctx.userId,
        reason: 'Membership period expired',
      });
    }
  }

  private async outstandingFor(membership: Membership) {
    if (!membership.currentPeriodId) return 0;
    const charge = await this.repo.get<RecordItem>({
      PK: `CHARGE#membership-${membership.currentPeriodId}`,
      SK: 'META',
    });
    const payments = await this.persistence.listCustomerPayments(
      membership.organizationId,
      membership.customerId,
      100,
    );
    return outstandingChargeAmount(
      charge
        ? {
            chargeId: String(charge.chargeId),
            amount: Number(charge.amount),
            status: charge.status === 'VOID' ? 'VOID' : 'ACTIVE',
          }
        : undefined,
      payments,
    );
  }

  async list(
    ctx: AuthContext,
    options: {
      status?: Membership['status'];
      planId?: string;
      customerId?: string;
      renewalFrom?: string;
      renewalTo?: string;
      renewalDue?: boolean;
      overdue?: boolean;
      expiringSoon?: boolean;
      windowDays?: number;
      limit?: number;
    } = {},
  ) {
    assertStaff(ctx);
    const limit = options.limit ?? 100;
    const today = await this.today(ctx);
    const windowDays = options.windowDays ?? 30;
    let memberships: Membership[];
    if (options.customerId) {
      memberships = await this.persistence.listMembershipsByCustomer(
        ctx.organizationId,
        options.customerId,
        { limit },
      );
    } else if (options.planId) {
      memberships = await this.persistence.listMembershipsByPlan(
        ctx.organizationId,
        options.planId,
        limit,
      );
    } else if (options.expiringSoon) {
      memberships = await this.persistence.listMembershipsExpiring(
        ctx.organizationId,
        today,
        addCommercialDays(today, windowDays),
        limit,
      );
    } else if (options.overdue) {
      memberships = await this.persistence.listMembershipsRenewing(
        ctx.organizationId,
        '0000-01-01',
        addCommercialDays(today, -1),
        limit,
      );
    } else if (options.renewalDue) {
      memberships = await this.persistence.listMembershipsRenewing(
        ctx.organizationId,
        today,
        addCommercialDays(today, windowDays),
        limit,
      );
    } else if (options.renewalFrom && options.renewalTo) {
      memberships = await this.persistence.listMembershipsRenewing(
        ctx.organizationId,
        options.renewalFrom,
        options.renewalTo,
        limit,
      );
    } else if (options.status === 'EXPIRED') {
      // An expired status may not have been materialized yet. Read the source
      // access path so read-time evaluation can still find it.
      memberships = await this.persistence.listMembershipsByOrganization(
        ctx.organizationId,
        limit,
      );
    } else if (options.status) {
      memberships = await this.persistence.listMembershipsByStatus(
        ctx.organizationId,
        options.status,
        limit,
      );
    } else {
      memberships = await this.persistence.listMembershipsByOrganization(
        ctx.organizationId,
        limit,
      );
    }
    const evaluated = await Promise.all(
      memberships.map(async (membership) => {
        const effective = await this.expireIfNeeded(ctx, membership);
        const evaluation = evaluateMembership(effective, {
          today,
          windowDays,
          ...(options.overdue
            ? { outstandingAmount: await this.outstandingFor(effective) }
            : {}),
        });
        return { membership: effective, evaluation };
      }),
    );
    return evaluated
      .filter(
        ({ membership, evaluation }) =>
          (!options.status || membership.status === options.status) &&
          (!options.renewalFrom ||
            (membership.nextRenewalDate ?? '') >= options.renewalFrom) &&
          (!options.renewalTo ||
            (membership.nextRenewalDate ?? '') <= options.renewalTo) &&
          (!options.renewalDue || evaluation.renewalDue) &&
          (!options.overdue || evaluation.overdue) &&
          (!options.expiringSoon || evaluation.expiringSoon),
      )
      .map(({ membership }) => membership)
      .filter(
        (membership) => !options.status || membership.status === options.status,
      )
      .filter(
        (membership) => !options.planId || membership.planId === options.planId,
      )
      .filter(
        (membership) =>
          !options.customerId || membership.customerId === options.customerId,
      )
      .slice(0, limit);
  }

  async get(ctx: AuthContext, id: string) {
    assertStaff(ctx);
    const membership = await this.persistence.getMembership(
      ctx.organizationId,
      id,
    );
    if (!membership)
      throw new AppError('NOT_FOUND', 'Membership was not found.');
    return this.expireIfNeeded(ctx, membership);
  }

  async periods(ctx: AuthContext, id: string) {
    assertStaff(ctx);
    const membership = await this.persistence.getMembership(
      ctx.organizationId,
      id,
    );
    if (!membership)
      throw new AppError('NOT_FOUND', 'Membership was not found.');
    return this.persistence.listMembershipPeriods(ctx.organizationId, id);
  }

  async create(ctx: AuthContext, input: unknown) {
    assertStaff(ctx);
    const parsed = MembershipInputSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    await this.customerExists(ctx, parsed.data.customerId);
    const plan = await this.persistence.getPlan(
      ctx.organizationId,
      parsed.data.planId,
    );
    if (!plan) throw new AppError('NOT_FOUND', 'Plan was not found.');
    if (plan.status !== 'ACTIVE')
      throw new AppError(
        'INVALID_STATE',
        'Only active plans can be assigned to a membership.',
      );
    const billingInterval = parsed.data.billingInterval ?? plan.billingInterval;
    const customIntervalDays =
      billingInterval === 'CUSTOM'
        ? (parsed.data.customIntervalDays ?? plan.customIntervalDays)
        : undefined;
    const dates = periodDates(
      parsed.data.startDate,
      billingInterval,
      customIntervalDays,
    );
    const timestamp = now();
    const id = membershipId();
    const currentPeriodId = periodId();
    const membership = validMembership({
      membershipId: id,
      organizationId: ctx.organizationId,
      customerId: parsed.data.customerId,
      planId: plan.planId,
      planNameSnapshot: plan.name,
      status: 'ACTIVE',
      startDate: parsed.data.startDate,
      currentPeriodStart: dates.startDate,
      currentPeriodEnd: dates.endDate,
      nextRenewalDate: dates.nextRenewalDate,
      currentPeriodId,
      price: parsed.data.price ?? plan.basePrice,
      currency: parsed.data.currency ?? plan.currency,
      billingInterval,
      ...(customIntervalDays === undefined ? {} : { customIntervalDays }),
      benefitSnapshot: structuredClone(plan.benefits),
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
    });
    const period = validPeriod({
      membershipPeriodId: currentPeriodId,
      organizationId: ctx.organizationId,
      membershipId: id,
      periodNumber: 1,
      startDate: dates.startDate,
      endDate: dates.endDate,
      status: 'ACTIVE',
      price: membership.price,
      currency: membership.currency,
      chargeId: `membership-${currentPeriodId}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await this.persistence.putMembership(membership);
    await this.persistence.putMembershipPeriod(period);
    await ensureMembershipPeriodCharge(
      this.repo,
      this.persistence,
      membership,
      period,
      ctx.userId,
    );
    await this.issuePeriodEntitlements(membership, period, ctx.userId);
    await this.recordEvent(
      'MEMBERSHIP_STARTED',
      membership,
      `${membership.startDate}T00:00:00.000Z`,
    );
    return membership;
  }

  async update(ctx: AuthContext, id: string, input: unknown) {
    assertStaff(ctx);
    const current = await this.get(ctx, id);
    if (['CANCELLED', 'EXPIRED'].includes(current.status))
      throw new AppError(
        'INVALID_STATE',
        'Historical memberships cannot have their commercial terms changed.',
      );
    const parsed = MembershipUpdateInputSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    const candidate: Record<string, unknown> = {
      ...current,
      ...parsed.data,
      updatedAt: now(),
    };
    if (parsed.data.billingInterval && parsed.data.billingInterval !== 'CUSTOM')
      delete candidate.customIntervalDays;
    const membership = validMembership(candidate);
    await this.persistence.putMembership(membership, current);
    return membership;
  }

  async pause(ctx: AuthContext, id: string) {
    assertStaff(ctx);
    const current = await this.get(ctx, id);
    if (current.status !== 'ACTIVE')
      throw new AppError(
        'INVALID_STATE',
        `Cannot pause a ${current.status.toLowerCase()} membership.`,
      );
    const membership = validMembership({
      ...current,
      status: 'PAUSED',
      pausedAt: current.pausedAt ?? now(),
      updatedAt: now(),
    });
    await this.persistence.putMembership(membership, current);
    await this.recordEvent(
      'MEMBERSHIP_PAUSED',
      membership,
      membership.updatedAt,
    );
    return membership;
  }

  async resume(ctx: AuthContext, id: string) {
    assertStaff(ctx);
    const current = await this.get(ctx, id);
    if (current.status !== 'PAUSED')
      throw new AppError(
        'INVALID_STATE',
        `Cannot resume a ${current.status.toLowerCase()} membership.`,
      );
    const membership = validMembership({
      ...current,
      status: 'ACTIVE',
      updatedAt: now(),
    });
    await this.persistence.putMembership(membership, current);
    await this.recordEvent(
      'MEMBERSHIP_RESUMED',
      membership,
      membership.updatedAt,
    );
    return membership;
  }

  async activate(ctx: AuthContext, id: string) {
    assertStaff(ctx);
    const current = await this.get(ctx, id);
    if (current.status === 'ACTIVE') return current;
    if (current.status !== 'DRAFT')
      throw new AppError(
        'INVALID_STATE',
        `Cannot activate a ${current.status.toLowerCase()} membership.`,
      );
    const membership = validMembership({
      ...current,
      status: 'ACTIVE',
      updatedAt: now(),
    });
    await this.persistence.putMembership(membership, current);
    if (current.currentPeriodId) {
      const period = await this.persistence.getMembershipPeriod(
        ctx.organizationId,
        current.currentPeriodId,
      );
      if (period && period.status === 'UPCOMING') {
        const activePeriod = validPeriod({
          ...period,
          status: 'ACTIVE',
          updatedAt: membership.updatedAt,
        });
        await this.persistence.putMembershipPeriod(activePeriod, period);
      }
    }
    await this.recordEvent(
      'MEMBERSHIP_STARTED',
      membership,
      membership.updatedAt,
    );
    return membership;
  }

  private async finalizeCancellation(
    ctx: AuthContext,
    current: Membership,
    previous: Membership = current,
  ) {
    const timestamp = now();
    const membership = validMembership({
      ...current,
      status: 'CANCELLED',
      cancelledAt: current.cancelledAt ?? timestamp,
      cancelledBy: current.cancelledBy,
      updatedAt: timestamp,
    });
    await this.persistence.putMembership(membership, previous);
    if (current.currentPeriodId) {
      const period = await this.persistence.getMembershipPeriod(
        ctx.organizationId,
        current.currentPeriodId,
      );
      if (period) {
        const cancelledPeriod = validPeriod({
          ...period,
          status: 'CANCELLED',
          completedAt: period.completedAt ?? timestamp,
          updatedAt: timestamp,
        });
        await this.persistence.putMembershipPeriod(cancelledPeriod, period);
      }
    }
    await this.recordEvent(
      'MEMBERSHIP_CANCELLED',
      membership,
      membership.cancelledAt ?? timestamp,
    );
    return membership;
  }

  async cancel(ctx: AuthContext, id: string, input: unknown) {
    assertStaff(ctx);
    const current = await this.get(ctx, id);
    if (current.status === 'CANCELLED') return current;
    if (current.status === 'EXPIRED')
      throw new AppError(
        'INVALID_STATE',
        'Expired memberships cannot be cancelled.',
      );
    const parsed = MembershipCancelInputSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    const today = await this.today(ctx);
    const effectiveDate = parsed.data.effectiveDate ?? today;
    dateValue(effectiveDate);
    if (effectiveDate < current.currentPeriodStart)
      throw new AppError(
        'VALIDATION_ERROR',
        'Cancellation effective date is before the current period.',
      );
    if (effectiveDate > current.currentPeriodEnd)
      throw new AppError(
        'VALIDATION_ERROR',
        'Cancellation must take effect by the end of the current period.',
      );
    const candidate = validMembership({
      ...current,
      cancellationEffectiveDate: effectiveDate,
      cancellationReason: parsed.data.reason ?? current.cancellationReason,
      cancelledBy: ctx.userId,
      updatedAt: now(),
    });
    if (effectiveDate > today) {
      await this.persistence.putMembership(candidate, current);
      return candidate;
    }
    return this.finalizeCancellation(ctx, candidate, current);
  }

  async renew(ctx: AuthContext, id: string, input: unknown = {}) {
    assertStaff(ctx);
    const current = await this.get(ctx, id);
    if (current.status !== 'ACTIVE')
      throw new AppError(
        'INVALID_STATE',
        `Cannot renew a ${current.status.toLowerCase()} membership.`,
      );
    if (current.cancellationEffectiveDate)
      throw new AppError(
        'INVALID_STATE',
        'A membership scheduled for cancellation must be resumed before renewal.',
      );
    const parsed = MembershipRenewInputSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    if (!current.currentPeriodId)
      throw new AppError('CONFLICT', 'Membership has no current period.');
    const previousPeriod = await this.persistence.getMembershipPeriod(
      ctx.organizationId,
      current.currentPeriodId,
    );
    if (!previousPeriod)
      throw new AppError(
        'CONFLICT',
        'Membership current period was not found.',
      );
    const operationKey = parsed.data.idempotencyKey;
    if (operationKey && previousPeriod.renewalIdempotencyKey === operationKey) {
      if (
        parsed.data.price !== undefined &&
        parsed.data.price !== current.price
      )
        throw new AppError(
          'CONFLICT',
          'The renewal idempotency key was already used with another price.',
        );
      return current;
    }
    const dates = periodDates(
      addCalendarDays(current.currentPeriodEnd, 1),
      current.billingInterval,
      current.customIntervalDays,
    );
    const timestamp = now();
    const nextPeriodId = renewalPeriodId(
      current.membershipId,
      previousPeriod.membershipPeriodId,
      operationKey,
    );
    const nextPeriod = validPeriod({
      membershipPeriodId: nextPeriodId,
      organizationId: current.organizationId,
      membershipId: current.membershipId,
      periodNumber: previousPeriod.periodNumber + 1,
      startDate: dates.startDate,
      endDate: dates.endDate,
      status: 'ACTIVE',
      price: parsed.data.price ?? current.price,
      currency: current.currency,
      chargeId: `membership-${nextPeriodId}`,
      ...(operationKey ? { renewalIdempotencyKey: operationKey } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const completedPrevious = validPeriod({
      ...previousPeriod,
      status: 'COMPLETED',
      completedAt: previousPeriod.completedAt ?? timestamp,
      updatedAt: timestamp,
    });
    const renewed = validMembership({
      ...current,
      currentPeriodStart: dates.startDate,
      currentPeriodEnd: dates.endDate,
      nextRenewalDate: dates.nextRenewalDate,
      currentPeriodId: nextPeriod.membershipPeriodId,
      ...(parsed.data.price === undefined ? {} : { price: parsed.data.price }),
      updatedAt: timestamp,
    });
    try {
      await this.persistence.advanceMembership({
        membership: renewed,
        previousMembership: current,
        completedPreviousPeriod: completedPrevious,
        previousPeriod,
        nextPeriod,
      });
    } catch (error) {
      if (operationKey) {
        const retry = await this.persistence.getMembership(
          ctx.organizationId,
          id,
        );
        const retryPeriod = retry?.currentPeriodId
          ? await this.persistence.getMembershipPeriod(
              ctx.organizationId,
              retry.currentPeriodId,
            )
          : undefined;
        if (
          retry &&
          retryPeriod?.renewalIdempotencyKey === operationKey &&
          (parsed.data.price === undefined || parsed.data.price === retry.price)
        )
          return retry;
      }
      throw error;
    }
    await ensureMembershipPeriodCharge(
      this.repo,
      this.persistence,
      renewed,
      nextPeriod,
      ctx.userId,
    );
    await this.issuePeriodEntitlements(renewed, nextPeriod, ctx.userId);
    await this.recordEvent(
      'MEMBERSHIP_RENEWED',
      renewed,
      `${nextPeriod.startDate}T00:00:00.000Z`,
      nextPeriod.membershipPeriodId,
    );
    return renewed;
  }

  async expire(ctx: AuthContext, id: string) {
    assertStaff(ctx);
    const current = await this.get(ctx, id);
    if (current.status === 'EXPIRED') return current;
    if (current.currentPeriodEnd >= (await this.today(ctx)))
      throw new AppError('INVALID_STATE', 'Membership period has not ended.');
    if (current.cancellationEffectiveDate)
      return this.finalizeCancellation(ctx, current);
    return this.expireIfNeeded(ctx, current);
  }
}
