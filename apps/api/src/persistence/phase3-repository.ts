import { createHash } from 'node:crypto';
import type {
  Charge,
  CreditTransaction,
  CustomerCommercialActivityEvent,
  CustomerPackage,
  EntitlementAllocation,
  FixedCourtAgreement,
  FixedCourtOccurrence,
  Membership,
  MembershipPeriod,
  MakeupCredit,
  PackageDefinition,
  Payment,
  Plan,
} from '@court-manager/contracts';
import type { Key, RecordItem, Repository, Write } from '../db.js';
import { AppError } from '../errors.js';
import { phase3Keys } from './phase3-keys.js';

type OrganizationRecord = { organizationId: string };
type CommercialRecord = Record<string, unknown> & OrganizationRecord;
type IndexedRecord = RecordItem & CommercialRecord;
export type CommercialSourceType =
  'MEMBERSHIP' | 'PACKAGE' | 'MANUAL' | 'FIXED_AGREEMENT' | 'MAKEUP';

export type CreditBalanceRecord = RecordItem & {
  organizationId: string;
  customerId: string;
  sourceType: CommercialSourceType;
  sourceId: string;
  membershipPeriodId?: string;
  benefitId?: string;
  benefitPeriodKey?: string;
  unit: 'COURT_MINUTES' | 'SESSION' | 'GAME' | 'OCCURRENCE';
  quantityType: 'FINITE' | 'UNLIMITED';
  issuedQuantity: number;
  consumedQuantity: number;
  restoredQuantity: number;
  expiredQuantity: number;
  adjustedQuantity: number;
  remainingQuantity: number;
  expiresAt?: string;
  updatedAt: string;
};

export type CreditBalanceInput = {
  organizationId: string;
  customerId: string;
  sourceType: CommercialSourceType;
  sourceId: string;
  membershipPeriodId?: string;
  benefitId?: string;
  benefitPeriodKey?: string;
  unit: 'COURT_MINUTES' | 'SESSION' | 'GAME' | 'OCCURRENCE';
  quantityType: 'FINITE' | 'UNLIMITED';
  issuedQuantity: number;
  consumedQuantity: number;
  restoredQuantity: number;
  expiredQuantity: number;
  adjustedQuantity?: number;
  remainingQuantity: number;
  expiresAt?: string;
  updatedAt: string;
};

export type ConsumeEntitlementInput = {
  organizationId: string;
  customerId: string;
  sourceType: CommercialSourceType;
  sourceId: string;
  membershipPeriodId?: string;
  benefitId?: string;
  benefitPeriodKey?: string;
  activityType:
    | 'RESERVATION'
    | 'CLASS_ATTENDANCE'
    | 'PRIVATE_LESSON'
    | 'OPEN_GAME'
    | 'FIXED_COURT_OCCURRENCE';
  activityId: string;
  unit: 'COURT_MINUTES' | 'SESSION' | 'GAME' | 'OCCURRENCE';
  quantity: number;
  coveredAmount: number;
  currency: string;
  createdBy: string;
  occurredAt: string;
  createdAt: string;
  allocationId?: string;
};

export type ConsumeEntitlementResult = {
  allocation: EntitlementAllocation;
  duplicate: boolean;
};

export type LedgerTransaction = CreditTransaction & {
  membershipPeriodId?: string;
};

export type AppendCreditTransactionInput = {
  transaction: LedgerTransaction;
  balance: CreditBalanceInput;
  previousBalance?: CreditBalanceRecord;
};

export type AppendCreditTransactionResult = {
  transaction: CreditTransaction;
  duplicate: boolean;
};

export interface Phase3Persistence {
  putPlan(plan: Plan, previous?: Plan): Promise<void>;
  getPlan(organizationId: string, planId: string): Promise<Plan | undefined>;
  listPlans(
    organizationId: string,
    options?: { status?: Plan['status']; limit?: number },
  ): Promise<Plan[]>;
  putMembership(membership: Membership, previous?: Membership): Promise<void>;
  advanceMembership(input: {
    membership: Membership;
    previousMembership: Membership;
    completedPreviousPeriod: MembershipPeriod;
    previousPeriod: MembershipPeriod;
    nextPeriod: MembershipPeriod;
  }): Promise<void>;
  getMembership(
    organizationId: string,
    membershipId: string,
  ): Promise<Membership | undefined>;
  listMembershipsByCustomer(
    organizationId: string,
    customerId: string,
    options?: { activeOnly?: boolean; limit?: number },
  ): Promise<Membership[]>;
  listMembershipsByOrganization(
    organizationId: string,
    limit?: number,
  ): Promise<Membership[]>;
  listMembershipsByPlan(
    organizationId: string,
    planId: string,
    limit?: number,
  ): Promise<Membership[]>;
  listMembershipsRenewing(
    organizationId: string,
    from: string,
    to: string,
    limit?: number,
  ): Promise<Membership[]>;
  listMembershipsExpiring(
    organizationId: string,
    from: string,
    to: string,
    limit?: number,
  ): Promise<Membership[]>;
  listMembershipsByStatus(
    organizationId: string,
    status: Membership['status'],
    limit?: number,
  ): Promise<Membership[]>;
  putMembershipPeriod(
    period: MembershipPeriod,
    previous?: MembershipPeriod,
  ): Promise<void>;
  getMembershipPeriod(
    organizationId: string,
    periodId: string,
  ): Promise<MembershipPeriod | undefined>;
  listMembershipPeriods(
    organizationId: string,
    membershipId: string,
    limit?: number,
  ): Promise<MembershipPeriod[]>;
  putPackageDefinition(
    definition: PackageDefinition,
    previous?: PackageDefinition,
  ): Promise<void>;
  getPackageDefinition(
    organizationId: string,
    packageDefinitionId: string,
  ): Promise<PackageDefinition | undefined>;
  listPackageDefinitions(
    organizationId: string,
    options?: { status?: PackageDefinition['status']; limit?: number },
  ): Promise<PackageDefinition[]>;
  putCustomerPackage(
    customerPackage: CustomerPackage,
    previous?: CustomerPackage,
  ): Promise<void>;
  putMakeupCredit(credit: MakeupCredit, previous?: MakeupCredit): Promise<void>;
  getMakeupCredit(
    organizationId: string,
    makeupCreditId: string,
  ): Promise<MakeupCredit | undefined>;
  listMakeupCreditsByCustomer(
    organizationId: string,
    customerId: string,
    options?: { activeOnly?: boolean; limit?: number },
  ): Promise<MakeupCredit[]>;
  issueCustomerPackage(input: {
    customerPackage: CustomerPackage;
    charge: Charge;
  }): Promise<void>;
  getCustomerPackage(
    organizationId: string,
    customerPackageId: string,
  ): Promise<CustomerPackage | undefined>;
  listPackagesByCustomer(
    organizationId: string,
    customerId: string,
    options?: { activeOnly?: boolean; limit?: number },
  ): Promise<CustomerPackage[]>;
  listPackagesByOrganization(
    organizationId: string,
    limit?: number,
  ): Promise<CustomerPackage[]>;
  listPackagesExpiring(
    organizationId: string,
    from: string,
    to: string,
    limit?: number,
  ): Promise<CustomerPackage[]>;
  putCreditTransaction(
    transaction: CreditTransaction,
    previous?: CreditTransaction,
  ): Promise<void>;
  listCreditTransactionsByPackage(
    organizationId: string,
    customerPackageId: string,
    limit?: number,
  ): Promise<CreditTransaction[]>;
  listCreditTransactionsBySource(
    organizationId: string,
    sourceType: CreditBalanceRecord['sourceType'],
    sourceId: string,
    limit?: number,
  ): Promise<CreditTransaction[]>;
  getCreditTransaction(
    organizationId: string,
    creditTransactionId: string,
  ): Promise<CreditTransaction | undefined>;
  listCreditTransactionsByMembershipPeriod(
    organizationId: string,
    membershipPeriodId: string,
    limit?: number,
  ): Promise<CreditTransaction[]>;
  putCreditBalance(
    balance: CreditBalanceInput,
    previous?: CreditBalanceRecord,
  ): Promise<void>;
  putCreditBalanceIfAbsent(balance: CreditBalanceInput): Promise<void>;
  appendCreditTransaction(
    input: AppendCreditTransactionInput,
  ): Promise<AppendCreditTransactionResult>;
  getCreditBalance(input: {
    organizationId?: string;
    customerId?: string;
    sourceType: CreditBalanceRecord['sourceType'];
    sourceId: string;
    membershipPeriodId?: string;
    benefitId?: string;
    benefitPeriodKey?: string;
  }): Promise<CreditBalanceRecord | undefined>;
  listCreditBalancesByCustomer(
    organizationId: string,
    customerId: string,
    limit?: number,
  ): Promise<CreditBalanceRecord[]>;
  listCreditBalancesBySource(
    organizationId: string,
    sourceType: CreditBalanceRecord['sourceType'],
    sourceId: string,
    limit?: number,
  ): Promise<CreditBalanceRecord[]>;
  putEntitlementAllocation(
    allocation: EntitlementAllocation,
    previous?: EntitlementAllocation,
  ): Promise<void>;
  getEntitlementAllocation(
    organizationId: string,
    allocationId: string,
  ): Promise<EntitlementAllocation | undefined>;
  listAllocationsByActivity(
    organizationId: string,
    activityType: EntitlementAllocation['activityType'],
    activityId: string,
    limit?: number,
  ): Promise<EntitlementAllocation[]>;
  consumeEntitlement(
    input: ConsumeEntitlementInput,
  ): Promise<ConsumeEntitlementResult>;
  putFixedCourtAgreement(
    agreement: FixedCourtAgreement,
    previous?: FixedCourtAgreement,
  ): Promise<void>;
  getFixedCourtAgreement(
    organizationId: string,
    agreementId: string,
  ): Promise<FixedCourtAgreement | undefined>;
  listFixedCourtAgreementsByCustomer(
    organizationId: string,
    customerId: string,
    options?: { activeOnly?: boolean; limit?: number },
  ): Promise<FixedCourtAgreement[]>;
  listActiveFixedCourtAgreementsByOrganization(
    organizationId: string,
    limit?: number,
  ): Promise<FixedCourtAgreement[]>;
  listFixedCourtAgreementsByOrganization(
    organizationId: string,
    limit?: number,
  ): Promise<FixedCourtAgreement[]>;
  putFixedCourtOccurrence(
    occurrence: FixedCourtOccurrence,
    previous?: FixedCourtOccurrence,
  ): Promise<void>;
  listFixedCourtOccurrencesByAgreement(
    organizationId: string,
    agreementId: string,
    limit?: number,
  ): Promise<FixedCourtOccurrence[]>;
  listCustomerCommercialRecords(
    organizationId: string,
    customerId: string,
    limit?: number,
  ): Promise<RecordItem[]>;
  putCustomerActivityEvent(
    event: CustomerCommercialActivityEvent,
  ): Promise<CustomerCommercialActivityEvent>;
  listCustomerActivityEvents(
    organizationId: string,
    customerId: string,
    options?: {
      from?: string;
      to?: string;
      eventTypes?: CustomerCommercialActivityEvent['eventType'][];
      limit?: number;
    },
  ): Promise<CustomerCommercialActivityEvent[]>;
  listCustomerCharges(
    organizationId: string,
    customerId: string,
    limit?: number,
  ): Promise<Charge[]>;
  listCustomerPayments(
    organizationId: string,
    customerId: string,
    limit?: number,
  ): Promise<Payment[]>;
  indexCharge(charge: Charge | IndexedRecord): Promise<void>;
  indexPayment(payment: Payment | IndexedRecord): Promise<void>;
}

