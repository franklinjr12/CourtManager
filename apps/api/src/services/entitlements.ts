import { createHash } from 'node:crypto';
import {
  CreditTransactionSchema,
  type AuthContext,
  type Customer,
  type EntitlementAllocation,
  type PlanBenefit,
} from '@court-manager/contracts';
import { AppError } from '../errors.js';
import type {
  CreditBalanceInput,
  CreditBalanceRecord,
  LedgerTransaction,
  Phase3Persistence,
} from '../persistence/phase3-repository.js';
import type { CommercialActivityEventService } from './commercial-activity-events.js';

export type EntitlementSourceType =
  'MEMBERSHIP' | 'PACKAGE' | 'MANUAL' | 'FIXED_AGREEMENT' | 'MAKEUP';
export type EntitlementUnit =
  'COURT_MINUTES' | 'SESSION' | 'GAME' | 'OCCURRENCE';
export type EntitlementActivityType =
  | 'RESERVATION'
  | 'CLASS_ATTENDANCE'
  | 'PRIVATE_LESSON'
  | 'OPEN_GAME'
  | 'FIXED_COURT_OCCURRENCE';

export type EntitlementCustomer = Pick<
  Customer,
  'organizationId' | 'customerId'
>;

export type EntitlementActivity = {
  activityType: EntitlementActivityType;
  activityId?: string;
  quantity: number;
  unit: EntitlementUnit;
  occurredAt: string;
  venueDate?: string;
  classId?: string;
  classType?: 'GROUP' | 'PRIVATE';
  sportId?: string;
  coveredAmount?: number;
  currency?: string;
};

export type AvailableEntitlement = {
  sourceType: EntitlementSourceType;
  sourceId: string;
  membershipPeriodId?: string;
  benefitId?: string;
  benefitPeriodKey?: string;
  benefit: PlanBenefit;
  unit: EntitlementUnit;
  quantityType: 'FINITE' | 'UNLIMITED';
  availableQuantity: number | null;
  expiresAt?: string;
};

export type EntitlementCoverage = {
  sourceType: EntitlementSourceType;
  sourceId: string;
  membershipPeriodId?: string;
  benefitId?: string;
  benefitPeriodKey?: string;
  quantity: number;
  unit: EntitlementUnit;
  coveredAmount: number;
  currency?: string;
};

export type IssueCreditInput = {
  organizationId: string;
  customerId: string;
  sourceType: EntitlementSourceType;
  sourceId: string;
  membershipPeriodId?: string;
  benefitId?: string;
  benefitPeriodKey?: string;
  unit: EntitlementUnit;
  quantityType: 'FINITE' | 'UNLIMITED';
  quantity?: number;
  expiresAt?: string;
  occurredAt?: string;
  createdBy: string;
  reason?: string;
  createdAt?: string;
};

export type DirectConsumeInput = {
  organizationId: string;
  customerId: string;
  sourceType: EntitlementSourceType;
  sourceId: string;
  membershipPeriodId?: string;
  benefitId?: string;
  benefitPeriodKey?: string;
  activityType: EntitlementActivityType;
  activityId: string;
  unit: EntitlementUnit;
  quantity: number;
  coveredAmount: number;
  currency: string;
  createdBy: string;
  occurredAt: string;
  createdAt?: string;
  allocationId?: string;
};

export type ConsumeInput =
  | DirectConsumeInput
  | {
      customer: EntitlementCustomer;
      activity: EntitlementActivity & { activityId: string };
      entitlement?: AvailableEntitlement;
      createdBy: string;
      coveredAmount: number;
      currency: string;
      createdAt?: string;
    };

export type RestoreInput = {
  organizationId: string;
  allocationId: string;
  createdBy: string;
  quantity?: number;
  reason?: string;
  occurredAt?: string;
  createdAt?: string;
  restorationId?: string;
};

export type AdjustInput = {
  organizationId: string;
  customerId: string;
  sourceType: EntitlementSourceType;
  sourceId: string;
  membershipPeriodId?: string;
  benefitId?: string;
  benefitPeriodKey?: string;
  unit: EntitlementUnit;
  quantity: number;
  createdBy: string;
  reason: string;
  occurredAt?: string;
  createdAt?: string;
};

export type CreditAdjustmentInput = Omit<
  AdjustInput,
  'organizationId' | 'createdBy'
>;

const now = () => new Date().toISOString();

const assertCommercialActor = (ctx: AuthContext) => {
  if (!['OWNER', 'STAFF'].includes(ctx.role))
    throw new AppError(
      'FORBIDDEN',
      'You do not have permission for this operation.',
    );
};

