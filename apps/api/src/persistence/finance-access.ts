import type { Repository, RecordItem } from '../db.js';
import { operationalKeys } from './operational-keys.js';

export type DateRange = { from?: string | undefined; to?: string | undefined };

/**
 * Bounded, organization-scoped reads for Financeiro. Charges, payments and
 * expenses are read from the denormalized organization partitions in
 * `operational-keys.ts` instead of scanning the table. Rows come back in the
 * shape of their source records (entity restored) so service code is shared
 * with the per-record paths. Ranges are date prefixes and only narrow the
 * Query; callers keep their exact post-filters.
 */
const loadIndex = async (
  repo: Repository,
  partition: { PK: string; SK: string },
  organizationId: string,
  indexEntity: string,
  entity: string,
  range: DateRange = {},
) => {
  const rows = await repo.query<RecordItem>(partition.PK, {
    ...(range.from || range.to
      ? {
          between: [
            `${partition.SK}${range.from ?? ''}`,
            `${partition.SK}${range.to ?? '￿'}￿`,
          ] as [string, string],
        }
      : { beginsWith: partition.SK }),
  });
  return rows
    .filter(
      (row) =>
        row.organizationId === organizationId && row.entity === indexEntity,
    )
    .map((row) => ({ ...row, entity }) as RecordItem);
};

export const loadOrganizationCharges = (
  repo: Repository,
  organizationId: string,
  range?: DateRange,
) =>
  loadIndex(
    repo,
    operationalKeys.organizationCharges(organizationId),
    organizationId,
    'organizationChargeIndex',
    'charge',
    range,
  );

export const loadOrganizationPayments = (
  repo: Repository,
  organizationId: string,
) =>
  loadIndex(
    repo,
    operationalKeys.organizationPayments(organizationId),
    organizationId,
    'organizationPaymentIndex',
    'payment',
  );

export const loadOrganizationExpenses = (
  repo: Repository,
  organizationId: string,
  range?: DateRange,
) =>
  loadIndex(
    repo,
    operationalKeys.organizationExpenses(organizationId),
    organizationId,
    'organizationExpenseIndex',
    'expense',
    range,
  );

export const loadOrganizationCustomers = async (
  repo: Repository,
  organizationId: string,
) =>
  (
    await repo.query<RecordItem>(`ORG#${organizationId}`, {
      beginsWith: 'CUSTOMER#',
    })
  ).filter(
    (row) => row.organizationId === organizationId && row.entity === 'customer',
  );
