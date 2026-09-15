import {
  CustomerPortalCreditHistorySchema,
  CustomerPortalCreditSchema,
  CustomerPortalMembershipDetailSchema,
  CustomerPortalMembershipPeriodSchema,
  CustomerPortalMembershipSchema,
  CustomerPortalPackageDetailSchema,
  CustomerPortalPackageSchema,
  type CustomerAuthContext,
  type CustomerPortalCredit,
  type CustomerPortalCreditHistory,
  type CustomerPortalMembership,
  type CustomerPortalMembershipDetail,
  type CustomerPortalMembershipPeriod,
  type CustomerPortalPackage,
  type CustomerPortalPackageDetail,
  type Membership,
  type PackageBenefit,
  type PlanBenefit,
} from '@court-manager/contracts';
import { AppError } from '../../errors.js';
import type {
  CreditBalanceRecord,
  Phase3Persistence,
} from '../../persistence/phase3-repository.js';

type Benefit = PlanBenefit | PackageBenefit;

const benefitMatches = (benefit: Benefit, balance: CreditBalanceRecord) =>
  benefit.benefitId && balance.benefitId
    ? benefit.benefitId === balance.benefitId
    : benefit.unit === balance.unit &&
      (benefit.type === 'COURT_TIME' ||
        benefit.type === 'CLASS_ATTENDANCE' ||
        benefit.type === 'PRIVATE_LESSON');

const usage = (benefit: Benefit, balances: CreditBalanceRecord[]) => {
  const matching = balances.filter((balance) =>
    benefitMatches(benefit, balance),
  );
  const finiteQuantity = 'quantity' in benefit ? benefit.quantity : 0;
  const quantityType =
    'quantityType' in benefit ? benefit.quantityType : ('FINITE' as const);
  const total = (field: keyof CreditBalanceRecord) =>
    matching.reduce((sum, balance) => sum + Number(balance[field] ?? 0), 0);
  const expiresAt = matching
    .map((balance) => balance.expiresAt)
    .filter((value): value is string => typeof value === 'string')
    .sort()[0];
  return {
    ...(benefit.benefitId ? { benefitId: benefit.benefitId } : {}),
    ...(benefit.label ? { label: benefit.label } : {}),
    type: benefit.type,
    unit: benefit.unit,
    quantityType,
    issuedQuantity:
      quantityType === 'UNLIMITED'
        ? 0
        : total('issuedQuantity') || finiteQuantity,
    consumedQuantity: total('consumedQuantity'),
    restoredQuantity: total('restoredQuantity'),
    expiredQuantity: total('expiredQuantity'),
    adjustedQuantity: total('adjustedQuantity'),
    remainingQuantity:
      quantityType === 'UNLIMITED'
        ? 0
        : total('remainingQuantity') || (matching.length ? 0 : finiteQuantity),
    ...(expiresAt ? { expiresAt } : {}),
  };
};

const customerMembership = (
  membership: Membership,
  balances: CreditBalanceRecord[],
): CustomerPortalMembership =>
  CustomerPortalMembershipSchema.parse({
    membershipId: membership.membershipId,
    planId: membership.planId,
    planNameSnapshot: membership.planNameSnapshot,
    status: membership.status,
    startDate: membership.startDate,
    currentPeriodStart: membership.currentPeriodStart,
    currentPeriodEnd: membership.currentPeriodEnd,
    ...(membership.nextRenewalDate
      ? { nextRenewalDate: membership.nextRenewalDate }
      : {}),
    ...(membership.currentPeriodId
      ? { currentPeriodId: membership.currentPeriodId }
      : {}),
    price: membership.price,
    currency: membership.currency,
    billingInterval: membership.billingInterval,
    ...(membership.customIntervalDays === undefined
      ? {}
      : { customIntervalDays: membership.customIntervalDays }),
    benefits: membership.benefitSnapshot.map((benefit) =>
      usage(
        benefit,
        balances.filter(
          (balance) =>
            !membership.currentPeriodId ||
            balance.membershipPeriodId === membership.currentPeriodId,
        ),
      ),
    ),
  });