const stripMetadata = (item: Record<string, unknown>) => {
  const value = { ...item };
  delete value.PK;
  delete value.SK;
  delete value.entity;
  return value;
};

const indexItem = (item: Record<string, unknown>, key: Key): RecordItem => ({
  ...stripMetadata(item),
  ...key,
});

const asDomain = <T>(item: RecordItem) => stripMetadata(item) as T;
const keyString = (key: Key) => `${key.PK}|${key.SK}`;
const dateRange = (
  prefix: string,
  from: string,
  to: string,
): [string, string] => [`${prefix}${from}`, `${prefix}${to}\uffff`];

export class Phase3Repository implements Phase3Persistence {
  constructor(private readonly repo: Repository) {}

  async putCustomerActivityEvent(event: CustomerCommercialActivityEvent) {
    const primary = {
      ...event,
      ...phase3Keys.customerActivityEvent(event.eventId),
      entity: 'customerActivityEvent' as const,
    } as RecordItem;
    const customerIndex = {
      ...event,
      ...phase3Keys.customerActivityEventByCustomer(
        event.organizationId,
        event.customerId,
        event.occurredAt,
        event.eventType,
        event.eventId,
      ),
      entity: 'customerActivityEvent' as const,
    } as RecordItem;
    try {
      await this.repo.transactWrite([
        {
          type: 'put',
          item: primary,
          condition: 'attribute_not_exists(PK)',
        },
        { type: 'put', item: customerIndex },
      ]);
    } catch (error) {
      const existing = await this.repo.get<RecordItem>(
        phase3Keys.customerActivityEvent(event.eventId),
      );
      if (
        existing &&
        existing.organizationId === event.organizationId &&
        existing.customerId === event.customerId &&
        existing.eventType === event.eventType &&
        existing.sourceType === event.sourceType &&
        existing.sourceId === event.sourceId
      )
        return asDomain<CustomerCommercialActivityEvent>(existing);
      throw error;
    }
    return event;
  }

  async listCustomerActivityEvents(
    organizationId: string,
    customerId: string,
    options: {
      from?: string;
      to?: string;
      eventTypes?: CustomerCommercialActivityEvent['eventType'][];
      limit?: number;
    } = {},
  ) {
    const rows = await this.repo.query<RecordItem>(
      phase3Keys.customerActivityEventsByCustomer(organizationId, customerId)
        .PK,
      {
        ...(options.from || options.to
          ? {
              between: [
                `ACTIVITY#${options.from ?? '0000-01-01T00:00:00.000Z'}#COMMERCIAL#`,
                `ACTIVITY#${options.to ?? '9999-12-31T23:59:59.999Z'}#COMMERCIAL#~`,
              ] as [string, string],
            }
          : { beginsWith: 'ACTIVITY#' }),
        limit: options.limit ?? 100,
      },
    );
    return rows
      .filter(
        (row) =>
          row.entity === 'customerActivityEvent' &&
          row.organizationId === organizationId &&
          row.customerId === customerId,
      )
      .filter(
        (row) =>
          !options.eventTypes?.length ||
          options.eventTypes.includes(
            row.eventType as CustomerCommercialActivityEvent['eventType'],
          ),
      )
      .map(asDomain<CustomerCommercialActivityEvent>);
  }

  private async replace(
    source: RecordItem,
    previous: RecordItem | undefined,
    currentIndexes: Key[],
    previousIndexes: Key[] = [],
    sourceCondition?: string,
  ) {
    const unique = (keys: Key[]) => [
      ...new Map(keys.map((key) => [keyString(key), key])).values(),
    ];
    const nextIndexes = unique(currentIndexes);
    const oldIndexes = unique(previousIndexes);
    const current = new Set(nextIndexes.map(keyString));
    const writes: Write[] = [
      {
        type: 'put',
        item: source,
        ...(previous
          ? {
              expected:
                previous.updatedAt === undefined
                  ? { createdAt: previous.createdAt }
                  : { updatedAt: previous.updatedAt },
            }
          : {}),
        ...(sourceCondition ? { condition: sourceCondition } : {}),
      },
      ...nextIndexes.map((key) => ({
        type: 'put' as const,
        item: indexItem(source, key),
      })),
      ...oldIndexes
        .filter((key) => !current.has(keyString(key)))
        .map((key) => ({ type: 'delete' as const, key })),
    ];
    await this.repo.transactWrite(writes);
  }

  private async queryDomains<T>(
    pk: string,
    opts: Parameters<Repository['query']>[1],
  ): Promise<T[]> {
    return (await this.repo.query<RecordItem>(pk, opts)).map(asDomain<T>);
  }

  async putPlan(plan: Plan, previous?: Plan) {
    const current = phase3Keys.organizationPlan(
      plan.organizationId,
      plan.createdAt,
      plan.planId,
    );
    await this.replace(
      { ...plan, ...phase3Keys.plan(plan.planId), entity: 'plan' },
      previous
        ? { ...previous, ...phase3Keys.plan(previous.planId), entity: 'plan' }
        : undefined,
      [
        current,
        phase3Keys.organizationPlanStatus(
          plan.organizationId,
          plan.status,
          plan.createdAt,
          plan.planId,
        ),
      ],
      previous
        ? [
            phase3Keys.organizationPlan(
              previous.organizationId,
              previous.createdAt,
              previous.planId,
            ),
            phase3Keys.organizationPlanStatus(
              previous.organizationId,
              previous.status,
              previous.createdAt,
              previous.planId,
            ),
          ]
        : [],
    );
  }

  async getPlan(organizationId: string, planId: string) {
    const item = await this.repo.get<RecordItem>(phase3Keys.plan(planId));
    return item?.organizationId === organizationId
      ? asDomain<Plan>(item)
      : undefined;
  }

  async listPlans(
    organizationId: string,
    options: { status?: Plan['status']; limit?: number } = {},
  ) {
    const prefix = options.status ? `PLAN_STATUS#${options.status}#` : 'PLAN#';
    return this.queryDomains<Plan>(
      phase3Keys.organizationPlans(organizationId).PK,
      { beginsWith: prefix, limit: options.limit ?? 100 },
    ).then((items) =>
      items.filter((item) => item.organizationId === organizationId),
    );
  }

