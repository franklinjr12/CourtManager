import type { Key } from '../db.js';

const customerPartition = (organizationId: string, customerId: string) =>
  `CUSTOMER#${organizationId}#${customerId}`;

/**
 * Materialized single-table keys for Phase 3 commercial records.
 *
 * Source records are addressed by their stable ID. The other keys are
 * deliberately query-shaped access records and are written in the same
 * transaction as their source whenever the relationship must be correct.
 */
export const phase3Keys = {
  customerActivityEvent: (eventId: string): Key => ({
    PK: `CUSTOMER_ACTIVITY_EVENT#${eventId}`,
    SK: 'META',
  }),
  customerActivityEventByCustomer: (
    organizationId: string,
    customerId: string,
    occurredAt: string,
    eventType: string,
    eventId: string,
  ): Key => ({
    PK: customerPartition(organizationId, customerId),
    SK: `ACTIVITY#${occurredAt}#COMMERCIAL#${eventType}#${eventId}`,
  }),
  customerActivityEventsByCustomer: (
    organizationId: string,
    customerId: string,
  ): Key => ({
    PK: customerPartition(organizationId, customerId),
    SK: 'ACTIVITY#',
  }),
  plan: (planId: string): Key => ({
    PK: `PLAN#${planId}`,
    SK: 'META',
  }),
  organizationPlans: (organizationId: string): Key => ({
    PK: `ORG#${organizationId}#COMMERCIAL`,
    SK: 'PLAN#',
  }),
  organizationPlan: (
    organizationId: string,
    createdAt: string,
    planId: string,
  ): Key => ({
    PK: `ORG#${organizationId}#COMMERCIAL`,
    SK: `PLAN#${createdAt}#${planId}`,
  }),
  organizationPlanStatus: (
    organizationId: string,
    status: string,
    createdAt: string,
    planId: string,
  ): Key => ({
    PK: `ORG#${organizationId}#COMMERCIAL`,
    SK: `PLAN_STATUS#${status}#${createdAt}#${planId}`,
  }),

  membership: (membershipId: string): Key => ({
    PK: `MEMBERSHIP#${membershipId}`,
    SK: 'META',
  }),
  membershipByCustomer: (
    organizationId: string,
    customerId: string,
    startDate: string,
    membershipId: string,
    active = false,
  ): Key => ({
    PK: customerPartition(organizationId, customerId),
    SK: `MEMBERSHIP${active ? '_ACTIVE' : ''}#${startDate}#${membershipId}`,
  }),
  membershipByPlan: (
    planId: string,
    startDate: string,
    membershipId: string,
  ): Key => ({
    PK: `PLAN#${planId}`,
    SK: `MEMBERSHIP#${startDate}#${membershipId}`,
  }),
  membershipByOrganization: (
    organizationId: string,
    startDate: string,
    membershipId: string,
  ): Key => ({
    PK: `ORG#${organizationId}#MEMBERSHIPS`,
    SK: `MEMBERSHIP#${startDate}#${membershipId}`,
  }),
  membershipStatus: (
    organizationId: string,
    status: string,
    startDate: string,
    membershipId: string,
  ): Key => ({
    PK: `ORG#${organizationId}#MEMBERSHIPS`,
    SK: `MEMBERSHIP_STATUS#${status}#${startDate}#${membershipId}`,
  }),
  membershipRenewal: (
    organizationId: string,
    nextRenewalDate: string,
    membershipId: string,
  ): Key => ({
    PK: `ORG#${organizationId}#MEMBERSHIPS`,
    SK: `MEMBERSHIP_RENEWAL#${nextRenewalDate}#${membershipId}`,
  }),
  membershipExpiry: (
    organizationId: string,
    currentPeriodEnd: string,
    membershipId: string,
  ): Key => ({
    PK: `ORG#${organizationId}#MEMBERSHIPS`,
    SK: `MEMBERSHIP_EXPIRY#${currentPeriodEnd}#${membershipId}`,
  }),
  membershipPeriods: (membershipId: string): Key => ({
    PK: `MEMBERSHIP#${membershipId}`,
    SK: 'PERIOD#',
  }),
  membershipPeriod: (membershipId: string, periodId: string): Key => ({
    PK: `MEMBERSHIP#${membershipId}`,
    SK: `PERIOD#${periodId}`,
  }),
  membershipPeriodById: (periodId: string): Key => ({
    PK: `MEMBERSHIP_PERIOD#${periodId}`,
    SK: 'META',
  }),

  packageDefinition: (packageDefinitionId: string): Key => ({
    PK: `PACKAGE_DEFINITION#${packageDefinitionId}`,
    SK: 'META',
  }),
  organizationPackageDefinitions: (organizationId: string): Key => ({
    PK: `ORG#${organizationId}#COMMERCIAL`,
    SK: 'PACKAGE_DEFINITION#',
  }),
  organizationPackageDefinition: (
    organizationId: string,
    createdAt: string,
    packageDefinitionId: string,
  ): Key => ({
    PK: `ORG#${organizationId}#COMMERCIAL`,
    SK: `PACKAGE_DEFINITION#${createdAt}#${packageDefinitionId}`,
  }),
  organizationPackageDefinitionStatus: (
    organizationId: string,
    status: string,
    createdAt: string,
    packageDefinitionId: string,
  ): Key => ({
    PK: `ORG#${organizationId}#COMMERCIAL`,
    SK: `PACKAGE_DEFINITION_STATUS#${status}#${createdAt}#${packageDefinitionId}`,
  }),

  customerPackage: (customerPackageId: string): Key => ({
    PK: `CUSTOMER_PACKAGE#${customerPackageId}`,
    SK: 'META',
  }),
  customerPackageByCustomer: (
    organizationId: string,
    customerId: string,
    startsAt: string,
    customerPackageId: string,
    active = false,
  ): Key => ({
    PK: customerPartition(organizationId, customerId),
    SK: `PACKAGE${active ? '_ACTIVE' : ''}#${startsAt}#${customerPackageId}`,
  }),
  packageExpiry: (
    organizationId: string,
    expiresAt: string,
    customerPackageId: string,
  ): Key => ({
    PK: `ORG#${organizationId}#PACKAGES`,
    SK: `PACKAGE_EXPIRY#${expiresAt}#${customerPackageId}`,
  }),
  organizationPackages: (organizationId: string): Key => ({
    PK: `ORG#${organizationId}#PACKAGES`,
    SK: 'PACKAGE#',
  }),
  packageByOrganization: (
    organizationId: string,
    startsAt: string,
    customerPackageId: string,
  ): Key => ({
    PK: `ORG#${organizationId}#PACKAGES`,
    SK: `PACKAGE#${startsAt}#${customerPackageId}`,
  }),

  makeupCredit: (makeupCreditId: string): Key => ({
    PK: `MAKEUP_CREDIT#${makeupCreditId}`,
    SK: 'META',
  }),
  makeupCreditByCustomer: (
    organizationId: string,
    customerId: string,
    issuedAt: string,
    makeupCreditId: string,
    active = false,
  ): Key => ({
    PK: customerPartition(organizationId, customerId),
    SK: `MAKEUP_CREDIT${active ? '_ACTIVE' : ''}#${issuedAt}#${makeupCreditId}`,
  }),
  makeupCreditByOrigin: (
    organizationId: string,
    originSessionId: string,
    issuedAt: string,
    makeupCreditId: string,
  ): Key => ({
    PK: `ORG#${organizationId}#CLASS_SESSION#${originSessionId}`,
    SK: `MAKEUP_CREDIT#${issuedAt}#${makeupCreditId}`,
  }),

  creditTransaction: (creditTransactionId: string): Key => ({
    PK: `CREDIT_TRANSACTION#${creditTransactionId}`,
    SK: 'META',
  }),
  creditTransactionsBySource: (sourceType: string, sourceId: string): Key => ({
    PK: `${sourceType}#${sourceId}`,
    SK: 'CREDIT#',
  }),
  creditTransactionBySource: (
    sourceType: string,
    sourceId: string,
    occurredAt: string,
    creditTransactionId: string,
  ): Key => ({
    PK: `${sourceType}#${sourceId}`,
    SK: `CREDIT#${occurredAt}#${creditTransactionId}`,
  }),
  creditTransactionsByMembershipPeriod: (membershipPeriodId: string): Key => ({
    PK: `MEMBERSHIP_PERIOD#${membershipPeriodId}`,
    SK: 'CREDIT#',
  }),
  creditTransactionByMembershipPeriod: (
    membershipPeriodId: string,
    occurredAt: string,
    creditTransactionId: string,
  ): Key => ({
    PK: `MEMBERSHIP_PERIOD#${membershipPeriodId}`,
    SK: `CREDIT#${occurredAt}#${creditTransactionId}`,
  }),

  entitlementAllocation: (allocationId: string): Key => ({
    PK: `ENTITLEMENT_ALLOCATION#${allocationId}`,
    SK: 'META',
  }),
  entitlementAllocationsBySource: (
    sourceType: string,
    sourceId: string,
  ): Key => ({
    PK: `${sourceType}#${sourceId}`,
    SK: 'ALLOCATION#',
  }),
  entitlementAllocationBySource: (
    sourceType: string,
    sourceId: string,
    createdAt: string,
    allocationId: string,
  ): Key => ({
    PK: `${sourceType}#${sourceId}`,
    SK: `ALLOCATION#${createdAt}#${allocationId}`,
  }),
  usageByActivity: (
    organizationId: string,
    activityType: string,
    activityId: string,
  ): Key => ({
    PK: `USAGE#${organizationId}#${activityType}#${activityId}`,
    SK: 'ALLOCATION#',
  }),
  usageAllocationByActivity: (
    organizationId: string,
    activityType: string,
    activityId: string,
    sourceType: string,
    sourceId: string,
    membershipPeriodId: string | undefined,
    benefitId: string | undefined,
    benefitPeriodKey: string | undefined,
    allocationId: string,
  ): Key => ({
    PK: `USAGE#${organizationId}#${activityType}#${activityId}`,
    SK: `ALLOCATION#${sourceType}#${sourceId}#${membershipPeriodId ?? '-'}#${benefitId ?? '-'}${benefitPeriodKey ? `#${benefitPeriodKey}` : ''}#${allocationId}`,
  }),
  usageGuard: (
    organizationId: string,
    activityType: string,
    activityId: string,
    sourceType: string,
    sourceId: string,
    membershipPeriodId: string | undefined,
    benefitId: string | undefined,
    benefitPeriodKey: string | undefined,
  ): Key => ({
    PK: `USAGE#${organizationId}#${activityType}#${activityId}`,
    SK: `USAGE_KEY#${sourceType}#${sourceId}#${membershipPeriodId ?? '-'}#${benefitId ?? '-'}${benefitPeriodKey ? `#${benefitPeriodKey}` : ''}`,
  }),

  creditBalance: (
    sourceType: string,
    sourceId: string,
    membershipPeriodId: string | undefined,
    benefitId: string | undefined,
    benefitPeriodKey: string | undefined = undefined,
  ): Key => ({
    PK: `ENTITLEMENT_BALANCE#${sourceType}#${sourceId}#${membershipPeriodId ?? '-'}`,
    SK: `BENEFIT#${benefitId ?? '-'}${benefitPeriodKey ? `#${benefitPeriodKey}` : ''}`,
  }),
  customerCreditBalance: (
    organizationId: string,
    customerId: string,
    sourceType: string,
    sourceId: string,
    membershipPeriodId: string | undefined,
    benefitId: string | undefined,
    benefitPeriodKey: string | undefined = undefined,
  ): Key => ({
    PK: customerPartition(organizationId, customerId),
    SK: `CREDIT_BALANCE#${sourceType}#${sourceId}#${membershipPeriodId ?? '-'}#${benefitId ?? '-'}${benefitPeriodKey ? `#${benefitPeriodKey}` : ''}`,
  }),
  customerCreditBalances: (
    organizationId: string,
    customerId: string,
  ): Key => ({
    PK: customerPartition(organizationId, customerId),
    SK: 'CREDIT_BALANCE#',
  }),

  fixedCourtAgreement: (agreementId: string): Key => ({
    PK: `FIXED_COURT_AGREEMENT#${agreementId}`,
    SK: 'META',
  }),
  fixedCourtAgreementsByCustomer: (
    organizationId: string,
    customerId: string,
  ): Key => ({
    PK: customerPartition(organizationId, customerId),
    SK: 'FIXED_AGREEMENT#',
  }),
  fixedCourtAgreementByCustomer: (
    organizationId: string,
    customerId: string,
    startDate: string,
    agreementId: string,
    active = false,
  ): Key => ({
    PK: customerPartition(organizationId, customerId),
    SK: `FIXED_AGREEMENT${active ? '_ACTIVE' : ''}#${startDate}#${agreementId}`,
  }),
  activeFixedCourtAgreementsByOrganization: (organizationId: string): Key => ({
    PK: `ORG#${organizationId}#FIXED_AGREEMENTS`,
    SK: 'ACTIVE#',
  }),
  activeFixedCourtAgreementByOrganization: (
    organizationId: string,
    startDate: string,
    agreementId: string,
  ): Key => ({
    PK: `ORG#${organizationId}#FIXED_AGREEMENTS`,
    SK: `ACTIVE#${startDate}#${agreementId}`,
  }),
  fixedCourtAgreementsByOrganization: (organizationId: string): Key => ({
    PK: `ORG#${organizationId}#FIXED_AGREEMENTS`,
    SK: 'AGREEMENT#',
  }),
  fixedCourtAgreementByOrganization: (
    organizationId: string,
    startDate: string,
    agreementId: string,
  ): Key => ({
    PK: `ORG#${organizationId}#FIXED_AGREEMENTS`,
    SK: `AGREEMENT#${startDate}#${agreementId}`,
  }),
  fixedCourtOccurrencesByAgreement: (agreementId: string): Key => ({
    PK: `FIXED_COURT_AGREEMENT#${agreementId}`,
    SK: 'OCCURRENCE#',
  }),
  fixedCourtOccurrenceByAgreement: (
    agreementId: string,
    date: string,
    occurrenceId: string,
  ): Key => ({
    PK: `FIXED_COURT_AGREEMENT#${agreementId}`,
    SK: `OCCURRENCE#${date}#${occurrenceId}`,
  }),
  fixedCourtOccurrence: (occurrenceId: string): Key => ({
    PK: `FIXED_COURT_OCCURRENCE#${occurrenceId}`,
    SK: 'META',
  }),

  customerCommercial: (organizationId: string, customerId: string): Key => ({
    PK: customerPartition(organizationId, customerId),
    SK: 'COMMERCIAL#',
  }),
  customerCommercialRecord: (
    organizationId: string,
    customerId: string,
    occurredAt: string,
    recordType: string,
    recordId: string,
  ): Key => ({
    PK: customerPartition(organizationId, customerId),
    SK: `COMMERCIAL#${occurredAt}#${recordType}#${recordId}`,
  }),
  customerCharges: (organizationId: string, customerId: string): Key => ({
    PK: customerPartition(organizationId, customerId),
    SK: 'CHARGE#',
  }),
  customerCharge: (
    organizationId: string,
    customerId: string,
    serviceAt: string,
    chargeId: string,
  ): Key => ({
    PK: customerPartition(organizationId, customerId),
    SK: `CHARGE#${serviceAt}#${chargeId}`,
  }),
  customerPayments: (organizationId: string, customerId: string): Key => ({
    PK: customerPartition(organizationId, customerId),
    SK: 'PAYMENT#',
  }),
  customerPayment: (
    organizationId: string,
    customerId: string,
    paidAt: string,
    paymentId: string,
  ): Key => ({
    PK: customerPartition(organizationId, customerId),
    SK: `PAYMENT#${paidAt}#${paymentId}`,
  }),
} as const;
