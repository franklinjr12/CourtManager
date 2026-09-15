import { dayKeyInTimezone } from '../domain.js';

type QuantityMetric = {
  unit: string;
  issuedQuantity: number;
  consumedQuantity: number;
  expiredQuantity: number;
  utilizationPercent: number;
};

type CommercialReportingInput = {
  memberships: Array<Record<string, unknown>>;
  packages: Array<Record<string, unknown>>;
  creditTransactions: Array<Record<string, unknown>>;
  charges: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
  fixedCourtAgreements: Array<Record<string, unknown>>;
};

const inDateRange = (
  value: unknown,
  from: string,
  to: string,
  timezone: string,
) => {
  if (!value) return false;
  const day = dayKeyInTimezone(String(value), timezone);
  return day >= from && day <= to;
};

const localDateInRange = (value: unknown, from: string, to: string) => {
  const day = String(value ?? '');
  return day >= from && day <= to;
};

const positiveQuantity = (item: Record<string, unknown>) =>
  Math.abs(Number(item.quantity));

const quantityMetrics = (
  transactions: Array<Record<string, unknown>>,
  packages: Array<Record<string, unknown>>,
  from: string,
  to: string,
  timezone: string,
): QuantityMetric[] => {
  const finiteBenefitKeys = new Set(
    packages.flatMap((customerPackage) =>
      (
        (customerPackage.benefitSnapshot as Array<Record<string, unknown>>) ??
        []
      )
        .filter((benefit) => benefit.quantityType === 'FINITE')
        .map(
          (benefit) =>
            `${customerPackage.customerPackageId}|${benefit.benefitId ?? '-'}|${benefit.unit}`,
        ),
    ),
  );
  const totals = new Map<
    string,
    Omit<QuantityMetric, 'unit' | 'utilizationPercent'>
  >();
  for (const transaction of transactions) {
    if (
      !inDateRange(transaction.occurredAt, from, to, timezone) ||
      !transaction.unit
    )
      continue;
    const benefitKey = `${transaction.sourceId}|${transaction.benefitId ?? '-'}|${transaction.unit}`;
    // Unlimited benefits deliberately do not contribute a fake numeric
    // quantity to utilization (their ledger uses a quantity of one).
    if (
      transaction.benefitId &&
      packages.some(
        (customerPackage) =>
          customerPackage.customerPackageId === transaction.sourceId,
      ) &&
      !finiteBenefitKeys.has(benefitKey)
    )
      continue;
    const current = totals.get(String(transaction.unit)) ?? {
      issuedQuantity: 0,
      consumedQuantity: 0,
      expiredQuantity: 0,
    };
    const quantity = positiveQuantity(transaction);
    if (transaction.transactionType === 'ISSUED')
      current.issuedQuantity += quantity;
    else if (transaction.transactionType === 'CONSUMED')
      current.consumedQuantity += quantity;
    else if (transaction.transactionType === 'EXPIRED')
      current.expiredQuantity += quantity;
    totals.set(String(transaction.unit), current);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([unit, total]) => ({
      unit,
      ...total,
      utilizationPercent: total.issuedQuantity
        ? (total.consumedQuantity / total.issuedQuantity) * 100
        : 0,
    }));
};

