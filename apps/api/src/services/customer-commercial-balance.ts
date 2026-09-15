import {
  CustomerBalanceSummarySchema,
  CustomerCommercialSummarySchema,
  type AuthContext,
  type CustomerBalanceSummary,
  type CustomerCommercialSummary,
  type CreditBalanceSummary,
  type FixedCourtAgreement,
  type Membership,
  type CustomerPackage,
} from '@court-manager/contracts';
import type { RecordItem, Repository } from '../db.js';
import { AppError } from '../errors.js';
import type {
  CreditBalanceRecord,
  Phase3Persistence,
} from '../persistence/phase3-repository.js';

const customerKey = (organizationId: string, customerId: string) => ({
  PK: `ORG#${organizationId}`,
  SK: `CUSTOMER#${customerId}`,
});

const organizationKey = (organizationId: string) => ({
  PK: `ORG#${organizationId}`,
  SK: 'META',
});

const roundMoney = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const assertStaff = (ctx: AuthContext) => {
  if (!['OWNER', 'STAFF'].includes(ctx.role))
    throw new AppError(
      'FORBIDDEN',
      'You do not have permission for this operation.',
    );
};

const summaryCredit = (balance: CreditBalanceRecord): CreditBalanceSummary => ({
  sourceType: balance.sourceType,
  sourceId: balance.sourceId,
  ...(balance.membershipPeriodId
    ? { membershipPeriodId: balance.membershipPeriodId }
    : {}),
  ...(balance.benefitId ? { benefitId: balance.benefitId } : {}),
  ...(balance.benefitPeriodKey
    ? { benefitPeriodKey: balance.benefitPeriodKey }
    : {}),
  unit: balance.unit,
  quantityType: balance.quantityType,
  issuedQuantity: balance.issuedQuantity,
  consumedQuantity: balance.consumedQuantity,
  restoredQuantity: balance.restoredQuantity,
  expiredQuantity: balance.expiredQuantity,
  adjustedQuantity: balance.adjustedQuantity ?? 0,
  remainingQuantity: Math.max(0, balance.remainingQuantity),
  ...(balance.expiresAt ? { expiresAt: balance.expiresAt } : {}),
});

const isAvailable = (balance: CreditBalanceSummary) =>
  balance.quantityType === 'UNLIMITED' || balance.remainingQuantity > 0;

const isFuture = (value: string | undefined, asOf: string) =>
  Boolean(value && Date.parse(value) >= Date.parse(asOf));

/**
 * Produces the staff-facing commercial and financial view for one customer.
 *
 * Money comes only from operational charge/payment records. Entitlement
 * balances and allocations are deliberately kept separate: consuming a
 * service credit never reduces a cash balance or counts as a payment.
 */
export class CustomerCommercialBalanceService {
  constructor(
    private readonly persistence: Phase3Persistence,
    private readonly repo: Repository,
  ) {}