const stableId = (prefix: string, value: string) =>
  `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 48)}`;

const isDirectConsume = (input: ConsumeInput): input is DirectConsumeInput =>
  'sourceType' in input;

const assertPositiveInteger = (value: number, label: string) => {
  if (!Number.isInteger(value) || value <= 0)
    throw new AppError(
      'VALIDATION_ERROR',
      `${label} must be a positive integer.`,
    );
};

const benefitMatches = (
  benefit: PlanBenefit,
  activity: Pick<
    EntitlementActivity,
    'activityType' | 'unit' | 'classId' | 'classType' | 'sportId'
  >,
) => {
  if (benefit.unit !== activity.unit) return false;
  if (benefit.type === 'COURT_TIME')
    return activity.activityType === 'RESERVATION';
  if (
    benefit.type === 'CLASS_ATTENDANCE' ||
    benefit.type === 'PRIVATE_LESSON'
  ) {
    const expectedActivityType =
      benefit.type === 'PRIVATE_LESSON' ? 'PRIVATE_LESSON' : 'CLASS_ATTENDANCE';
    if (activity.activityType !== expectedActivityType) return false;
    if (benefit.classType && benefit.classType !== activity.classType)
      return false;
    if (benefit.classId && benefit.classId !== activity.classId) return false;
    if (benefit.sportId && benefit.sportId !== activity.sportId) return false;
    return true;
  }
  if (benefit.type === 'OPEN_GAME')
    return activity.activityType === 'OPEN_GAME';
  return activity.activityType === 'FIXED_COURT_OCCURRENCE';
};

/** Benefit windows use venue-local dates and ISO weeks (Monday through Sunday). */
export const benefitPeriodKey = (
  period: PlanBenefit['period'],
  venueDate: string,
) => {
  if (period === 'WEEK') {
    const date = new Date(`${venueDate}T12:00:00.000Z`);
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - day + 1);
    return `WEEK:${date.toISOString().slice(0, 10)}`;
  }
  if (period === 'MONTH') return `MONTH:${venueDate.slice(0, 7)}`;
  return undefined;
};

const benefitQuantityType = (benefit: PlanBenefit) =>
  'quantityType' in benefit ? benefit.quantityType : ('FINITE' as const);

const makeupBenefit: PlanBenefit = {
  benefitId: 'makeup-attendance',
  type: 'CLASS_ATTENDANCE',
  unit: 'SESSION',
  period: 'PACKAGE_LIFETIME',
  quantityType: 'FINITE',
  quantity: 1,
  label: 'Class makeup credit',
};

const activeAt = (
  startsAt: string,
  expiresAt: string | undefined,
  at: string,
) =>
  Date.parse(startsAt) <= Date.parse(at) &&
  (expiresAt === undefined || Date.parse(at) < Date.parse(expiresAt));

const balanceWithDelta = (
  balance: CreditBalanceRecord,
  transaction: LedgerTransaction,
  createdAt: string,
): CreditBalanceInput => {
  const quantity = Math.abs(transaction.quantity);
  const next = {
    ...balance,
    remainingQuantity:
      balance.quantityType === 'UNLIMITED'
        ? 0
        : balance.remainingQuantity + transaction.quantity,
    issuedQuantity:
      transaction.transactionType === 'ISSUED'
        ? balance.issuedQuantity + quantity
        : balance.issuedQuantity,
    consumedQuantity:
      transaction.transactionType === 'CONSUMED'
        ? balance.consumedQuantity + quantity
        : balance.consumedQuantity,
    restoredQuantity:
      transaction.transactionType === 'RESTORED'
        ? balance.restoredQuantity + quantity
        : balance.restoredQuantity,
    expiredQuantity:
      transaction.transactionType === 'EXPIRED'
        ? balance.expiredQuantity + quantity
        : balance.expiredQuantity,
    adjustedQuantity:
      transaction.transactionType === 'ADJUSTED'
        ? (balance.adjustedQuantity ?? 0) + transaction.quantity
        : (balance.adjustedQuantity ?? 0),
    updatedAt: createdAt,
  };
  if (next.quantityType === 'FINITE' && next.remainingQuantity < 0)
    throw new AppError(
      'CONFLICT',
      'The entitlement does not have enough remaining credit.',
    );
  return next;
};

export class EntitlementService {
  constructor(
    private readonly persistence: Phase3Persistence,
    private readonly activityEvents?: CommercialActivityEventService,
  ) {}