  private membershipIndexes(membership: Membership) {
    return [
      phase3Keys.membershipByCustomer(
        membership.organizationId,
        membership.customerId,
        membership.startDate,
        membership.membershipId,
      ),
      phase3Keys.membershipByCustomer(
        membership.organizationId,
        membership.customerId,
        membership.startDate,
        membership.membershipId,
        membership.status === 'ACTIVE',
      ),
      phase3Keys.membershipByPlan(
        membership.planId,
        membership.startDate,
        membership.membershipId,
      ),
      phase3Keys.membershipByOrganization(
        membership.organizationId,
        membership.startDate,
        membership.membershipId,
      ),
      phase3Keys.membershipStatus(
        membership.organizationId,
        membership.status,
        membership.startDate,
        membership.membershipId,
      ),
      ...(membership.nextRenewalDate
        ? [
            phase3Keys.membershipRenewal(
              membership.organizationId,
              membership.nextRenewalDate,
              membership.membershipId,
            ),
          ]
        : []),
      phase3Keys.membershipExpiry(
        membership.organizationId,
        membership.currentPeriodEnd,
        membership.membershipId,
      ),
      phase3Keys.customerCommercialRecord(
        membership.organizationId,
        membership.customerId,
        membership.startDate,
        'MEMBERSHIP',
        membership.membershipId,
      ),
    ];
  }

  private membershipWrites(
    membership: Membership,
    previous?: Membership,
  ): Write[] {
    const currentIndexes = this.membershipIndexes(membership);
    const previousIndexes = previous ? this.membershipIndexes(previous) : [];
    const current = new Set(currentIndexes.map(keyString));
    const source = {
      ...membership,
      ...phase3Keys.membership(membership.membershipId),
      entity: 'membership' as const,
    } as RecordItem;
    return [
      {
        type: 'put',
        item: source,
        ...(previous
          ? {
              expected:
                previous.updatedAt === undefined
                  ? { createdAt: previous.createdAt }
                  : { updatedAt: previous.updatedAt },
            }
          : {}),
      },
      ...currentIndexes.map((key) => ({
        type: 'put' as const,
        item: indexItem(source, key),
      })),
      ...previousIndexes
        .filter((key) => !current.has(keyString(key)))
        .map((key) => ({ type: 'delete' as const, key })),
    ];
  }

  private membershipPeriodWrites(
    period: MembershipPeriod,
    previous?: MembershipPeriod,
  ): Write[] {
    const source = {
      ...period,
      ...phase3Keys.membershipPeriodById(period.membershipPeriodId),
      entity: 'membershipPeriod' as const,
    } as RecordItem;
    const current = phase3Keys.membershipPeriod(
      period.membershipId,
      period.membershipPeriodId,
    );
    const old = previous
      ? phase3Keys.membershipPeriod(
          previous.membershipId,
          previous.membershipPeriodId,
        )
      : undefined;
    return [
      {
        type: 'put',
        item: source,
        ...(previous
          ? {
              expected:
                previous.updatedAt === undefined
                  ? { createdAt: previous.createdAt }
                  : { updatedAt: previous.updatedAt },
            }
          : { condition: 'attribute_not_exists(PK)' }),
      },
      { type: 'put', item: { ...source, ...current } },
      ...(old && keyString(old) !== keyString(current)
        ? [{ type: 'delete' as const, key: old }]
        : []),
    ];
  }

  async putMembership(membership: Membership, previous?: Membership) {
    await this.repo.transactWrite(this.membershipWrites(membership, previous));
  }

  async advanceMembership({
    membership,
    previousMembership,
    completedPreviousPeriod,
    previousPeriod,
    nextPeriod,
  }: {
    membership: Membership;
    previousMembership: Membership;
    completedPreviousPeriod: MembershipPeriod;
    previousPeriod: MembershipPeriod;
    nextPeriod: MembershipPeriod;
  }) {
    await this.repo.transactWrite([
      ...this.membershipWrites(membership, previousMembership),
      ...this.membershipPeriodWrites(completedPreviousPeriod, previousPeriod),
      ...this.membershipPeriodWrites(nextPeriod),
    ]);
  }

  async getMembership(organizationId: string, membershipId: string) {
    const item = await this.repo.get<RecordItem>(
      phase3Keys.membership(membershipId),
    );
    return item?.organizationId === organizationId
      ? asDomain<Membership>(item)
      : undefined;
  }

  async listMembershipsByCustomer(
    organizationId: string,
    customerId: string,
    options: { activeOnly?: boolean; limit?: number } = {},
  ) {
    return this.queryDomains<Membership>(
      phase3Keys.customerCommercial(organizationId, customerId).PK,
      {
        beginsWith: options.activeOnly ? 'MEMBERSHIP_ACTIVE#' : 'MEMBERSHIP#',
        limit: options.limit ?? 100,
      },
    ).then((items) =>
      items.filter(
        (item) =>
          item.organizationId === organizationId &&
          item.customerId === customerId,
      ),
    );
  }

  async listMembershipsByOrganization(organizationId: string, limit = 100) {
    return this.queryDomains<Membership>(
      phase3Keys.membershipByOrganization(organizationId, '', '').PK,
      { beginsWith: 'MEMBERSHIP#', limit },
    ).then((items) =>
      items.filter((item) => item.organizationId === organizationId),
    );
  }

  async listMembershipsByPlan(
    organizationId: string,
    planId: string,
    limit = 100,
  ) {
    return this.queryDomains<Membership>(
      phase3Keys.membershipByPlan(planId, '', '').PK,
      { beginsWith: 'MEMBERSHIP#', limit },
    ).then((items) =>
      items.filter((item) => item.organizationId === organizationId),
    );
  }

  async listMembershipsRenewing(
    organizationId: string,
    from: string,
    to: string,
    limit = 100,
  ) {
    return this.queryDomains<Membership>(
      phase3Keys.membershipRenewal(organizationId, '', '').PK,
      { between: dateRange('MEMBERSHIP_RENEWAL#', from, to), limit },
    ).then((items) =>
      items.filter((item) => item.organizationId === organizationId),
    );
  }

  async listMembershipsExpiring(
    organizationId: string,
    from: string,
    to: string,
    limit = 100,
  ) {
    return this.queryDomains<Membership>(
      phase3Keys.membershipExpiry(organizationId, '', '').PK,
      { between: dateRange('MEMBERSHIP_EXPIRY#', from, to), limit },
    ).then((items) =>
      items.filter((item) => item.organizationId === organizationId),
    );
  }

  async listMembershipsByStatus(
    organizationId: string,
    status: Membership['status'],
    limit = 100,
  ) {
    return this.queryDomains<Membership>(
      phase3Keys.membershipStatus(organizationId, status, '', '').PK,
      { beginsWith: `MEMBERSHIP_STATUS#${status}#`, limit },
    ).then((items) =>
      items.filter((item) => item.organizationId === organizationId),
    );
  }

  async putMembershipPeriod(
    period: MembershipPeriod,
    previous?: MembershipPeriod,
  ) {
    const current = phase3Keys.membershipPeriod(
      period.membershipId,
      period.membershipPeriodId,
    );
    const old = previous
      ? phase3Keys.membershipPeriod(
          previous.membershipId,
          previous.membershipPeriodId,
        )
      : undefined;
    await this.replace(
      {
        ...period,
        ...phase3Keys.membershipPeriodById(period.membershipPeriodId),
        entity: 'membershipPeriod',
      },
      previous
        ? {
            ...previous,
            ...phase3Keys.membershipPeriodById(previous.membershipPeriodId),
            entity: 'membershipPeriod',
          }
        : undefined,
      [current],
      old ? [old] : [],
    );
  }

  async getMembershipPeriod(organizationId: string, periodId: string) {
    const item = await this.repo.get<RecordItem>(
      phase3Keys.membershipPeriodById(periodId),
    );
    return item?.organizationId === organizationId
      ? asDomain<MembershipPeriod>(item)
      : undefined;
  }

  async listMembershipPeriods(
    organizationId: string,
    membershipId: string,
    limit = 100,
  ) {
    return this.queryDomains<MembershipPeriod>(
      phase3Keys.membershipPeriods(membershipId).PK,
      { beginsWith: 'PERIOD#', limit },
    ).then((items) =>
      items.filter((item) => item.organizationId === organizationId),
    );
  }

  async putPackageDefinition(
    definition: PackageDefinition,
    previous?: PackageDefinition,
  ) {
    const current = [
      phase3Keys.organizationPackageDefinition(
        definition.organizationId,
        definition.createdAt,
        definition.packageDefinitionId,
      ),
      phase3Keys.organizationPackageDefinitionStatus(
        definition.organizationId,
        definition.status,
        definition.createdAt,
        definition.packageDefinitionId,
      ),
    ];
    const old = previous
      ? [
          phase3Keys.organizationPackageDefinition(
            previous.organizationId,
            previous.createdAt,
            previous.packageDefinitionId,
          ),
          phase3Keys.organizationPackageDefinitionStatus(
            previous.organizationId,
            previous.status,
            previous.createdAt,
            previous.packageDefinitionId,
          ),
        ]
      : [];
    await this.replace(
      {
        ...definition,
        ...phase3Keys.packageDefinition(definition.packageDefinitionId),
        entity: 'packageDefinition',
      },
      previous
        ? {
            ...previous,
            ...phase3Keys.packageDefinition(previous.packageDefinitionId),
            entity: 'packageDefinition',
          }
        : undefined,
      current,
      old,
    );
  }