  async get(
    ctx: AuthContext,
    customerId: string,
  ): Promise<CustomerCommercialSummary> {
    assertStaff(ctx);
    const customer = await this.repo.get<RecordItem>(
      customerKey(ctx.organizationId, customerId),
    );
    if (!customer || customer.archived)
      throw new AppError('NOT_FOUND', 'Customer was not found.');

    const asOf = new Date().toISOString();
    const [
      organization,
      charges,
      payments,
      memberships,
      packages,
      agreements,
      balances,
      records,
    ] = await Promise.all([
      this.repo.get<RecordItem>(organizationKey(ctx.organizationId)),
      this.persistence.listCustomerCharges(ctx.organizationId, customerId),
      this.persistence.listCustomerPayments(ctx.organizationId, customerId),
      this.persistence.listMembershipsByCustomer(
        ctx.organizationId,
        customerId,
        {
          activeOnly: true,
          limit: 100,
        },
      ),
      this.persistence.listPackagesByCustomer(ctx.organizationId, customerId, {
        activeOnly: true,
        limit: 100,
      }),
      this.persistence.listFixedCourtAgreementsByCustomer(
        ctx.organizationId,
        customerId,
        { activeOnly: true, limit: 100 },
      ),
      this.persistence.listCreditBalancesByCustomer(
        ctx.organizationId,
        customerId,
        100,
      ),
      this.persistence.listCustomerCommercialRecords(
        ctx.organizationId,
        customerId,
        100,
      ),
    ]);

    const paidFor = (charge: (typeof charges)[number]) =>
      payments
        .filter(
          (payment) =>
            payment.chargeId === charge.chargeId ||
            (!payment.chargeId &&
              ((charge.reservationId &&
                payment.reservationId === charge.reservationId) ||
                (charge.classId && payment.classId === charge.classId))),
        )
        .reduce((sum, payment) => sum + Number(payment.amount), 0);

    const activeCharges = charges.filter(
      (charge) => charge.status === 'ACTIVE',
    );
    const totalCharges = roundMoney(
      activeCharges.reduce((sum, charge) => sum + Number(charge.amount), 0),
    );
    const totalPayments = roundMoney(
      payments.reduce((sum, payment) => sum + Number(payment.amount), 0),
    );
    const outstandingAmount = roundMoney(
      activeCharges.reduce(
        (sum, charge) =>
          sum + Math.max(0, Number(charge.amount) - paidFor(charge)),
        0,
      ),
    );
    const overdueAmount = roundMoney(
      activeCharges
        .filter(
          (charge) => String(charge.serviceAt).slice(0, 10) < asOf.slice(0, 10),
        )
        .reduce(
          (sum, charge) =>
            sum + Math.max(0, Number(charge.amount) - paidFor(charge)),
          0,
        ),
    );

    const availableCredits = balances
      .map(summaryCredit)
      .filter(isAvailable)
      .sort((a, b) =>
        `${a.sourceType}|${a.sourceId}|${a.benefitId ?? ''}`.localeCompare(
          `${b.sourceType}|${b.sourceId}|${b.benefitId ?? ''}`,
        ),
      );
    const activeAllocations = records.filter(
      (record) =>
        typeof record.allocationId === 'string' &&
        record.status === 'ACTIVE' &&
        typeof record.coveredAmount === 'number',
    );
    const totalCovered = roundMoney(
      activeAllocations.reduce(
        (sum, record) => sum + Number(record.coveredAmount),
        0,
      ),
    );
    const financialCreditAmount = roundMoney(
      Math.max(0, totalPayments - totalCharges),
    );
    const currency = String(organization?.currency ?? 'BRL');
    const balance: CustomerBalanceSummary = CustomerBalanceSummarySchema.parse({
      organizationId: ctx.organizationId,
      customerId,
      currency,
      totalCharges,
      totalPayments,
      totalCovered,
      financialCreditAmount,
      outstandingAmount,
      overdueAmount,
      credits: availableCredits,
      asOf,
    });

    const upcomingRenewals = memberships
      .filter((membership) => isFuture(membership.nextRenewalDate, asOf))
      .sort((a, b) =>
        String(a.nextRenewalDate).localeCompare(String(b.nextRenewalDate)),
      );
    const expiringBenefits = availableCredits
      .filter((credit) => isFuture(credit.expiresAt, asOf))
      .sort((a, b) => String(a.expiresAt).localeCompare(String(b.expiresAt)));
    const generatedAt = asOf;
    const activity = {
      organizationId: ctx.organizationId,
      customerId,
      activeMembershipCount: memberships.length,
      activePackageCount: packages.length,
      ...(upcomingRenewals[0]?.nextRenewalDate
        ? { nextMembershipRenewalDate: upcomingRenewals[0].nextRenewalDate }
        : {}),
      ...(packages
        .map((customerPackage) => customerPackage.expiresAt)
        .filter((expiresAt) => isFuture(expiresAt, asOf))
        .sort()[0]
        ? {
            nextPackageExpirationDate: packages
              .map((customerPackage) => customerPackage.expiresAt)
              .filter((expiresAt) => isFuture(expiresAt, asOf))
              .sort()[0]
              ?.slice(0, 10),
          }
        : {}),
      balance,
      generatedAt,
    };
    return CustomerCommercialSummarySchema.parse({
      balance,
      activity,
      memberships: memberships as Membership[],
      packages: packages as CustomerPackage[],
      fixedCourtAgreements: agreements as FixedCourtAgreement[],
      upcomingRenewals,
      expiringBenefits,
    });
  }
}