  private async recordCreditEvent(
    eventType: 'CREDIT_ISSUED' | 'CREDIT_CONSUMED' | 'CREDIT_RESTORED',
    input: {
      organizationId: string;
      customerId: string;
      sourceType: EntitlementSourceType;
      sourceId: string;
      occurredAt: string;
      dedupeKey: string;
    },
  ) {
    await this.activityEvents?.record({ ...input, eventType });
  }

  async getRemainingBalance(input: {
    organizationId: string;
    customerId?: string;
    sourceType: EntitlementSourceType;
    sourceId: string;
    membershipPeriodId?: string;
    benefitId?: string;
    benefitPeriodKey?: string;
  }) {
    const balance = await this.persistence.getCreditBalance(input);
    const transactions = await this.persistence.listCreditTransactionsBySource(
      input.organizationId,
      input.sourceType,
      input.sourceId,
    );
    const matchingTransactions = transactions.filter(
      (transaction) =>
        transaction.membershipPeriodId === input.membershipPeriodId &&
        transaction.benefitId === input.benefitId &&
        transaction.benefitPeriodKey === input.benefitPeriodKey,
    );
    if (!balance && !matchingTransactions.length) return undefined;
    if (!balance)
      throw new AppError('CONFLICT', 'Credit balance is incomplete.');
    if (balance.quantityType === 'FINITE' && balance.remainingQuantity < 0)
      throw new AppError(
        'CONFLICT',
        'The entitlement ledger contains a negative finite balance.',
      );
    const relevant = matchingTransactions;
    const remaining = relevant.reduce(
      (total, transaction) => total + transaction.quantity,
      0,
    );
    if (balance.quantityType === 'FINITE' && remaining < 0)
      throw new AppError(
        'CONFLICT',
        'The entitlement ledger contains a negative finite balance.',
      );
    const issuedQuantity = relevant
      .filter((transaction) => transaction.transactionType === 'ISSUED')
      .reduce(
        (total, transaction) => total + Math.abs(transaction.quantity),
        0,
      );
    const consumedQuantity = relevant
      .filter((transaction) => transaction.transactionType === 'CONSUMED')
      .reduce(
        (total, transaction) => total + Math.abs(transaction.quantity),
        0,
      );
    const restoredQuantity = relevant
      .filter((transaction) => transaction.transactionType === 'RESTORED')
      .reduce(
        (total, transaction) => total + Math.abs(transaction.quantity),
        0,
      );
    const expiredQuantity = relevant
      .filter((transaction) => transaction.transactionType === 'EXPIRED')
      .reduce(
        (total, transaction) => total + Math.abs(transaction.quantity),
        0,
      );
    const adjustedQuantity = relevant
      .filter((transaction) => transaction.transactionType === 'ADJUSTED')
      .reduce((total, transaction) => total + transaction.quantity, 0);
    return {
      ...balance,
      issuedQuantity,
      consumedQuantity,
      restoredQuantity,
      expiredQuantity,
      adjustedQuantity,
      remainingQuantity: balance.quantityType === 'UNLIMITED' ? 0 : remaining,
    };
  }