  async getPackageDefinition(
    organizationId: string,
    packageDefinitionId: string,
  ) {
    const item = await this.repo.get<RecordItem>(
      phase3Keys.packageDefinition(packageDefinitionId),
    );
    return item?.organizationId === organizationId
      ? asDomain<PackageDefinition>(item)
      : undefined;
  }

  async listPackageDefinitions(
    organizationId: string,
    options: { status?: PackageDefinition['status']; limit?: number } = {},
  ) {
    const prefix = options.status
      ? `PACKAGE_DEFINITION_STATUS#${options.status}#`
      : 'PACKAGE_DEFINITION#';
    return this.queryDomains<PackageDefinition>(
      phase3Keys.organizationPackageDefinitions(organizationId).PK,
      { beginsWith: prefix, limit: options.limit ?? 100 },
    ).then((items) =>
      items.filter((item) => item.organizationId === organizationId),
    );
  }

  async putCustomerPackage(
    customerPackage: CustomerPackage,
    previous?: CustomerPackage,
  ) {
    const current = [
      phase3Keys.packageByOrganization(
        customerPackage.organizationId,
        customerPackage.startsAt,
        customerPackage.customerPackageId,
      ),
      phase3Keys.customerPackageByCustomer(
        customerPackage.organizationId,
        customerPackage.customerId,
        customerPackage.startsAt,
        customerPackage.customerPackageId,
      ),
      phase3Keys.customerPackageByCustomer(
        customerPackage.organizationId,
        customerPackage.customerId,
        customerPackage.startsAt,
        customerPackage.customerPackageId,
        customerPackage.status === 'ACTIVE',
      ),
      ...(customerPackage.expiresAt
        ? [
            phase3Keys.packageExpiry(
              customerPackage.organizationId,
              customerPackage.expiresAt,
              customerPackage.customerPackageId,
            ),
          ]
        : []),
      phase3Keys.customerCommercialRecord(
        customerPackage.organizationId,
        customerPackage.customerId,
        customerPackage.startsAt,
        'PACKAGE',
        customerPackage.customerPackageId,
      ),
    ];
    const old = previous
      ? [
          phase3Keys.packageByOrganization(
            previous.organizationId,
            previous.startsAt,
            previous.customerPackageId,
          ),
          phase3Keys.customerPackageByCustomer(
            previous.organizationId,
            previous.customerId,
            previous.startsAt,
            previous.customerPackageId,
          ),
          phase3Keys.customerPackageByCustomer(
            previous.organizationId,
            previous.customerId,
            previous.startsAt,
            previous.customerPackageId,
            previous.status === 'ACTIVE',
          ),
          ...(previous.expiresAt
            ? [
                phase3Keys.packageExpiry(
                  previous.organizationId,
                  previous.expiresAt,
                  previous.customerPackageId,
                ),
              ]
            : []),
          phase3Keys.customerCommercialRecord(
            previous.organizationId,
            previous.customerId,
            previous.startsAt,
            'PACKAGE',
            previous.customerPackageId,
          ),
        ]
      : [];
    await this.replace(
      {
        ...customerPackage,
        ...phase3Keys.customerPackage(customerPackage.customerPackageId),
        entity: 'customerPackage',
      },
      previous
        ? {
            ...previous,
            ...phase3Keys.customerPackage(previous.customerPackageId),
            entity: 'customerPackage',
          }
        : undefined,
      current,
      old,
    );
  }

  /**
   * Creates the customer-owned package and its purchase charge in one
   * transaction. Credit ledgers are added by the service in deterministic,
   * per-benefit writes because DynamoDB transactions are limited to 100
   * actions and a definition may contain up to 50 benefits.
   */
  async issueCustomerPackage({
    customerPackage,
    charge,
  }: {
    customerPackage: CustomerPackage;
    charge: Charge;
  }) {
    const packageIndexes = [
      phase3Keys.packageByOrganization(
        customerPackage.organizationId,
        customerPackage.startsAt,
        customerPackage.customerPackageId,
      ),
      phase3Keys.customerPackageByCustomer(
        customerPackage.organizationId,
        customerPackage.customerId,
        customerPackage.startsAt,
        customerPackage.customerPackageId,
      ),
      phase3Keys.customerPackageByCustomer(
        customerPackage.organizationId,
        customerPackage.customerId,
        customerPackage.startsAt,
        customerPackage.customerPackageId,
        true,
      ),
      ...(customerPackage.expiresAt
        ? [
            phase3Keys.packageExpiry(
              customerPackage.organizationId,
              customerPackage.expiresAt,
              customerPackage.customerPackageId,
            ),
          ]
        : []),
      phase3Keys.customerCommercialRecord(
        customerPackage.organizationId,
        customerPackage.customerId,
        customerPackage.startsAt,
        'PACKAGE',
        customerPackage.customerPackageId,
      ),
    ];
    const packageSource = {
      ...customerPackage,
      ...phase3Keys.customerPackage(customerPackage.customerPackageId),
      entity: 'customerPackage' as const,
    } as RecordItem;
    const chargeSource = {
      ...charge,
      PK: `CHARGE#${charge.chargeId}`,
      SK: 'META',
      entity: 'charge' as const,
    } as RecordItem;
    const chargeIndex = indexItem(
      charge,
      phase3Keys.customerCharge(
        charge.organizationId,
        charge.customerId,
        charge.serviceAt,
        charge.chargeId,
      ),
    );
    await this.repo.transactWrite([
      {
        type: 'put',
        item: packageSource,
        condition: 'attribute_not_exists(PK)',
      },
      ...packageIndexes.map((key) => ({
        type: 'put' as const,
        item: indexItem(packageSource, key),
      })),
      {
        type: 'put',
        item: chargeSource,
        condition: 'attribute_not_exists(PK)',
      },
      { type: 'put', item: chargeIndex },
    ]);
  }

  async putMakeupCredit(credit: MakeupCredit, previous?: MakeupCredit) {
    const current = [
      phase3Keys.makeupCreditByCustomer(
        credit.organizationId,
        credit.customerId,
        credit.issuedAt,
        credit.makeupCreditId,
      ),
      ...(credit.status === 'ACTIVE'
        ? [
            phase3Keys.makeupCreditByCustomer(
              credit.organizationId,
              credit.customerId,
              credit.issuedAt,
              credit.makeupCreditId,
              true,
            ),
          ]
        : []),
      phase3Keys.makeupCreditByOrigin(
        credit.organizationId,
        credit.originSessionId,
        credit.issuedAt,
        credit.makeupCreditId,
      ),
      phase3Keys.customerCommercialRecord(
        credit.organizationId,
        credit.customerId,
        credit.issuedAt,
        'MAKEUP_CREDIT',
        credit.makeupCreditId,
      ),
    ];
    const old = previous
      ? [
          phase3Keys.makeupCreditByCustomer(
            previous.organizationId,
            previous.customerId,
            previous.issuedAt,
            previous.makeupCreditId,
          ),
          ...(previous.status === 'ACTIVE'
            ? [
                phase3Keys.makeupCreditByCustomer(
                  previous.organizationId,
                  previous.customerId,
                  previous.issuedAt,
                  previous.makeupCreditId,
                  true,
                ),
              ]
            : []),
          phase3Keys.makeupCreditByOrigin(
            previous.organizationId,
            previous.originSessionId,
            previous.issuedAt,
            previous.makeupCreditId,
          ),
          phase3Keys.customerCommercialRecord(
            previous.organizationId,
            previous.customerId,
            previous.issuedAt,
            'MAKEUP_CREDIT',
            previous.makeupCreditId,
          ),
        ]
      : [];
    await this.replace(
      {
        ...credit,
        ...phase3Keys.makeupCredit(credit.makeupCreditId),
        entity: 'makeupCredit',
      },
      previous
        ? {
            ...previous,
            ...phase3Keys.makeupCredit(previous.makeupCreditId),
            entity: 'makeupCredit',
          }
        : undefined,
      current,
      old,
      previous ? undefined : 'attribute_not_exists(PK)',
    );
  }

  async getMakeupCredit(organizationId: string, makeupCreditId: string) {
    const item = await this.repo.get<RecordItem>(
      phase3Keys.makeupCredit(makeupCreditId),
    );
    return item?.organizationId === organizationId
      ? asDomain<MakeupCredit>(item)
      : undefined;
  }

