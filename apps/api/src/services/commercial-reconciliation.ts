import type { AuthContext } from '@court-manager/contracts';
import type { Repository, RecordItem } from '../db.js';
import { buildServices } from './index.js';

export type CommercialReconciliationResult = {
  membershipsChecked: number;
  membershipsChanged: number;
  packagesChecked: number;
  packagesChanged: number;
};

/**
 * Re-evaluates persisted commercial records and materializes lifecycle
 * changes. Every underlying operation is idempotent, so this can be run by a
 * scheduler, a deploy hook, or an operator more than once.
 */
export async function reconcileCommercial(
  repo: Repository,
): Promise<CommercialReconciliationResult> {
  const services = buildServices(repo);
  const memberships = await repo.scan<RecordItem>(
    (item) => item.entity === 'membership',
  );
  const packages = await repo.scan<RecordItem>(
    (item) => item.entity === 'customerPackage',
  );
  const result: CommercialReconciliationResult = {
    membershipsChecked: memberships.length,
    membershipsChanged: 0,
    packagesChecked: packages.length,
    packagesChanged: 0,
  };

  for (const item of memberships) {
    const context: AuthContext = {
      organizationId: String(item.organizationId),
      userId: 'system-reconciliation',
      role: 'OWNER',
    };
    const current = await services.memberships.get(
      context,
      String(item.membershipId),
    );
    if (current.status !== item.status) result.membershipsChanged += 1;
  }
  for (const item of packages) {
    const context: AuthContext = {
      organizationId: String(item.organizationId),
      userId: 'system-reconciliation',
      role: 'OWNER',
    };
    const current = await services.packages.getCustomerPackage(
      context,
      String(item.customerPackageId),
    );
    if (current.status !== item.status) result.packagesChanged += 1;
  }
  return result;
}