  async getAvailableEntitlements(
    customer: EntitlementCustomer,
    activity: EntitlementActivity,
  ): Promise<AvailableEntitlement[]> {
    assertPositiveInteger(activity.quantity, 'Activity quantity');
    const result: AvailableEntitlement[] = [];
    const makeupCredits = await this.persistence.listMakeupCreditsByCustomer(
      customer.organizationId,
      customer.customerId,
      { activeOnly: true },
    );
    for (const makeupCredit of makeupCredits) {
      if (
        !activeAt(
          makeupCredit.issuedAt,
          makeupCredit.expiresAt,
          activity.occurredAt,
        )
      )
        continue;
      if (activity.activityType !== 'CLASS_ATTENDANCE') continue;
      const balance = await this.getRemainingBalance({
        organizationId: customer.organizationId,
        customerId: customer.customerId,
        sourceType: 'MAKEUP',
        sourceId: makeupCredit.makeupCreditId,
        ...(makeupBenefit.benefitId
          ? { benefitId: makeupBenefit.benefitId }
          : {}),
      });
      if (!balance || balance.remainingQuantity <= 0) continue;
      result.push({
        sourceType: 'MAKEUP',
        sourceId: makeupCredit.makeupCreditId,
        ...(makeupBenefit.benefitId
          ? { benefitId: makeupBenefit.benefitId }
          : {}),
        benefit: makeupBenefit,
        unit: 'SESSION',
        quantityType: 'FINITE',
        availableQuantity: balance.remainingQuantity,
        ...(makeupCredit.expiresAt
          ? { expiresAt: makeupCredit.expiresAt }
          : {}),
      });
    }
    const packages = await this.persistence.listPackagesByCustomer(
      customer.organizationId,
      customer.customerId,
      { activeOnly: true },
    );
    for (const customerPackage of packages) {
      if (
        !activeAt(
          customerPackage.startsAt,
          customerPackage.expiresAt,
          activity.occurredAt,
        )
      )
        continue;
      for (const benefit of customerPackage.benefitSnapshot) {
        if (!benefitMatches(benefit, activity)) continue;
        const periodKey = benefitPeriodKey(
          benefit.period,
          activity.venueDate ?? activity.occurredAt.slice(0, 10),
        );
        const balance = await this.getRemainingBalance({
          organizationId: customer.organizationId,
          customerId: customer.customerId,
          sourceType: 'PACKAGE',
          sourceId: customerPackage.customerPackageId,
          ...(benefit.benefitId ? { benefitId: benefit.benefitId } : {}),
          ...(periodKey ? { benefitPeriodKey: periodKey } : {}),
        });
        if (!balance) continue;
        const quantityType = benefitQuantityType(benefit);
        if (quantityType === 'FINITE' && balance.remainingQuantity <= 0)
          continue;
        result.push({
          sourceType: 'PACKAGE',
          sourceId: customerPackage.customerPackageId,
          ...(benefit.benefitId ? { benefitId: benefit.benefitId } : {}),
          ...(periodKey ? { benefitPeriodKey: periodKey } : {}),
          benefit,
          unit: benefit.unit,
          quantityType,
          availableQuantity:
            quantityType === 'UNLIMITED' ? null : balance.remainingQuantity,
          ...(customerPackage.expiresAt
            ? { expiresAt: customerPackage.expiresAt }
            : {}),
        });
      }
    }

    const memberships = await this.persistence.listMembershipsByCustomer(
      customer.organizationId,
      customer.customerId,
      { activeOnly: true },
    );
    for (const membership of memberships) {
      const activityDate =
        activity.venueDate ?? activity.occurredAt.slice(0, 10);
      if (
        membership.status !== 'ACTIVE' ||
        activityDate < membership.currentPeriodStart ||
        activityDate > membership.currentPeriodEnd ||
        !membership.currentPeriodId
      )
        continue;
      const period = await this.persistence.getMembershipPeriod(
        customer.organizationId,
        membership.currentPeriodId,
      );
      if (!period || period.status !== 'ACTIVE') continue;
      for (const benefit of membership.benefitSnapshot) {
        if (!benefitMatches(benefit, activity)) continue;
        const periodKey = benefitPeriodKey(benefit.period, activityDate);
        const balance = await this.getRemainingBalance({
          organizationId: customer.organizationId,
          customerId: customer.customerId,
          sourceType: 'MEMBERSHIP',
          sourceId: membership.membershipId,
          membershipPeriodId: membership.currentPeriodId,
          ...(benefit.benefitId ? { benefitId: benefit.benefitId } : {}),
          ...(periodKey ? { benefitPeriodKey: periodKey } : {}),
        });
        if (!balance && periodKey) {
          const issuedQuantity =
            'quantity' in benefit && typeof benefit.quantity === 'number'
              ? benefit.quantity
              : 1;
          await this.issue({
            organizationId: customer.organizationId,
            customerId: customer.customerId,
            sourceType: 'MEMBERSHIP',
            sourceId: membership.membershipId,
            membershipPeriodId: membership.currentPeriodId,
            ...(benefit.benefitId ? { benefitId: benefit.benefitId } : {}),
            benefitPeriodKey: periodKey,
            unit: benefit.unit,
            quantityType: benefitQuantityType(benefit),
            ...(benefitQuantityType(benefit) === 'FINITE'
              ? { quantity: issuedQuantity }
              : {}),
            expiresAt: `${period.endDate}T23:59:59.999Z`,
            occurredAt: activity.occurredAt,
            createdBy: 'system',
          });
        }
        const availableBalance =
          balance ??
          (periodKey
            ? await this.getRemainingBalance({
                organizationId: customer.organizationId,
                customerId: customer.customerId,
                sourceType: 'MEMBERSHIP',
                sourceId: membership.membershipId,
                membershipPeriodId: membership.currentPeriodId,
                ...(benefit.benefitId ? { benefitId: benefit.benefitId } : {}),
                benefitPeriodKey: periodKey,
              })
            : undefined);
        if (!availableBalance) continue;
        const quantityType = benefitQuantityType(benefit);
        if (
          quantityType === 'FINITE' &&
          availableBalance.remainingQuantity <= 0
        )
          continue;
        result.push({
          sourceType: 'MEMBERSHIP',
          sourceId: membership.membershipId,
          membershipPeriodId: membership.currentPeriodId,
          ...(benefit.benefitId ? { benefitId: benefit.benefitId } : {}),
          ...(periodKey ? { benefitPeriodKey: periodKey } : {}),
          benefit,
          unit: benefit.unit,
          quantityType,
          availableQuantity:
            quantityType === 'UNLIMITED'
              ? null
              : availableBalance.remainingQuantity,
          expiresAt: `${membership.currentPeriodEnd}T23:59:59.999Z`,
        });
      }
    }
    return result.sort((a, b) => {
      const sourcePriority = (source: EntitlementSourceType) =>
        source === 'MAKEUP'
          ? 0
          : source === 'MEMBERSHIP'
            ? 1
            : source === 'PACKAGE'
              ? 2
              : 3;
      return (
        (a.expiresAt ?? '9999-12-31').localeCompare(
          b.expiresAt ?? '9999-12-31',
        ) ||
        sourcePriority(a.sourceType) - sourcePriority(b.sourceType) ||
        a.sourceId.localeCompare(b.sourceId) ||
        (a.benefitId ?? '').localeCompare(b.benefitId ?? '')
      );
    });
  }