const customerPackage = (
  customerPackage: Awaited<ReturnType<Phase3Persistence['getCustomerPackage']>>,
  balances: CreditBalanceRecord[],
): CustomerPortalPackage => {
  if (!customerPackage) throw new Error('Customer package is required.');
  return CustomerPortalPackageSchema.parse({
    customerPackageId: customerPackage.customerPackageId,
    packageDefinitionId: customerPackage.packageDefinitionId,
    packageNameSnapshot: customerPackage.packageNameSnapshot,
    status: customerPackage.status,
    issuedAt: customerPackage.issuedAt,
    startsAt: customerPackage.startsAt,
    ...(customerPackage.expiresAt
      ? { expiresAt: customerPackage.expiresAt }
      : {}),
    price: customerPackage.price,
    currency: customerPackage.currency,
    benefits: customerPackage.benefitSnapshot.map((benefit) =>
      usage(benefit, balances),
    ),
  });
};

const customerPeriod = (
  period: Awaited<ReturnType<Phase3Persistence['getMembershipPeriod']>>,
): CustomerPortalMembershipPeriod => {
  if (!period) throw new Error('Membership period is required.');
  return CustomerPortalMembershipPeriodSchema.parse({
    membershipPeriodId: period.membershipPeriodId,
    periodNumber: period.periodNumber,
    startDate: period.startDate,
    endDate: period.endDate,
    status: period.status,
    price: period.price,
    currency: period.currency,
  });
};

const customerHistory = (transactions: unknown[]) =>
  transactions
    .map((transaction) =>
      CustomerPortalCreditHistorySchema.safeParse({
        transactionType: (transaction as { transactionType?: unknown })
          .transactionType,
        unit: (transaction as { unit?: unknown }).unit,
        quantity: (transaction as { quantity?: unknown }).quantity,
        ...((transaction as { activityType?: unknown }).activityType
          ? {
              activityType: (transaction as { activityType: string })
                .activityType,
            }
          : {}),
        ...((transaction as { activityId?: unknown }).activityId
          ? { activityId: (transaction as { activityId: string }).activityId }
          : {}),
        occurredAt: (transaction as { occurredAt?: unknown }).occurredAt,
      }),
    )
    .filter(
      (
        result,
      ): result is { success: true; data: CustomerPortalCreditHistory } =>
        result.success,
    )
    .map((result) => result.data)
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

const sourceName = (
  sourceType: CreditBalanceRecord['sourceType'],
  sourceId: string,
  memberships: Membership[],
  packages: Awaited<ReturnType<Phase3Persistence['listPackagesByCustomer']>>,
) =>
  sourceType === 'MEMBERSHIP'
    ? (memberships.find((item) => item.membershipId === sourceId)
        ?.planNameSnapshot ?? 'Membership')
    : sourceType === 'PACKAGE'
      ? (packages.find((item) => item.customerPackageId === sourceId)
          ?.packageNameSnapshot ?? 'Package')
      : sourceType === 'MAKEUP'
        ? 'Makeup credit'
        : sourceType === 'FIXED_AGREEMENT'
          ? 'Fixed court agreement'
          : 'Credit adjustment';

const balanceUsage = (balance: CreditBalanceRecord, benefit?: Benefit) => {
  if (benefit) return usage(benefit, [balance]);
  const type =
    balance.unit === 'COURT_MINUTES'
      ? 'COURT_TIME'
      : balance.unit === 'SESSION'
        ? 'CLASS_ATTENDANCE'
        : balance.unit === 'GAME'
          ? 'OPEN_GAME'
          : 'FIXED_COURT_SLOT';
  return {
    ...(balance.benefitId ? { benefitId: balance.benefitId } : {}),
    type,
    unit: balance.unit,
    quantityType: balance.quantityType,
    issuedQuantity: balance.issuedQuantity,
    consumedQuantity: balance.consumedQuantity,
    restoredQuantity: balance.restoredQuantity,
    expiredQuantity: balance.expiredQuantity,
    adjustedQuantity: balance.adjustedQuantity ?? 0,
    remainingQuantity: Math.max(0, balance.remainingQuantity),
    ...(balance.expiresAt ? { expiresAt: balance.expiresAt } : {}),
  };
};

