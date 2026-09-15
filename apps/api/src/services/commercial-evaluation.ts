import type { CustomerPackage, Membership } from '@court-manager/contracts';

export type CommercialEvaluationOptions = {
  today: string;
  asOf?: string;
  timezone?: string;
  windowDays?: number;
  outstandingAmount?: number;
};

export type MembershipEvaluation = {
  renewalDue: boolean;
  overdue: boolean;
  expired: boolean;
  expiringSoon: boolean;
};

export type PackageEvaluation = {
  expired: boolean;
  expiringSoon: boolean;
};

const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const expiryDate = (expiresAt: string, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(expiresAt));
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
};

/**
 * Evaluates a membership without reading or mutating persistence. Date-only
 * membership boundaries are venue-local dates. Overdue deliberately requires
 * an outstanding current-period charge; a missed date alone is not debt.
 */
export const evaluateMembership = (
  membership: Membership,
  options: CommercialEvaluationOptions,
): MembershipEvaluation => {
  const windowDays = options.windowDays ?? 30;
  const windowEnd = addDays(options.today, windowDays);
  const active = !['CANCELLED', 'EXPIRED'].includes(membership.status);
  const expired = active && membership.currentPeriodEnd < options.today;
  const renewalDate = membership.nextRenewalDate;
  const renewalDue =
    active &&
    !expired &&
    renewalDate !== undefined &&
    renewalDate >= options.today &&
    renewalDate <= windowEnd;
  const overdue =
    active &&
    !expired &&
    renewalDate !== undefined &&
    renewalDate < options.today &&
    (options.outstandingAmount ?? 0) > 0;
  const expiringSoon =
    active &&
    !expired &&
    membership.currentPeriodEnd >= options.today &&
    membership.currentPeriodEnd <= windowEnd;
  return { renewalDue, overdue, expired, expiringSoon };
};

/** Package timestamps are compared as instants; the soon window is displayed
 * and queried by the venue-local expiration date. */
export const evaluatePackage = (
  customerPackage: CustomerPackage,
  options: CommercialEvaluationOptions,
): PackageEvaluation => {
  const asOf = options.asOf ?? new Date().toISOString();
  const timezone = options.timezone ?? 'UTC';
  const windowEnd = addDays(options.today, options.windowDays ?? 30);
  const expired =
    customerPackage.status === 'ACTIVE' &&
    customerPackage.expiresAt !== undefined &&
    Date.parse(customerPackage.expiresAt) <= Date.parse(asOf);
  const localExpiration = customerPackage.expiresAt
    ? expiryDate(customerPackage.expiresAt, timezone)
    : undefined;
  const expiringSoon =
    customerPackage.status === 'ACTIVE' &&
    !expired &&
    localExpiration !== undefined &&
    localExpiration >= options.today &&
    localExpiration <= windowEnd;
  return { expired, expiringSoon };
};

export type ChargeForEvaluation = {
  amount: number;
  status: 'ACTIVE' | 'VOID';
  chargeId: string;
};

export type PaymentForEvaluation = {
  amount: number;
  chargeId?: string | undefined;
};

/** Calculates outstanding money for one charge without treating credits as payments. */
export const outstandingChargeAmount = (
  charge: ChargeForEvaluation | undefined,
  payments: PaymentForEvaluation[],
) => {
  if (!charge || charge.status === 'VOID') return 0;
  const paid = payments
    .filter((payment) => payment.chargeId === charge.chargeId)
    .reduce((total, payment) => total + Number(payment.amount), 0);
  return Math.max(0, Number(charge.amount) - paid);
};

export const addCommercialDays = addDays;