  calculateCoverage(
    activity: EntitlementActivity,
    entitlement: AvailableEntitlement,
  ): EntitlementCoverage | undefined {
    if (!benefitMatches(entitlement.benefit, activity)) return undefined;
    if (
      entitlement.quantityType === 'FINITE' &&
      (entitlement.availableQuantity ?? 0) <= 0
    )
      return undefined;
    const quantity =
      entitlement.quantityType === 'UNLIMITED'
        ? activity.quantity
        : Math.min(activity.quantity, entitlement.availableQuantity ?? 0);
    return {
      sourceType: entitlement.sourceType,
      sourceId: entitlement.sourceId,
      ...(entitlement.membershipPeriodId
        ? { membershipPeriodId: entitlement.membershipPeriodId }
        : {}),
      ...(entitlement.benefitId ? { benefitId: entitlement.benefitId } : {}),
      ...(entitlement.benefitPeriodKey
        ? { benefitPeriodKey: entitlement.benefitPeriodKey }
        : {}),
      quantity,
      unit: activity.unit,
      coveredAmount: activity.coveredAmount ?? 0,
      ...(activity.currency ? { currency: activity.currency } : {}),
    };
  }

  async ensureUnlimitedSource(input: {
    organizationId: string;
    customerId: string;
    sourceType: EntitlementSourceType;
    sourceId: string;
    benefitId?: string;
    unit: EntitlementUnit;
    createdBy: string;
    occurredAt: string;
    createdAt?: string;
  }) {
    const existing = await this.persistence.getCreditBalance(input);
    if (existing) return existing;
    try {
      await this.issue({
        ...input,
        quantityType: 'UNLIMITED',
      });
    } catch (error) {
      const concurrent = await this.persistence.getCreditBalance(input);
      if (!concurrent) throw error;
    }
    return this.persistence.getCreditBalance(input);
  }