  async listMakeupCreditsByCustomer(
    organizationId: string,
    customerId: string,
    options: { activeOnly?: boolean; limit?: number } = {},
  ) {
    return this.queryDomains<MakeupCredit>(
      phase3Keys.customerCommercial(organizationId, customerId).PK,
      {
        beginsWith: options.activeOnly
          ? 'MAKEUP_CREDIT_ACTIVE#'
          : 'MAKEUP_CREDIT#',
        limit: options.limit ?? 100,
      },
    ).then((items) =>
      items.filter(
        (item) =>
          item.organizationId === organizationId &&
          item.customerId === customerId,
      ),
    );
  }

  async getCustomerPackage(organizationId: string, customerPackageId: string) {
    const item = await this.repo.get<RecordItem>(
      phase3Keys.customerPackage(customerPackageId),
    );
    return item?.organizationId === organizationId
      ? asDomain<CustomerPackage>(item)
      : undefined;
  }

  async listPackagesByCustomer(
    organizationId: string,
    customerId: string,
    options: { activeOnly?: boolean; limit?: number } = {},
  ) {
    return this.queryDomains<CustomerPackage>(
      phase3Keys.customerCommercial(organizationId, customerId).PK,
      {
        beginsWith: options.activeOnly ? 'PACKAGE_ACTIVE#' : 'PACKAGE#',
        limit: options.limit ?? 100,
      },
    ).then((items) =>
      items.filter(
        (item) =>
          item.organizationId === organizationId &&
          item.customerId === customerId,
      ),
    );
  }

  async listPackagesByOrganization(organizationId: string, limit = 100) {
    return this.queryDomains<CustomerPackage>(
      phase3Keys.organizationPackages(organizationId).PK,
      { beginsWith: 'PACKAGE#', limit },
    ).then((items) =>
      items.filter((item) => item.organizationId === organizationId),
    );
  }

  async listPackagesExpiring(
    organizationId: string,
    from: string,
    to: string,
    limit = 100,
  ) {
    return this.queryDomains<CustomerPackage>(
      phase3Keys.packageExpiry(organizationId, '', '').PK,
      { between: dateRange('PACKAGE_EXPIRY#', from, to), limit },
    ).then((items) =>
      items.filter((item) => item.organizationId === organizationId),
    );
  }

  async putCreditTransaction(
    transaction: CreditTransaction,
    previous?: CreditTransaction,
  ) {
    const sourceIndex = phase3Keys.creditTransactionBySource(
      transaction.sourceType,
      transaction.sourceId,
      transaction.occurredAt,
      transaction.creditTransactionId,
    );
    const current = [
      sourceIndex,
      ...(transaction.membershipPeriodId
        ? [
            phase3Keys.creditTransactionByMembershipPeriod(
              transaction.membershipPeriodId,
              transaction.occurredAt,
              transaction.creditTransactionId,
            ),
          ]
        : []),
      phase3Keys.customerCommercialRecord(
        transaction.organizationId,
        transaction.customerId,
        transaction.occurredAt,
        'CREDIT',
        transaction.creditTransactionId,
      ),
    ];
    const old = previous
      ? [
          phase3Keys.creditTransactionBySource(
            previous.sourceType,
            previous.sourceId,
            previous.occurredAt,
            previous.creditTransactionId,
          ),
          ...(previous.membershipPeriodId
            ? [
                phase3Keys.creditTransactionByMembershipPeriod(
                  previous.membershipPeriodId,
                  previous.occurredAt,
                  previous.creditTransactionId,
                ),
              ]
            : []),
          phase3Keys.customerCommercialRecord(
            previous.organizationId,
            previous.customerId,
            previous.occurredAt,
            'CREDIT',
            previous.creditTransactionId,
          ),
        ]
      : [];
    await this.replace(
      {
        ...transaction,
        ...phase3Keys.creditTransaction(transaction.creditTransactionId),
        entity: 'creditTransaction',
      },
      previous
        ? {
            ...previous,
            ...phase3Keys.creditTransaction(previous.creditTransactionId),
            entity: 'creditTransaction',
          }
        : undefined,
      current,
      old,
      previous ? undefined : 'attribute_not_exists(PK)',
    );
  }

  async listCreditTransactionsByPackage(
    organizationId: string,
    customerPackageId: string,
    limit = 100,
  ) {
    return this.listCreditTransactionsBySource(
      organizationId,
      'PACKAGE',
      customerPackageId,
      limit,
    );
  }

  async listCreditTransactionsBySource(
    organizationId: string,
    sourceType: CreditBalanceRecord['sourceType'],
    sourceId: string,
    limit = 100,
  ) {
    return this.queryDomains<CreditTransaction>(
      phase3Keys.creditTransactionsBySource(sourceType, sourceId).PK,
      { beginsWith: 'CREDIT#', limit },
    ).then((items) =>
      items.filter((item) => item.organizationId === organizationId),
    );
  }

  async getCreditTransaction(
    organizationId: string,
    creditTransactionId: string,
  ) {
    const item = await this.repo.get<RecordItem>(
      phase3Keys.creditTransaction(creditTransactionId),
    );
    return item?.organizationId === organizationId
      ? asDomain<CreditTransaction>(item)
      : undefined;
  }

  async appendCreditTransaction({
    transaction,
    balance,
    previousBalance,
  }: AppendCreditTransactionInput) {
    const sameBalanceIdentity =
      balance.organizationId === transaction.organizationId &&
      balance.customerId === transaction.customerId &&
      balance.sourceType === transaction.sourceType &&
      balance.sourceId === transaction.sourceId &&
      balance.membershipPeriodId === transaction.membershipPeriodId &&
      balance.benefitId === transaction.benefitId &&
      balance.benefitPeriodKey === transaction.benefitPeriodKey &&
      balance.unit === transaction.unit;
    if (!sameBalanceIdentity)
      throw new AppError(
        'CONFLICT',
        'Credit transaction and balance refer to different commercial records.',
      );
    if (
      previousBalance &&
      (previousBalance.organizationId !== balance.organizationId ||
        previousBalance.customerId !== balance.customerId ||
        previousBalance.sourceType !== balance.sourceType ||
        previousBalance.sourceId !== balance.sourceId ||
        previousBalance.membershipPeriodId !== balance.membershipPeriodId ||
        previousBalance.benefitId !== balance.benefitId ||
        previousBalance.benefitPeriodKey !== balance.benefitPeriodKey ||
        previousBalance.unit !== balance.unit ||
        previousBalance.quantityType !== balance.quantityType)
    )
      throw new AppError(
        'CONFLICT',
        'The previous credit balance does not match the transaction.',
      );
    const transactionKey = phase3Keys.creditTransaction(
      transaction.creditTransactionId,
    );
    const transactionSource = {
      ...transaction,
      ...transactionKey,
      entity: 'creditTransaction' as const,
    } as RecordItem;
    const sourceIndex = phase3Keys.creditTransactionBySource(
      transaction.sourceType,
      transaction.sourceId,
      transaction.occurredAt,
      transaction.creditTransactionId,
    );
    const customerIndex = phase3Keys.customerCommercialRecord(
      transaction.organizationId,
      transaction.customerId,
      transaction.occurredAt,
      'CREDIT',
      transaction.creditTransactionId,
    );
    const balanceSource = {
      ...balance,
      adjustedQuantity: balance.adjustedQuantity ?? 0,
      ...phase3Keys.creditBalance(
        balance.sourceType,
        balance.sourceId,
        balance.membershipPeriodId,
        balance.benefitId,
        balance.benefitPeriodKey,
      ),
    } as RecordItem;
    const balanceIndex = {
      ...balanceSource,
      ...phase3Keys.customerCreditBalance(
        balance.organizationId,
        balance.customerId,
        balance.sourceType,
        balance.sourceId,
        balance.membershipPeriodId,
        balance.benefitId,
        balance.benefitPeriodKey,
      ),
    } as RecordItem;
    const writes: Write[] = [
      {
        type: 'put',
        item: transactionSource,
        condition: 'attribute_not_exists(PK)',
      },
      { type: 'put', item: { ...transactionSource, ...sourceIndex } },
      ...(transaction.membershipPeriodId
        ? [
            {
              type: 'put' as const,
              item: {
                ...transactionSource,
                ...phase3Keys.creditTransactionByMembershipPeriod(
                  transaction.membershipPeriodId,
                  transaction.occurredAt,
                  transaction.creditTransactionId,
                ),
              },
            },
          ]
        : []),
      { type: 'put', item: { ...transactionSource, ...customerIndex } },
      {
        type: 'put',
        item: balanceSource,
        ...(previousBalance
          ? {
              expected: {
                organizationId: previousBalance.organizationId,
                customerId: previousBalance.customerId,
                sourceType: previousBalance.sourceType,
                sourceId: previousBalance.sourceId,
                unit: previousBalance.unit,
                quantityType: previousBalance.quantityType,
                remainingQuantity: previousBalance.remainingQuantity,
                consumedQuantity: previousBalance.consumedQuantity,
                restoredQuantity: previousBalance.restoredQuantity,
                expiredQuantity: previousBalance.expiredQuantity,
                adjustedQuantity: previousBalance.adjustedQuantity ?? 0,
              },
            }
          : { condition: 'attribute_not_exists(PK)' }),
      },
      { type: 'put', item: balanceIndex },
    ];
    try {
      await this.repo.transactWrite(writes);
    } catch (error) {
      const existing = await this.repo.get<RecordItem>(transactionKey);
      if (
        existing &&
        existing.organizationId === transaction.organizationId &&
        existing.customerId === transaction.customerId &&
        existing.sourceType === transaction.sourceType &&
        existing.sourceId === transaction.sourceId &&
        existing.transactionType === transaction.transactionType &&
        existing.quantity === transaction.quantity &&
        existing.unit === transaction.unit &&
        existing.reason === transaction.reason &&
        existing.createdBy === transaction.createdBy &&
        existing.occurredAt === transaction.occurredAt &&
        existing.activityId === transaction.activityId &&
        existing.relatedTransactionId === transaction.relatedTransactionId
      )
        return {
          transaction: asDomain<CreditTransaction>(existing),
          duplicate: true,
        };
      throw error;
    }
    return {
      transaction: asDomain<CreditTransaction>(transactionSource),
      duplicate: false,
    };
  }