export const buildCommercialReporting = ({
  memberships,
  packages,
  creditTransactions,
  charges,
  payments,
  fixedCourtAgreements,
  from,
  to,
  timezone,
}: CommercialReportingInput & {
  from: string;
  to: string;
  timezone: string;
}) => {
  const membershipCharges = charges.filter(
    (charge) =>
      charge.sourceType === 'MEMBERSHIP' &&
      charge.status === 'ACTIVE' &&
      inDateRange(charge.serviceAt, from, to, timezone),
  );
  const membershipChargeIds = new Set(
    membershipCharges.map((charge) => charge.chargeId),
  );
  const membershipPayments = payments.filter(
    (payment) =>
      membershipChargeIds.has(payment.chargeId) &&
      inDateRange(payment.paidAt, from, to, timezone),
  );
  const paidFor = (charge: Record<string, unknown>) =>
    payments
      .filter((payment) => payment.chargeId === charge.chargeId)
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
  const membershipsByPlan = new Map<
    string,
    { planId: string; planName: string; count: number }
  >();
  for (const membership of memberships) {
    const planId = String(membership.planId);
    const current = membershipsByPlan.get(planId) ?? {
      planId,
      planName: String(membership.planNameSnapshot ?? planId),
      count: 0,
    };
    if (
      membership.status === 'ACTIVE' &&
      localDateInRange(membership.startDate, '0000-01-01', to)
    )
      current.count += 1;
    membershipsByPlan.set(planId, current);
  }
  const activeMemberships = memberships.filter(
    (membership) =>
      membership.status === 'ACTIVE' &&
      localDateInRange(membership.startDate, '0000-01-01', to),
  ).length;
  const newMemberships = memberships.filter((membership) =>
    localDateInRange(membership.startDate, from, to),
  ).length;
  const cancelledMemberships = memberships.filter((membership) =>
    localDateInRange(
      membership.cancellationEffectiveDate ??
        (membership.cancelledAt
          ? dayKeyInTimezone(String(membership.cancelledAt), timezone)
          : undefined),
      from,
      to,
    ),
  ).length;
  const packageIssues = packages.filter((customerPackage) =>
    inDateRange(customerPackage.issuedAt, from, to, timezone),
  );
  const packageTransactions = creditTransactions.filter(
    (transaction) => transaction.sourceType === 'PACKAGE',
  );
  const packageQuantityMetrics = quantityMetrics(
    packageTransactions,
    packages,
    from,
    to,
    timezone,
  );
  const fixedCourtCharges = charges.filter(
    (charge) =>
      charge.sourceType === 'FIXED_COURT_AGREEMENT' &&
      charge.status === 'ACTIVE' &&
      inDateRange(charge.serviceAt, from, to, timezone),
  );
  const activeFixedCourtAgreements = fixedCourtAgreements.filter(
    (agreement) =>
      ['ACTIVE', 'PAUSED'].includes(String(agreement.status)) &&
      localDateInRange(agreement.startDate, '0000-01-01', to) &&
      (!agreement.endDate ||
        localDateInRange(agreement.endDate, from, '9999-12-31')),
  ).length;
  const membershipExpectedRevenue = membershipCharges.reduce(
    (sum, charge) => sum + Number(charge.amount),
    0,
  );
  const membershipRecordedPayments = membershipPayments.reduce(
    (sum, payment) => sum + Number(payment.amount),
    0,
  );
  const membershipOutstandingAmount = membershipCharges.reduce(
    (sum, charge) => sum + Math.max(0, Number(charge.amount) - paidFor(charge)),
    0,
  );
  const membershipsByPlanList = [...membershipsByPlan.values()].sort((a, b) =>
    a.planName.localeCompare(b.planName),
  );
  const commercial = {
    memberships: {
      activeCount: activeMemberships,
      byPlan: membershipsByPlanList,
      newCount: newMemberships,
      cancelledCount: cancelledMemberships,
      expectedCharges: membershipExpectedRevenue,
      recordedPayments: membershipRecordedPayments,
      outstandingAmount: membershipOutstandingAmount,
    },
    packages: {
      issuedCount: packageIssues.length,
      salesValue: packageIssues.reduce(
        (sum, customerPackage) => sum + Number(customerPackage.price),
        0,
      ),
      credits: packageQuantityMetrics,
    },
    fixedCourts: {
      agreementCount: activeFixedCourtAgreements,
      expectedRevenue: fixedCourtCharges.reduce(
        (sum, charge) => sum + Number(charge.amount),
        0,
      ),
    },
  };
  return {
    commercial,
    activeMemberships,
    membershipsByPlan: membershipsByPlanList,
    newMemberships,
    cancelledMemberships,
    membershipExpectedRevenue,
    membershipRecordedPayments,
    membershipOutstandingAmount,
    packagesIssued: packageIssues.length,
    packageSalesValue: commercial.packages.salesValue,
    packageCreditsIssued: packageQuantityMetrics.map(
      ({ unit, issuedQuantity }) => ({
        unit,
        quantity: issuedQuantity,
      }),
    ),
    packageCreditsConsumed: packageQuantityMetrics.map(
      ({ unit, consumedQuantity }) => ({
        unit,
        quantity: consumedQuantity,
      }),
    ),
    packageCreditsExpired: packageQuantityMetrics.map(
      ({ unit, expiredQuantity }) => ({
        unit,
        quantity: expiredQuantity,
      }),
    ),
    packageUtilization: packageQuantityMetrics,
    fixedCourtAgreements: activeFixedCourtAgreements,
    fixedCourtExpectedRevenue: commercial.fixedCourts.expectedRevenue,
  };
};