  async consume(input: ConsumeInput) {
    const direct = isDirectConsume(input);
    const normalized: DirectConsumeInput = direct
      ? { ...input, createdAt: input.createdAt ?? now() }
      : (() => {
          assertPositiveInteger(input.activity.quantity, 'Activity quantity');
          const entitlement = input.entitlement ?? undefined;
          if (!entitlement)
            throw new AppError(
              'VALIDATION_ERROR',
              'An entitlement must be selected before consumption.',
            );
          const coverage = this.calculateCoverage(input.activity, entitlement);
          if (!coverage)
            throw new AppError(
              'CONFLICT',
              'The entitlement cannot cover this activity.',
            );
          return {
            organizationId: input.customer.organizationId,
            customerId: input.customer.customerId,
            sourceType: coverage.sourceType,
            sourceId: coverage.sourceId,
            ...(coverage.membershipPeriodId
              ? { membershipPeriodId: coverage.membershipPeriodId }
              : {}),
            ...(coverage.benefitId ? { benefitId: coverage.benefitId } : {}),
            ...(coverage.benefitPeriodKey
              ? { benefitPeriodKey: coverage.benefitPeriodKey }
              : {}),
            activityType: input.activity.activityType,
            activityId: input.activity.activityId,
            unit: coverage.unit,
            quantity: coverage.quantity,
            coveredAmount: input.coveredAmount,
            currency: input.currency,
            createdBy: input.createdBy,
            occurredAt: input.activity.occurredAt,
            createdAt: input.createdAt ?? now(),
          };
        })();
    assertPositiveInteger(normalized.quantity, 'Consumption quantity');
    const result = await this.persistence.consumeEntitlement({
      ...normalized,
      createdAt: normalized.createdAt ?? now(),
      ...(normalized.membershipPeriodId
        ? { membershipPeriodId: normalized.membershipPeriodId }
        : {}),
      ...(normalized.benefitId ? { benefitId: normalized.benefitId } : {}),
    });
    await this.recordCreditEvent('CREDIT_CONSUMED', {
      organizationId: normalized.organizationId,
      customerId: normalized.customerId,
      sourceType: normalized.sourceType,
      sourceId: normalized.sourceId,
      occurredAt: normalized.occurredAt,
      dedupeKey: result.allocation.allocationId,
    });
    if (normalized.sourceType === 'PACKAGE')
      await this.activityEvents?.record({
        organizationId: normalized.organizationId,
        customerId: normalized.customerId,
        eventType: 'PACKAGE_CONSUMED',
        sourceType: 'PACKAGE',
        sourceId: normalized.sourceId,
        occurredAt: normalized.occurredAt,
        dedupeKey: result.allocation.allocationId,
      });
    if (normalized.sourceType === 'MAKEUP') {
      const consumedAt = normalized.createdAt ?? now();
      const credit = await this.persistence.getMakeupCredit(
        normalized.organizationId,
        normalized.sourceId,
      );
      if (credit && credit.status === 'ACTIVE') {
        const updated = {
          ...credit,
          // A duplicate means the durable usage guard already recorded this
          // attendance.  Reconcile the denormalized makeup status as well so
          // a retry after a partial failure cannot leave the credit looking
          // active forever.
          status: 'CONSUMED' as const,
          consumedAt: credit.consumedAt ?? consumedAt,
          updatedAt: consumedAt,
        };
        await this.persistence.putMakeupCredit(updated, credit);
      }
    }
    return result;
  }

  async issue(input: IssueCreditInput) {
    const createdAt = input.createdAt ?? now();
    const quantity =
      input.quantityType === 'FINITE' ? (input.quantity ?? 0) : 1;
    if (input.quantityType === 'FINITE')
      assertPositiveInteger(quantity, 'Issued quantity');
    const sourceRef = {
      organizationId: input.organizationId,
      customerId: input.customerId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      ...(input.membershipPeriodId
        ? { membershipPeriodId: input.membershipPeriodId }
        : {}),
      ...(input.benefitId ? { benefitId: input.benefitId } : {}),
      ...(input.benefitPeriodKey
        ? { benefitPeriodKey: input.benefitPeriodKey }
        : {}),
    };
    const existing = await this.persistence.getCreditBalance(sourceRef);
    if (existing) {
      const requestedQuantity =
        input.quantityType === 'FINITE' ? quantity : undefined;
      if (
        existing.customerId !== input.customerId ||
        existing.unit !== input.unit ||
        existing.quantityType !== input.quantityType ||
        (requestedQuantity !== undefined &&
          existing.issuedQuantity !== requestedQuantity) ||
        existing.expiresAt !== input.expiresAt
      )
        throw new AppError(
          'CONFLICT',
          'The entitlement source already has different credit terms.',
        );
      await this.recordCreditEvent('CREDIT_ISSUED', {
        organizationId: input.organizationId,
        customerId: input.customerId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        occurredAt: input.occurredAt ?? createdAt,
        dedupeKey: `credit-issued|${input.membershipPeriodId ?? '-'}|${input.benefitId ?? '-'}|${input.benefitPeriodKey ?? '-'}`,
      });
      return this.getRemainingBalance({ ...input });
    }
    const transaction = CreditTransactionSchema.parse({
      creditTransactionId: stableId(
        'credit-issued',
        `${input.sourceType}|${input.sourceId}|${input.membershipPeriodId ?? '-'}|${input.benefitId ?? '-'}|${input.benefitPeriodKey ?? '-'}`,
      ),
      organizationId: input.organizationId,
      customerId: input.customerId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      ...(input.membershipPeriodId
        ? { membershipPeriodId: input.membershipPeriodId }
        : {}),
      ...(input.benefitId ? { benefitId: input.benefitId } : {}),
      ...(input.benefitPeriodKey
        ? { benefitPeriodKey: input.benefitPeriodKey }
        : {}),
      transactionType: 'ISSUED',
      unit: input.unit,
      quantity,
      ...(input.reason ? { reason: input.reason } : {}),
      occurredAt: input.occurredAt ?? createdAt,
      createdBy: input.createdBy,
      createdAt,
    }) as LedgerTransaction;
    const balance: CreditBalanceInput = {
      organizationId: input.organizationId,
      customerId: input.customerId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      ...(input.membershipPeriodId
        ? { membershipPeriodId: input.membershipPeriodId }
        : {}),
      ...(input.benefitId ? { benefitId: input.benefitId } : {}),
      ...(input.benefitPeriodKey
        ? { benefitPeriodKey: input.benefitPeriodKey }
        : {}),
      unit: input.unit,
      quantityType: input.quantityType,
      issuedQuantity: input.quantityType === 'FINITE' ? quantity : 0,
      consumedQuantity: 0,
      restoredQuantity: 0,
      expiredQuantity: 0,
      adjustedQuantity: 0,
      remainingQuantity: input.quantityType === 'FINITE' ? quantity : 0,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      updatedAt: createdAt,
    };
    const result = await this.persistence.appendCreditTransaction({
      transaction,
      balance,
    });
    await this.recordCreditEvent('CREDIT_ISSUED', {
      organizationId: input.organizationId,
      customerId: input.customerId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      occurredAt: transaction.occurredAt,
      dedupeKey: transaction.creditTransactionId,
    });
    return result;
  }