  async listCreditTransactionsByMembershipPeriod(
    organizationId: string,
    membershipPeriodId: string,
    limit = 100,
  ) {
    return this.queryDomains<CreditTransaction>(
      phase3Keys.creditTransactionsByMembershipPeriod(membershipPeriodId).PK,
      { beginsWith: 'CREDIT#', limit },
    ).then((items) =>
      items.filter((item) => item.organizationId === organizationId),
    );
  }

  async putCreditBalance(
    balance: CreditBalanceInput,
    previous?: CreditBalanceRecord,
  ) {
    const normalized = {
      ...balance,
      adjustedQuantity: balance.adjustedQuantity ?? 0,
    };
    const sourceKey = phase3Keys.creditBalance(
      normalized.sourceType,
      normalized.sourceId,
      normalized.membershipPeriodId,
      normalized.benefitId,
      normalized.benefitPeriodKey,
    );
    const customerKey = phase3Keys.customerCreditBalance(
      normalized.organizationId,
      normalized.customerId,
      normalized.sourceType,
      normalized.sourceId,
      normalized.membershipPeriodId,
      normalized.benefitId,
      normalized.benefitPeriodKey,
    );
    await this.replace(
      { ...normalized, ...sourceKey },
      previous,
      [customerKey],
      previous
        ? [
            phase3Keys.customerCreditBalance(
              previous.organizationId,
              previous.customerId,
              previous.sourceType,
              previous.sourceId,
              previous.membershipPeriodId,
              previous.benefitId,
              previous.benefitPeriodKey,
            ),
          ]
        : [],
    );
  }

  async putCreditBalanceIfAbsent(balance: CreditBalanceInput) {
    const normalized = {
      ...balance,
      adjustedQuantity: balance.adjustedQuantity ?? 0,
    };
    const sourceKey = phase3Keys.creditBalance(
      normalized.sourceType,
      normalized.sourceId,
      normalized.membershipPeriodId,
      normalized.benefitId,
      normalized.benefitPeriodKey,
    );
    const customerKey = phase3Keys.customerCreditBalance(
      normalized.organizationId,
      normalized.customerId,
      normalized.sourceType,
      normalized.sourceId,
      normalized.membershipPeriodId,
      normalized.benefitId,
      normalized.benefitPeriodKey,
    );
    await this.repo.transactWrite([
      {
        type: 'put',
        item: { ...normalized, ...sourceKey },
        condition: 'attribute_not_exists(PK)',
      },
      { type: 'put', item: { ...normalized, ...customerKey } },
    ]);
  }

  async getCreditBalance(input: {
    organizationId?: string;
    customerId?: string;
    sourceType: CreditBalanceRecord['sourceType'];
    sourceId: string;
    membershipPeriodId?: string;
    benefitId?: string;
    benefitPeriodKey?: string;
  }) {
    const balance = await this.repo.get<CreditBalanceRecord>(
      phase3Keys.creditBalance(
        input.sourceType,
        input.sourceId,
        input.membershipPeriodId,
        input.benefitId,
        input.benefitPeriodKey,
      ),
    );
    if (
      !balance ||
      (input.organizationId &&
        balance.organizationId !== input.organizationId) ||
      (input.customerId && balance.customerId !== input.customerId)
    )
      return undefined;
    return balance
      ? { ...balance, adjustedQuantity: balance.adjustedQuantity ?? 0 }
      : undefined;
  }

  async listCreditBalancesByCustomer(
    organizationId: string,
    customerId: string,
    limit = 100,
  ) {
    return (
      await this.repo.query<CreditBalanceRecord>(
        phase3Keys.customerCreditBalances(organizationId, customerId).PK,
        { beginsWith: 'CREDIT_BALANCE#', limit },
      )
    ).filter(
      (item) =>
        item.organizationId === organizationId &&
        item.customerId === customerId,
    );
  }

  async putEntitlementAllocation(
    allocation: EntitlementAllocation,
    previous?: EntitlementAllocation,
  ) {
    const current = [
      phase3Keys.entitlementAllocationBySource(
        allocation.sourceType,
        allocation.sourceId,
        allocation.createdAt,
        allocation.allocationId,
      ),
      phase3Keys.usageAllocationByActivity(
        allocation.organizationId,
        allocation.activityType,
        allocation.activityId,
        allocation.sourceType,
        allocation.sourceId,
        allocation.membershipPeriodId,
        allocation.benefitId,
        allocation.benefitPeriodKey,
        allocation.allocationId,
      ),
      phase3Keys.customerCommercialRecord(
        allocation.organizationId,
        allocation.customerId,
        allocation.createdAt,
        'ALLOCATION',
        allocation.allocationId,
      ),
    ];
    const old = previous
      ? [
          phase3Keys.entitlementAllocationBySource(
            previous.sourceType,
            previous.sourceId,
            previous.createdAt,
            previous.allocationId,
          ),
          phase3Keys.usageAllocationByActivity(
            previous.organizationId,
            previous.activityType,
            previous.activityId,
            previous.sourceType,
            previous.sourceId,
            previous.membershipPeriodId,
            previous.benefitId,
            previous.benefitPeriodKey,
            previous.allocationId,
          ),
          phase3Keys.customerCommercialRecord(
            previous.organizationId,
            previous.customerId,
            previous.createdAt,
            'ALLOCATION',
            previous.allocationId,
          ),
        ]
      : [];
    await this.replace(
      {
        ...allocation,
        ...phase3Keys.entitlementAllocation(allocation.allocationId),
        entity: 'entitlementAllocation',
      },
      previous
        ? {
            ...previous,
            ...phase3Keys.entitlementAllocation(previous.allocationId),
            entity: 'entitlementAllocation',
          }
        : undefined,
      current,
      old,
    );
  }

  async listCreditBalancesBySource(
    organizationId: string,
    sourceType: CreditBalanceRecord['sourceType'],
    sourceId: string,
    limit = 100,
  ) {
    return (
      await this.repo.query<CreditBalanceRecord>(
        phase3Keys.creditBalance(sourceType, sourceId, undefined, undefined).PK,
        { beginsWith: 'BENEFIT#', limit },
      )
    ).filter((item) => item.organizationId === organizationId);
  }

  async getEntitlementAllocation(organizationId: string, allocationId: string) {
    const item = await this.repo.get<RecordItem>(
      phase3Keys.entitlementAllocation(allocationId),
    );
    return item?.organizationId === organizationId
      ? asDomain<EntitlementAllocation>(item)
      : undefined;
  }

  async listAllocationsByActivity(
    organizationId: string,
    activityType: EntitlementAllocation['activityType'],
    activityId: string,
    limit = 100,
  ) {
    return this.queryDomains<EntitlementAllocation>(
      phase3Keys.usageByActivity(organizationId, activityType, activityId).PK,
      { beginsWith: 'ALLOCATION#', limit },
    );
  }

