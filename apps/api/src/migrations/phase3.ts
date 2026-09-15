import type { RecordItem, Repository } from '../db.js';
import { phase3Keys } from '../persistence/phase3-keys.js';

export type Phase3MigrationResult = {
  indexesCreated: number;
  financialIndexesCreated: number;
};

const withoutMetadata = (item: RecordItem) => {
  return Object.fromEntries(
    Object.entries(item).filter(
      ([name]) => name !== 'PK' && name !== 'SK' && name !== 'entity',
    ),
  );
};

/**
 * Backfill only query indexes. No membership, package, balance, or usage
 * records are invented for existing Phase 0-2 data.
 */
export async function migratePhase3(
  repo: Repository,
): Promise<Phase3MigrationResult> {
  let indexesCreated = 0;
  let financialIndexesCreated = 0;
  const rows = await repo.scan<RecordItem>();

  const ensureIndex = async (
    source: RecordItem,
    key: { PK: string; SK: string },
    financial = false,
  ) => {
    if (await repo.get(key)) return;
    await repo.put({ ...withoutMetadata(source), ...key });
    indexesCreated += 1;
    if (financial) financialIndexesCreated += 1;
  };

  for (const item of rows) {
    const organizationId = String(item.organizationId ?? '');
    if (!organizationId) continue;
    if (item.entity === 'plan') {
      await ensureIndex(
        item,
        phase3Keys.organizationPlan(
          organizationId,
          String(item.createdAt),
          String(item.planId),
        ),
      );
      await ensureIndex(
        item,
        phase3Keys.organizationPlanStatus(
          organizationId,
          String(item.status),
          String(item.createdAt),
          String(item.planId),
        ),
      );
    } else if (item.entity === 'membership') {
      const membershipId = String(item.membershipId);
      const customerId = String(item.customerId);
      const startDate = String(item.startDate);
      await ensureIndex(
        item,
        phase3Keys.membershipByCustomer(
          organizationId,
          customerId,
          startDate,
          membershipId,
        ),
      );
      if (item.status === 'ACTIVE')
        await ensureIndex(
          item,
          phase3Keys.membershipByCustomer(
            organizationId,
            customerId,
            startDate,
            membershipId,
            true,
          ),
        );
      await ensureIndex(
        item,
        phase3Keys.membershipByPlan(
          String(item.planId),
          startDate,
          membershipId,
        ),
      );
      await ensureIndex(
        item,
        phase3Keys.membershipByOrganization(
          organizationId,
          startDate,
          membershipId,
        ),
      );
      await ensureIndex(
        item,
        phase3Keys.membershipStatus(
          organizationId,
          String(item.status),
          startDate,
          membershipId,
        ),
      );
      if (item.nextRenewalDate)
        await ensureIndex(
          item,
          phase3Keys.membershipRenewal(
            organizationId,
            String(item.nextRenewalDate),
            membershipId,
          ),
        );
      await ensureIndex(
        item,
        phase3Keys.membershipExpiry(
          organizationId,
          String(item.currentPeriodEnd),
          membershipId,
        ),
      );
      await ensureIndex(
        item,
        phase3Keys.customerCommercialRecord(
          organizationId,
          customerId,
          startDate,
          'MEMBERSHIP',
          membershipId,
        ),
      );
    } else if (item.entity === 'membershipPeriod') {
      await ensureIndex(
        item,
        phase3Keys.membershipPeriod(
          String(item.membershipId),
          String(item.membershipPeriodId),
        ),
      );
    } else if (item.entity === 'packageDefinition') {
      await ensureIndex(
        item,
        phase3Keys.organizationPackageDefinition(
          organizationId,
          String(item.createdAt),
          String(item.packageDefinitionId),
        ),
      );
      await ensureIndex(
        item,
        phase3Keys.organizationPackageDefinitionStatus(
          organizationId,
          String(item.status),
          String(item.createdAt),
          String(item.packageDefinitionId),
        ),
      );
    } else if (item.entity === 'customerPackage') {
      const packageId = String(item.customerPackageId);
      const customerId = String(item.customerId);
      const startsAt = String(item.startsAt);
      await ensureIndex(
        item,
        phase3Keys.packageByOrganization(organizationId, startsAt, packageId),
      );
      await ensureIndex(
        item,
        phase3Keys.customerPackageByCustomer(
          organizationId,
          customerId,
          startsAt,
          packageId,
        ),
      );
      if (item.status === 'ACTIVE')
        await ensureIndex(
          item,
          phase3Keys.customerPackageByCustomer(
            organizationId,
            customerId,
            startsAt,
            packageId,
            true,
          ),
        );
      if (item.expiresAt)
        await ensureIndex(
          item,
          phase3Keys.packageExpiry(
            organizationId,
            String(item.expiresAt),
            packageId,
          ),
        );
      await ensureIndex(
        item,
        phase3Keys.customerCommercialRecord(
          organizationId,
          customerId,
          startsAt,
          'PACKAGE',
          packageId,
        ),
      );
    } else if (item.entity === 'creditTransaction') {
      const transactionId = String(item.creditTransactionId);
      await ensureIndex(
        item,
        phase3Keys.creditTransactionBySource(
          String(item.sourceType),
          String(item.sourceId),
          String(item.occurredAt),
          transactionId,
        ),
      );
      if (item.membershipPeriodId)
        await ensureIndex(
          item,
          phase3Keys.creditTransactionByMembershipPeriod(
            String(item.membershipPeriodId),
            String(item.occurredAt),
            transactionId,
          ),
        );
      await ensureIndex(
        item,
        phase3Keys.customerCommercialRecord(
          organizationId,
          String(item.customerId),
          String(item.occurredAt),
          'CREDIT',
          transactionId,
        ),
      );
    } else if (item.entity === 'entitlementAllocation') {
      const allocationId = String(item.allocationId);
      await ensureIndex(
        item,
        phase3Keys.entitlementAllocationBySource(
          String(item.sourceType),
          String(item.sourceId),
          String(item.createdAt),
          allocationId,
        ),
      );
      await ensureIndex(
        item,
        phase3Keys.usageAllocationByActivity(
          organizationId,
          String(item.activityType),
          String(item.activityId),
          String(item.sourceType),
          String(item.sourceId),
          item.membershipPeriodId ? String(item.membershipPeriodId) : undefined,
          item.benefitId ? String(item.benefitId) : undefined,
          item.benefitPeriodKey ? String(item.benefitPeriodKey) : undefined,
          allocationId,
        ),
      );
      await ensureIndex(
        item,
        phase3Keys.customerCommercialRecord(
          organizationId,
          String(item.customerId),
          String(item.createdAt),
          'ALLOCATION',
          allocationId,
        ),
      );
    } else if (item.entity === 'fixedCourtAgreement') {
      const agreementId = String(item.agreementId);
      const customerId = String(item.customerId);
      const startDate = String(item.startDate);
      await ensureIndex(
        item,
        phase3Keys.fixedCourtAgreementByCustomer(
          organizationId,
          customerId,
          startDate,
          agreementId,
        ),
      );
      await ensureIndex(
        item,
        phase3Keys.fixedCourtAgreementByOrganization(
          organizationId,
          startDate,
          agreementId,
        ),
      );
      if (item.status === 'ACTIVE') {
        await ensureIndex(
          item,
          phase3Keys.fixedCourtAgreementByCustomer(
            organizationId,
            customerId,
            startDate,
            agreementId,
            true,
          ),
        );
        await ensureIndex(
          item,
          phase3Keys.activeFixedCourtAgreementByOrganization(
            organizationId,
            startDate,
            agreementId,
          ),
        );
      }
      await ensureIndex(
        item,
        phase3Keys.customerCommercialRecord(
          organizationId,
          customerId,
          startDate,
          'FIXED_AGREEMENT',
          agreementId,
        ),
      );
    } else if (item.entity === 'fixedCourtOccurrence') {
      await ensureIndex(
        item,
        phase3Keys.fixedCourtOccurrenceByAgreement(
          String(item.agreementId),
          String(item.date),
          String(item.occurrenceId),
        ),
      );
      await ensureIndex(
        item,
        phase3Keys.customerCommercialRecord(
          organizationId,
          String(item.customerId),
          String(item.date),
          'FIXED_OCCURRENCE',
          String(item.occurrenceId),
        ),
      );
    } else if (item.entity === 'charge') {
      await ensureIndex(
        item,
        phase3Keys.customerCharge(
          organizationId,
          String(item.customerId),
          String(item.serviceAt),
          String(item.chargeId),
        ),
        true,
      );
    } else if (item.entity === 'payment') {
      await ensureIndex(
        item,
        phase3Keys.customerPayment(
          organizationId,
          String(item.customerId),
          String(item.paidAt),
          String(item.paymentId),
        ),
        true,
      );
    }
  }
  return { indexesCreated, financialIndexesCreated };
}