  async adjust(ctx: AuthContext, input: CreditAdjustmentInput) {
    assertCommercialActor(ctx);
    return this.adjustLedger({
      ...input,
      organizationId: ctx.organizationId,
      createdBy: ctx.userId,
    });
  }

  private async adjustLedger(input: AdjustInput) {
    if (!input.reason.trim())
      throw new AppError(
        'VALIDATION_ERROR',
        'Credit adjustments require a reason.',
      );
    if (!Number.isInteger(input.quantity) || input.quantity === 0)
      throw new AppError(
        'VALIDATION_ERROR',
        'Adjustment quantity cannot be zero.',
      );
    const previous = await this.persistence.getCreditBalance(input);
    if (!previous)
      throw new AppError('NOT_FOUND', 'Entitlement balance was not found.');
    const createdAt = input.createdAt ?? now();
    const transaction = CreditTransactionSchema.parse({
      creditTransactionId: stableId(
        'credit-adjustment',
        `${input.sourceType}|${input.sourceId}|${input.membershipPeriodId ?? '-'}|${input.benefitId ?? '-'}|${input.benefitPeriodKey ?? '-'}|${createdAt}`,
      ),
      organizationId: input.organizationId,
      customerId: input.customerId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      ...(input.membershipPeriodId
        ? { membershipPeriodId: input.membershipPeriodId }
        : {}),
      ...(input.benefitId ? { benefitId: input.benefitId } : {}),
      ...(input.benefitPeriodKey
        ? { benefitPeriodKey: input.benefitPeriodKey }
        : {}),
      transactionType: 'ADJUSTED',
      unit: input.unit,
      quantity: input.quantity,
      reason: input.reason,
      occurredAt: input.occurredAt ?? createdAt,
      createdBy: input.createdBy,
      createdAt,
    }) as LedgerTransaction;
    const balance = balanceWithDelta(previous, transaction, createdAt);
    return this.persistence.appendCreditTransaction({
      transaction,
      balance,
      previousBalance: previous,
    });
  }