  async consumeEntitlement(input: ConsumeEntitlementInput) {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0)
      throw new AppError(
        'VALIDATION_ERROR',
        'Consumption quantity must be positive.',
      );
    const logicalKey = [
      input.organizationId,
      input.activityType,
      input.activityId,
      input.sourceType,
      input.sourceId,
      input.membershipPeriodId ?? '-',
      input.benefitId ?? '-',
      input.benefitPeriodKey ?? '-',
    ].join('|');
    const allocationId =
      input.allocationId ??
      `usage-${createHash('sha256').update(logicalKey).digest('hex').slice(0, 48)}`;
    const guard = phase3Keys.usageGuard(
      input.organizationId,
      input.activityType,
      input.activityId,
      input.sourceType,
      input.sourceId,
      input.membershipPeriodId,
      input.benefitId,
      input.benefitPeriodKey,
    );
    const existingGuard = await this.repo.get<RecordItem>(guard);
    if (existingGuard?.allocationId) {
      const existing = await this.repo.get<RecordItem>(
        phase3Keys.entitlementAllocation(String(existingGuard.allocationId)),
      );
      if (
        existing &&
        existing.organizationId === input.organizationId &&
        existing.customerId === input.customerId &&
        existing.sourceType === input.sourceType &&
        existing.sourceId === input.sourceId &&
        existing.activityType === input.activityType &&
        existing.activityId === input.activityId
      )
        return {
          allocation: asDomain<EntitlementAllocation>(existing),
          duplicate: true,
        };
      if (existing)
        throw new AppError(
          'CONFLICT',
          'The activity usage guard refers to different commercial data.',
        );
    }
    if (input.sourceType === 'PACKAGE') {
      const customerPackage = await this.getCustomerPackage(
        input.organizationId,
        input.sourceId,
      );
      if (!customerPackage || customerPackage.customerId !== input.customerId)
        throw new AppError('NOT_FOUND', 'Customer package was not found.');
      if (customerPackage.status !== 'ACTIVE')
        throw new AppError(
          'INVALID_STATE',
          'Only active customer packages can cover activities.',
        );
      if (
        customerPackage.expiresAt &&
        Date.parse(customerPackage.expiresAt) <= Date.parse(input.occurredAt)
      )
        throw new AppError(
          'INVALID_STATE',
          'The package is not active for this activity date.',
        );
      if (Date.parse(customerPackage.startsAt) > Date.parse(input.occurredAt))
        throw new AppError(
          'INVALID_STATE',
          'The package is not active for this activity date.',
        );
    }
    if (input.sourceType === 'MEMBERSHIP') {
      const membership = await this.getMembership(
        input.organizationId,
        input.sourceId,
      );
      if (!membership || membership.customerId !== input.customerId)
        throw new AppError('NOT_FOUND', 'Membership was not found.');
      if (membership.status !== 'ACTIVE')
        throw new AppError(
          'INVALID_STATE',
          'Only active memberships can cover activities.',
        );
      if (
        input.membershipPeriodId &&
        (!membership.currentPeriodId ||
          membership.currentPeriodId !== input.membershipPeriodId)
      )
        throw new AppError(
          'CONFLICT',
          'The membership period is not the current period.',
        );
      if (input.membershipPeriodId) {
        const period = await this.getMembershipPeriod(
          input.organizationId,
          input.membershipPeriodId,
        );
        if (
          !period ||
          period.membershipId !== membership.membershipId ||
          period.status !== 'ACTIVE'
        )
          throw new AppError(
            'CONFLICT',
            'The membership period is not active.',
          );
      }
      const activityDate = input.occurredAt.slice(0, 10);
      if (
        activityDate < membership.currentPeriodStart ||
        activityDate > membership.currentPeriodEnd
      )
        throw new AppError(
          'INVALID_STATE',
          'The membership is not active for this activity date.',
        );
    }
    if (input.sourceType === 'FIXED_AGREEMENT') {
      const agreement = await this.getFixedCourtAgreement(
        input.organizationId,
        input.sourceId,
      );
      if (!agreement || agreement.customerId !== input.customerId)
        throw new AppError('NOT_FOUND', 'Fixed court agreement was not found.');
      if (agreement.status !== 'ACTIVE')
        throw new AppError(
          'INVALID_STATE',
          'Only active fixed court agreements can cover activities.',
        );
    }
    if (input.sourceType === 'MAKEUP') {
      const makeupCredit = await this.getMakeupCredit(
        input.organizationId,
        input.sourceId,
      );
      if (!makeupCredit || makeupCredit.customerId !== input.customerId)
        throw new AppError('NOT_FOUND', 'Makeup credit was not found.');
      if (makeupCredit.status !== 'ACTIVE')
        throw new AppError(
          'INVALID_STATE',
          'Only active makeup credits can cover attendance.',
        );
      if (
        makeupCredit.expiresAt &&
        Date.parse(makeupCredit.expiresAt) <= Date.parse(input.occurredAt)
      )
        throw new AppError('INVALID_STATE', 'The makeup credit has expired.');
      if (Date.parse(makeupCredit.issuedAt) > Date.parse(input.occurredAt))
        throw new AppError(
          'INVALID_STATE',
          'The makeup credit is not active for this attendance date.',
        );
    }
    const balance = await this.getCreditBalance(input);
    if (!balance)
      throw new AppError('NOT_FOUND', 'Entitlement balance was not found.');
    if (balance.unit !== input.unit)
      throw new AppError('VALIDATION_ERROR', 'Entitlement units do not match.');
    if (
      balance.expiresAt &&
      Date.parse(balance.expiresAt) <= Date.parse(input.occurredAt)
    )
      throw new AppError('INVALID_STATE', 'The entitlement has expired.');
    if (
      balance.quantityType === 'FINITE' &&
      balance.remainingQuantity < input.quantity
    )
      throw new AppError(
        'CONFLICT',
        'The entitlement does not have enough remaining credit.',
      );

