import {
  ChargeSchema,
  type Charge,
  type Membership,
  type MembershipPeriod,
} from '@court-manager/contracts';
import type { RecordItem, Repository } from '../db.js';
import { AppError } from '../errors.js';
import type { Phase3Persistence } from '../persistence/phase3-repository.js';

const chargeKey = (chargeId: string) => ({
  PK: `CHARGE#${chargeId}`,
  SK: 'META',
});

const chargeForPeriod = (
  membership: Membership,
  period: MembershipPeriod,
  createdBy: string,
): Charge => {
  const chargeId = period.chargeId ?? `membership-${period.membershipPeriodId}`;
  const parsed = ChargeSchema.safeParse({
    chargeId,
    organizationId: membership.organizationId,
    customerId: membership.customerId,
    sourceType: 'MEMBERSHIP',
    sourceId: period.membershipPeriodId,
    membershipId: membership.membershipId,
    membershipPeriodId: period.membershipPeriodId,
    description: `Membership renewal: ${membership.planNameSnapshot}`,
    amount: period.price,
    serviceAt: `${period.startDate}T00:00:00.000Z`,
    status: 'ACTIVE',
    createdBy,
    createdAt: period.createdAt,
  });
  if (!parsed.success)
    throw new AppError(
      'VALIDATION_ERROR',
      'Membership charge validation failed.',
      parsed.error.flatten(),
    );
  return parsed.data;
};

const samePeriodCharge = (
  item: RecordItem | undefined,
  membership: Membership,
  period: MembershipPeriod,
) =>
  item?.organizationId === membership.organizationId &&
  item?.customerId === membership.customerId &&
  item?.sourceType === 'MEMBERSHIP' &&
  item?.sourceId === period.membershipPeriodId;

const asCharge = (item: RecordItem) => item as unknown as Charge;

/**
 * Ensures the one operational charge expected for a membership period exists.
 * The period ID is the charge identity, so retries and concurrent renewals
 * converge on the same charge instead of creating another one.
 */
export async function ensureMembershipPeriodCharge(
  repo: Repository,
  persistence: Phase3Persistence,
  membership: Membership,
  period: MembershipPeriod,
  createdBy: string,
) {
  const charge = chargeForPeriod(membership, period, createdBy);
  const key = chargeKey(charge.chargeId);
  const existing = await repo.get<RecordItem>(key);
  if (existing) {
    if (!samePeriodCharge(existing, membership, period))
      throw new AppError(
        'CONFLICT',
        'A different charge already uses this membership period.',
      );
    await persistence.indexCharge(asCharge(existing));
    return asCharge(existing);
  }

  const stored = { ...charge, ...key, entity: 'charge' as const };
  try {
    await repo.put(stored, 'attribute_not_exists(PK)');
  } catch (error) {
    const retry = await repo.get<RecordItem>(key);
    if (!retry || !samePeriodCharge(retry, membership, period)) throw error;
    await persistence.indexCharge(asCharge(retry));
    return asCharge(retry);
  }
  await persistence.indexCharge(charge);
  return charge;
}