export class CustomerCommercialPortalService {
  constructor(private readonly persistence: Phase3Persistence) {}

  private async balances(ctx: CustomerAuthContext) {
    return this.persistence.listCreditBalancesByCustomer(
      ctx.organizationId,
      ctx.customerId,
      100,
    );
  }

  async memberships(ctx: CustomerAuthContext) {
    const [memberships, balances] = await Promise.all([
      this.persistence.listMembershipsByCustomer(
        ctx.organizationId,
        ctx.customerId,
        {
          limit: 100,
        },
      ),
      this.balances(ctx),
    ]);
    return memberships
      .filter((membership) => membership.status !== 'DRAFT')
      .map((membership) =>
        customerMembership(
          membership,
          balances.filter(
            (balance) => balance.sourceId === membership.membershipId,
          ),
        ),
      );
  }

  async membership(
    ctx: CustomerAuthContext,
    id: string,
  ): Promise<CustomerPortalMembershipDetail> {
    const membership = await this.persistence.getMembership(
      ctx.organizationId,
      id,
    );
    if (
      !membership ||
      membership.customerId !== ctx.customerId ||
      membership.status === 'DRAFT'
    )
      throw new AppError('NOT_FOUND', 'Membership was not found.');
    const [balances, periods, transactions] = await Promise.all([
      this.balances(ctx),
      this.persistence.listMembershipPeriods(ctx.organizationId, id, 100),
      this.persistence.listCreditTransactionsBySource(
        ctx.organizationId,
        'MEMBERSHIP',
        id,
        100,
      ),
    ]);
    return CustomerPortalMembershipDetailSchema.parse({
      membership: customerMembership(
        membership,
        balances.filter(
          (balance) => balance.sourceId === membership.membershipId,
        ),
      ),
      periods: periods.map(customerPeriod),
      history: customerHistory(transactions),
    });
  }

  async credits(ctx: CustomerAuthContext): Promise<CustomerPortalCredit[]> {
    const [balances, memberships, packages] = await Promise.all([
      this.balances(ctx),
      this.persistence.listMembershipsByCustomer(
        ctx.organizationId,
        ctx.customerId,
        {
          limit: 100,
        },
      ),
      this.persistence.listPackagesByCustomer(
        ctx.organizationId,
        ctx.customerId,
        {
          limit: 100,
        },
      ),
    ]);
    const benefits = new Map<string, Benefit>();
    for (const membership of memberships)
      for (const benefit of membership.benefitSnapshot)
        benefits.set(
          `${membership.membershipId}|${benefit.benefitId ?? benefit.unit}`,
          benefit,
        );
    for (const item of packages)
      for (const benefit of item.benefitSnapshot)
        benefits.set(
          `${item.customerPackageId}|${benefit.benefitId ?? benefit.unit}`,
          benefit,
        );
    return balances
      .filter(
        (balance) =>
          balance.quantityType === 'UNLIMITED' || balance.remainingQuantity > 0,
      )
      .map((balance) => {
        const benefit = benefits.get(
          `${balance.sourceId}|${balance.benefitId ?? balance.unit}`,
        );
        return CustomerPortalCreditSchema.parse({
          ...balanceUsage(balance, benefit),
          sourceType: balance.sourceType,
          sourceId: balance.sourceId,
          sourceName: sourceName(
            balance.sourceType,
            balance.sourceId,
            memberships,
            packages,
          ),
        });
      });
  }

  async package(
    ctx: CustomerAuthContext,
    id: string,
  ): Promise<CustomerPortalPackageDetail> {
    const item = await this.persistence.getCustomerPackage(
      ctx.organizationId,
      id,
    );
    if (!item || item.customerId !== ctx.customerId)
      throw new AppError('NOT_FOUND', 'Package was not found.');
    const [balances, transactions] = await Promise.all([
      this.balances(ctx),
      this.persistence.listCreditTransactionsByPackage(
        ctx.organizationId,
        id,
        100,
      ),
    ]);
    return CustomerPortalPackageDetailSchema.parse({
      package: customerPackage(
        item,
        balances.filter(
          (balance) => balance.sourceId === item.customerPackageId,
        ),
      ),
      history: customerHistory(transactions),
    });
  }
}