    const creditTransactionId = `consumption-${allocationId}`;
    const allocation = {
      ...phase3Keys.entitlementAllocation(allocationId),
      entity: 'entitlementAllocation' as const,
      allocationId,
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
      activityType: input.activityType,
      activityId: input.activityId,
      unit: input.unit,
      quantity: input.quantity,
      coveredAmount: input.coveredAmount,
      currency: input.currency,
      status: 'ACTIVE' as const,
      createdAt: input.createdAt,
    };
    const allocationIndex = phase3Keys.usageAllocationByActivity(
      input.organizationId,
      input.activityType,
      input.activityId,
      input.sourceType,
      input.sourceId,
      input.membershipPeriodId,
      input.benefitId,
      input.benefitPeriodKey,
      allocationId,
    );
    const customerAllocationIndex = phase3Keys.customerCommercialRecord(
      input.organizationId,
      input.customerId,
      input.createdAt,
      'ALLOCATION',
      allocationId,
    );
    const transaction = {
      ...phase3Keys.creditTransaction(creditTransactionId),
      entity: 'creditTransaction' as const,
      creditTransactionId,
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
      transactionType: 'CONSUMED' as const,
      unit: input.unit,
      quantity: -input.quantity,
      activityType: input.activityType,
      activityId: input.activityId,
      occurredAt: input.occurredAt,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
    };
    const sourceIndex = phase3Keys.creditTransactionBySource(
      input.sourceType,
      input.sourceId,
      input.occurredAt,
      creditTransactionId,
    );
    const customerCreditIndex = phase3Keys.customerCommercialRecord(
      input.organizationId,
      input.customerId,
      input.occurredAt,
      'CREDIT',
      creditTransactionId,
    );
    const writes: Write[] = [
      {
        type: 'put',
        item: { ...guard, allocationId } as RecordItem,
        condition: 'attribute_not_exists(PK)',
      },
      {
        type: 'put',
        item: allocation as RecordItem,
        condition: 'attribute_not_exists(PK)',
      },
      {
        type: 'put',
        item: { ...allocation, ...allocationIndex } as RecordItem,
      },
      {
        type: 'put',
        item: { ...allocation, ...customerAllocationIndex } as RecordItem,
      },
      {
        type: 'put',
        item: transaction as RecordItem,
        condition: 'attribute_not_exists(PK)',
      },
      { type: 'put', item: { ...transaction, ...sourceIndex } as RecordItem },
      {
        type: 'put',
        item: { ...transaction, ...customerCreditIndex } as RecordItem,
      },
    ];
    const nextBalance = {
      ...balance,
      remainingQuantity:
        balance.quantityType === 'FINITE'
          ? balance.remainingQuantity - input.quantity
          : 0,
      consumedQuantity: balance.consumedQuantity + input.quantity,
      adjustedQuantity: balance.adjustedQuantity ?? 0,
      updatedAt: input.createdAt,
    };
    writes.push(
      {
        type: 'put',
        item: {
          ...nextBalance,
          ...phase3Keys.creditBalance(
            balance.sourceType,
            balance.sourceId,
            balance.membershipPeriodId,
            balance.benefitId,
            balance.benefitPeriodKey,
          ),
        },
        expected: {
          organizationId: balance.organizationId,
          customerId: balance.customerId,
          sourceType: balance.sourceType,
          sourceId: balance.sourceId,
          unit: balance.unit,
          quantityType: balance.quantityType,
          remainingQuantity: balance.remainingQuantity,
          consumedQuantity: balance.consumedQuantity,
          restoredQuantity: balance.restoredQuantity,
          expiredQuantity: balance.expiredQuantity,
          adjustedQuantity: balance.adjustedQuantity ?? 0,
        },
      },
      {
        type: 'put',
        item: {
          ...nextBalance,
          ...phase3Keys.customerCreditBalance(
            balance.organizationId,
            balance.customerId,
            balance.sourceType,
            balance.sourceId,
            balance.membershipPeriodId,
            balance.benefitId,
            balance.benefitPeriodKey,
          ),
        },
      },
    );
    try {
      await this.repo.transactWrite(writes);
    } catch (error) {
      const existingGuard = await this.repo.get<RecordItem>(guard);
      if (existingGuard?.allocationId) {
        const existing = await this.repo.get<RecordItem>(
          phase3Keys.entitlementAllocation(String(existingGuard.allocationId)),
        );
        if (
          existing &&
          existing.organizationId === input.organizationId &&
          existing.customerId === input.customerId &&
          existing.sourceType === input.sourceType &&
          existing.sourceId === input.sourceId &&
          existing.activityType === input.activityType &&
          existing.activityId === input.activityId
        )
          return {
            allocation: asDomain<EntitlementAllocation>(existing),
            duplicate: true,
          };
        if (existing)
          throw new AppError(
            'CONFLICT',
            'The activity usage guard refers to different commercial data.',
          );
      }
      throw error;
    }
    return {
      allocation: asDomain<EntitlementAllocation>(allocation),
      duplicate: false,
    };
  }

  async putFixedCourtAgreement(
    agreement: FixedCourtAgreement,
    previous?: FixedCourtAgreement,
  ) {
    const current = [
      phase3Keys.fixedCourtAgreementByCustomer(
        agreement.organizationId,
        agreement.customerId,
        agreement.startDate,
        agreement.agreementId,
      ),
      ...(agreement.status === 'ACTIVE'
        ? [
            phase3Keys.fixedCourtAgreementByCustomer(
              agreement.organizationId,
              agreement.customerId,
              agreement.startDate,
              agreement.agreementId,
              true,
            ),
            phase3Keys.activeFixedCourtAgreementByOrganization(
              agreement.organizationId,
              agreement.startDate,
              agreement.agreementId,
            ),
          ]
        : []),
      phase3Keys.customerCommercialRecord(
        agreement.organizationId,
        agreement.customerId,
        agreement.startDate,
        'FIXED_AGREEMENT',
        agreement.agreementId,
      ),
      phase3Keys.fixedCourtAgreementByOrganization(
        agreement.organizationId,
        agreement.startDate,
        agreement.agreementId,
      ),
    ];
    const old = previous
      ? [
          phase3Keys.fixedCourtAgreementByCustomer(
            previous.organizationId,
            previous.customerId,
            previous.startDate,
            previous.agreementId,
          ),
          ...(previous.status === 'ACTIVE'
            ? [
                phase3Keys.fixedCourtAgreementByCustomer(
                  previous.organizationId,
                  previous.customerId,
                  previous.startDate,
                  previous.agreementId,
                  true,
                ),
                phase3Keys.activeFixedCourtAgreementByOrganization(
                  previous.organizationId,
                  previous.startDate,
                  previous.agreementId,
                ),
              ]
            : []),
          phase3Keys.customerCommercialRecord(
            previous.organizationId,
            previous.customerId,
            previous.startDate,
            'FIXED_AGREEMENT',
            previous.agreementId,
          ),
          phase3Keys.fixedCourtAgreementByOrganization(
            previous.organizationId,
            previous.startDate,
            previous.agreementId,
          ),
        ]
      : [];
    await this.replace(
      {
        ...agreement,
        ...phase3Keys.fixedCourtAgreement(agreement.agreementId),
        entity: 'fixedCourtAgreement',
      },
      previous
        ? {
            ...previous,
            ...phase3Keys.fixedCourtAgreement(previous.agreementId),
            entity: 'fixedCourtAgreement',
          }
        : undefined,
      current,
      old,
    );
  }

  async getFixedCourtAgreement(organizationId: string, agreementId: string) {
    const item = await this.repo.get<RecordItem>(
      phase3Keys.fixedCourtAgreement(agreementId),
    );
    return item?.organizationId === organizationId
      ? asDomain<FixedCourtAgreement>(item)
      : undefined;
  }

  async listFixedCourtAgreementsByCustomer(
    organizationId: string,
    customerId: string,
    options: { activeOnly?: boolean; limit?: number } = {},
  ) {
    return this.queryDomains<FixedCourtAgreement>(
      phase3Keys.fixedCourtAgreementsByCustomer(organizationId, customerId).PK,
      {
        beginsWith: options.activeOnly
          ? 'FIXED_AGREEMENT_ACTIVE#'
          : 'FIXED_AGREEMENT#',
        limit: options.limit ?? 100,
      },
    ).then((items) =>
      items.filter(
        (item) =>
          item.organizationId === organizationId &&
          item.customerId === customerId,
      ),
    );
  }

  async listActiveFixedCourtAgreementsByOrganization(
    organizationId: string,
    limit = 100,
  ) {
    return this.queryDomains<FixedCourtAgreement>(
      phase3Keys.activeFixedCourtAgreementsByOrganization(organizationId).PK,
      { beginsWith: 'ACTIVE#', limit },
    ).then((items) =>
      items.filter((item) => item.organizationId === organizationId),
    );
  }

  async listFixedCourtAgreementsByOrganization(
    organizationId: string,
    limit = 100,
  ) {
    return this.queryDomains<FixedCourtAgreement>(
      phase3Keys.fixedCourtAgreementsByOrganization(organizationId).PK,
      { beginsWith: 'AGREEMENT#', limit },
    ).then((items) =>
      items.filter((item) => item.organizationId === organizationId),
    );
  }

  async putFixedCourtOccurrence(
    occurrence: FixedCourtOccurrence,
    previous?: FixedCourtOccurrence,
  ) {
    const current = [
      phase3Keys.fixedCourtOccurrenceByAgreement(
        occurrence.agreementId,
        occurrence.date,
        occurrence.occurrenceId,
      ),
      phase3Keys.customerCommercialRecord(
        occurrence.organizationId,
        occurrence.customerId,
        occurrence.date,
        'FIXED_OCCURRENCE',
        occurrence.occurrenceId,
      ),
    ];
    const old = previous
      ? [
          phase3Keys.fixedCourtOccurrenceByAgreement(
            previous.agreementId,
            previous.date,
            previous.occurrenceId,
          ),
          phase3Keys.customerCommercialRecord(
            previous.organizationId,
            previous.customerId,
            previous.date,
            'FIXED_OCCURRENCE',
            previous.occurrenceId,
          ),
        ]
      : [];
    await this.replace(
      {
        ...occurrence,
        ...phase3Keys.fixedCourtOccurrence(occurrence.occurrenceId),
        entity: 'fixedCourtOccurrence',
      },
      previous
        ? {
            ...previous,
            ...phase3Keys.fixedCourtOccurrence(previous.occurrenceId),
            entity: 'fixedCourtOccurrence',
          }
        : undefined,
      current,
      old,
    );
  }

  async listFixedCourtOccurrencesByAgreement(
    organizationId: string,
    agreementId: string,
    limit = 100,
  ) {
    return this.queryDomains<FixedCourtOccurrence>(
      phase3Keys.fixedCourtOccurrencesByAgreement(agreementId).PK,
      { beginsWith: 'OCCURRENCE#', limit },
    ).then((items) =>
      items.filter((item) => item.organizationId === organizationId),
    );
  }

  async listCustomerCommercialRecords(
    organizationId: string,
    customerId: string,
    limit = 100,
  ) {
    return (
      await this.repo.query<RecordItem>(
        phase3Keys.customerCommercial(organizationId, customerId).PK,
        { beginsWith: 'COMMERCIAL#', limit },
      )
    ).filter((item) => item.organizationId === organizationId);
  }

  async listCustomerCharges(
    organizationId: string,
    customerId: string,
    limit = 100,
  ) {
    return this.queryDomains<Charge>(
      phase3Keys.customerCharges(organizationId, customerId).PK,
      { beginsWith: 'CHARGE#', limit },
    ).then((items) =>
      items.filter(
        (item) =>
          item.organizationId === organizationId &&
          item.customerId === customerId,
      ),
    );
  }

  async listCustomerPayments(
    organizationId: string,
    customerId: string,
    limit = 100,
  ) {
    return this.queryDomains<Payment>(
      phase3Keys.customerPayments(organizationId, customerId).PK,
      { beginsWith: 'PAYMENT#', limit },
    ).then((items) =>
      items.filter(
        (item) =>
          item.organizationId === organizationId &&
          item.customerId === customerId,
      ),
    );
  }

  async indexCharge(charge: Charge | IndexedRecord) {
    const item = charge as RecordItem;
    await this.repo.put(
      indexItem(
        item,
        phase3Keys.customerCharge(
          String(item.organizationId),
          String(item.customerId),
          String(item.serviceAt),
          String(item.chargeId),
        ),
      ),
    );
  }

  async indexPayment(payment: Payment | IndexedRecord) {
    const item = payment as RecordItem;
    await this.repo.put(
      indexItem(
        item,
        phase3Keys.customerPayment(
          String(item.organizationId),
          String(item.customerId),
          String(item.paidAt),
          String(item.paymentId),
        ),
      ),
    );
  }
}

export const DynamoPhase3Repository = Phase3Repository;