  async restore(input: RestoreInput) {
    const allocation = await this.persistence.getEntitlementAllocation(
      input.organizationId,
      input.allocationId,
    );
    if (!allocation)
      throw new AppError('NOT_FOUND', 'Entitlement allocation was not found.');
    const quantity = input.quantity ?? allocation.quantity;
    assertPositiveInteger(quantity, 'Restored quantity');
    const transactionId = stableId(
      'credit-restore',
      `${input.organizationId}|${input.allocationId}|${input.restorationId ?? 'default'}`,
    );
    if (allocation.status !== 'ACTIVE') {
      const existing = await this.persistence.getCreditTransaction(
        input.organizationId,
        transactionId,
      );
      if (existing) return { transaction: existing, duplicate: true };
      throw new AppError(
        'INVALID_STATE',
        'This entitlement allocation is already restored.',
      );
    }
    const history = await this.persistence.listCreditTransactionsBySource(
      input.organizationId,
      allocation.sourceType,
      allocation.sourceId,
    );
    const restoredBefore = history
      .filter(
        (transaction) =>
          transaction.transactionType === 'RESTORED' &&
          transaction.relatedTransactionId ===
            `consumption-${allocation.allocationId}`,
      )
      .reduce(
        (total, transaction) => total + Math.abs(transaction.quantity),
        0,
      );
    if (restoredBefore + quantity > allocation.quantity)
      throw new AppError(
        'VALIDATION_ERROR',
        'Restored quantity exceeds the allocation.',
      );
    const createdAt = input.createdAt ?? now();
    const previous = await this.persistence.getCreditBalance({
      organizationId: input.organizationId,
      customerId: allocation.customerId,
      sourceType: allocation.sourceType,
      sourceId: allocation.sourceId,
      ...(allocation.membershipPeriodId
        ? { membershipPeriodId: allocation.membershipPeriodId }
        : {}),
      ...(allocation.benefitId ? { benefitId: allocation.benefitId } : {}),
      ...(allocation.benefitPeriodKey
        ? { benefitPeriodKey: allocation.benefitPeriodKey }
        : {}),
    });
    if (!previous)
      throw new AppError('NOT_FOUND', 'Entitlement balance was not found.');
    const transaction = CreditTransactionSchema.parse({
      creditTransactionId: transactionId,
      organizationId: input.organizationId,
      customerId: allocation.customerId,
      sourceType: allocation.sourceType,
      sourceId: allocation.sourceId,
      ...(allocation.membershipPeriodId
        ? { membershipPeriodId: allocation.membershipPeriodId }
        : {}),
      ...(allocation.benefitId ? { benefitId: allocation.benefitId } : {}),
      ...(allocation.benefitPeriodKey
        ? { benefitPeriodKey: allocation.benefitPeriodKey }
        : {}),
      transactionType: 'RESTORED',
      unit: allocation.unit,
      quantity,
      relatedTransactionId: `consumption-${allocation.allocationId}`,
      reason: input.reason,
      occurredAt: input.occurredAt ?? createdAt,
      createdBy: input.createdBy,
      createdAt,
    }) as LedgerTransaction;
    const result = await this.persistence.appendCreditTransaction({
      transaction,
      balance: balanceWithDelta(previous, transaction, createdAt),
      previousBalance: previous,
    });
    await this.recordCreditEvent('CREDIT_RESTORED', {
      organizationId: input.organizationId,
      customerId: allocation.customerId,
      sourceType: allocation.sourceType,
      sourceId: allocation.sourceId,
      occurredAt: transaction.occurredAt,
      dedupeKey: transaction.creditTransactionId,
    });
    if (
      !result.duplicate &&
      restoredBefore + quantity === allocation.quantity
    ) {
      const { membershipPeriodId, ...allocationWithoutPeriod } = allocation;
      const voided: EntitlementAllocation & { membershipPeriodId?: string } = {
        ...allocationWithoutPeriod,
        ...(membershipPeriodId ? { membershipPeriodId } : {}),
        status: 'VOID',
        voidedAt: createdAt,
        voidedBy: input.createdBy,
      };
      await this.persistence.putEntitlementAllocation(voided, allocation);
    }
    return result;
  }

  async expire(input: {
    organizationId: string;
    customerId: string;
    sourceType: EntitlementSourceType;
    sourceId: string;
    membershipPeriodId?: string;
    benefitId?: string;
    benefitPeriodKey?: string;
    createdBy: string;
    occurredAt?: string;
    createdAt?: string;
    reason?: string;
  }) {
    const previous = await this.persistence.getCreditBalance(input);
    if (!previous)
      throw new AppError('NOT_FOUND', 'Entitlement balance was not found.');
    if (previous.quantityType === 'FINITE' && previous.remainingQuantity <= 0)
      return undefined;
    const createdAt = input.createdAt ?? now();
    const quantity =
      previous.quantityType === 'FINITE' ? previous.remainingQuantity : 1;
    const transaction = CreditTransactionSchema.parse({
      creditTransactionId: stableId(
        'credit-expired',
        `${input.sourceType}|${input.sourceId}|${input.membershipPeriodId ?? '-'}|${input.benefitId ?? '-'}|${input.benefitPeriodKey ?? '-'}`,
      ),
      organizationId: input.organizationId,
      customerId: input.customerId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      ...(input.membershipPeriodId
        ? { membershipPeriodId: input.membershipPeriodId }
        : {}),
      ...(input.benefitId ? { benefitId: input.benefitId } : {}),
      ...(input.benefitPeriodKey
        ? { benefitPeriodKey: input.benefitPeriodKey }
        : {}),
      transactionType: 'EXPIRED',
      unit: previous.unit,
      quantity: -quantity,
      reason: input.reason,
      occurredAt: input.occurredAt ?? createdAt,
      createdBy: input.createdBy,
      createdAt,
    }) as LedgerTransaction;
    return this.persistence.appendCreditTransaction({
      transaction,
      balance: balanceWithDelta(previous, transaction, createdAt),
      previousBalance: previous,
    });
  }
}
