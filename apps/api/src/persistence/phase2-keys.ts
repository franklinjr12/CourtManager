import type { Key } from '../db.js';

/**
 * Single-table access keys reserved for Phase 2 customer self-service.
 *
 * Primary records keep their own durable identity. Lookup/index records are
 * materialized under the organization or customer partition and must be
 * written transactionally with their source record when correctness depends
 * on them.
 */
export const phase2Keys = {
  customerAccount: (
    organizationId: string,
    customerAccountId: string,
  ): Key => ({
    PK: `ORG#${organizationId}`,
    SK: `CUSTOMER_ACCOUNT#${customerAccountId}`,
  }),
  customerAccountByEmail: (
    organizationId: string,
    normalizedEmail: string,
  ): Key => ({
    PK: `ORG#${organizationId}`,
    SK: `CUSTOMER_ACCOUNT_EMAIL#${normalizedEmail}`,
  }),
  customerAccountByCustomer: (
    organizationId: string,
    customerId: string,
  ): Key => ({
    PK: `ORG#${organizationId}`,
    SK: `CUSTOMER_ACCOUNT_CUSTOMER#${customerId}`,
  }),
  customerSession: (tokenHash: string): Key => ({
    PK: `CUSTOMER_SESSION#${tokenHash}`,
    SK: 'META',
  }),
  customerReservations: (organizationId: string, customerId: string): Key => ({
    PK: `CUSTOMER#${organizationId}#${customerId}`,
    SK: 'RESERVATION#',
  }),
  customerReservation: (
    organizationId: string,
    customerId: string,
    startAt: string,
    reservationId: string,
  ): Key => ({
    PK: `CUSTOMER#${organizationId}#${customerId}`,
    SK: `RESERVATION#${startAt}#${reservationId}`,
  }),
  customerReservationHistory: (
    organizationId: string,
    customerId: string,
    updatedAt: string,
    reservationId: string,
  ): Key => ({
    PK: `CUSTOMER#${organizationId}#${customerId}`,
    SK: `RESERVATION_HISTORY#${updatedAt}#${reservationId}`,
  }),
  customerReservationRequests: (
    organizationId: string,
    customerId: string,
  ): Key => ({
    PK: `CUSTOMER#${organizationId}#${customerId}`,
    SK: 'RESERVATION_REQUEST#',
  }),
  customerReservationRequest: (
    organizationId: string,
    customerId: string,
    createdAt: string,
    requestId: string,
  ): Key => ({
    PK: `CUSTOMER#${organizationId}#${customerId}`,
    SK: `RESERVATION_REQUEST#${createdAt}#${requestId}`,
  }),
  customerReservationPayments: (
    organizationId: string,
    customerId: string,
    reservationId: string,
  ): Key => ({
    PK: `CUSTOMER_PAYMENT#${organizationId}#${customerId}#${reservationId}`,
    SK: 'PAYMENT#',
  }),
  customerReservationPayment: (
    organizationId: string,
    customerId: string,
    reservationId: string,
    paidAt: string,
    paymentId: string,
  ): Key => ({
    PK: `CUSTOMER_PAYMENT#${organizationId}#${customerId}#${reservationId}`,
    SK: `PAYMENT#${paidAt}#${paymentId}`,
  }),
  customerSportPreferences: (
    organizationId: string,
    customerId: string,
  ): Key => ({
    PK: `CUSTOMER#${organizationId}#${customerId}`,
    SK: 'SPORT_PREFERENCES',
  }),
  customersBySportPreference: (
    organizationId: string,
    sportId: string,
  ): Key => ({
    PK: `SPORT_PREFERENCE#${organizationId}#${sportId}`,
    SK: 'CUSTOMER#',
  }),
  customerBySportPreference: (
    organizationId: string,
    sportId: string,
    customerId: string,
  ): Key => ({
    PK: `SPORT_PREFERENCE#${organizationId}#${sportId}`,
    SK: `CUSTOMER#${customerId}`,
  }),
  reservationParticipants: (reservationId: string): Key => ({
    PK: `RESERVATION#${reservationId}`,
    SK: 'PARTICIPANT#',
  }),
  reservationParticipant: (
    reservationId: string,
    participantId: string,
  ): Key => ({
    PK: `RESERVATION#${reservationId}`,
    SK: `PARTICIPANT#${participantId}`,
  }),
  waitlist: (waitlistId: string): Key => ({
    PK: `WAITLIST#${waitlistId}`,
    SK: 'META',
  }),
  organizationWaitlists: (organizationId: string): Key => ({
    PK: `WAITLIST#${organizationId}#ALL`,
    SK: 'ENTRY#',
  }),
  organizationWaitlist: (
    organizationId: string,
    joinedAt: string,
    waitlistId: string,
  ): Key => ({
    PK: `WAITLIST#${organizationId}#ALL`,
    SK: `ENTRY#${joinedAt}#${waitlistId}`,
  }),
  customerWaitlists: (organizationId: string, customerId: string): Key => ({
    PK: `CUSTOMER#${organizationId}#${customerId}`,
    SK: 'WAITLIST#ACTIVE#',
  }),
  customerWaitlist: (
    organizationId: string,
    customerId: string,
    joinedAt: string,
    waitlistId: string,
  ): Key => ({
    PK: `CUSTOMER#${organizationId}#${customerId}`,
    SK: `WAITLIST#ACTIVE#${joinedAt}#${waitlistId}`,
  }),
  customerWaitlistIdentity: (
    organizationId: string,
    customerId: string,
    identity: string,
  ): Key => ({
    PK: `CUSTOMER#${organizationId}#${customerId}`,
    SK: `WAITLIST#ACTIVE_KEY#${identity}`,
  }),
  courtWaitlists: (
    organizationId: string,
    courtId: string,
    desiredDate: string,
    desiredStartTime: string,
  ): Key => ({
    PK: `WAITLIST#${organizationId}#COURT#${courtId}#${desiredDate}#${desiredStartTime}`,
    SK: 'ENTRY#',
  }),
  courtWaitlist: (
    organizationId: string,
    courtId: string,
    desiredDate: string,
    desiredStartTime: string,
    joinedAt: string,
    waitlistId: string,
  ): Key => ({
    PK: `WAITLIST#${organizationId}#COURT#${courtId}#${desiredDate}#${desiredStartTime}`,
    SK: `ENTRY#${joinedAt}#${waitlistId}`,
  }),
  classWaitlists: (organizationId: string, classId: string): Key => ({
    PK: `WAITLIST#${organizationId}#CLASS#${classId}`,
    SK: 'ENTRY#',
  }),
  classWaitlist: (
    organizationId: string,
    classId: string,
    joinedAt: string,
    waitlistId: string,
  ): Key => ({
    PK: `WAITLIST#${organizationId}#CLASS#${classId}`,
    SK: `ENTRY#${joinedAt}#${waitlistId}`,
  }),
  customerActivities: (organizationId: string, customerId: string): Key => ({
    PK: `CUSTOMER#${organizationId}#${customerId}`,
    SK: 'ACTIVITY#',
  }),
  customerActivity: (
    organizationId: string,
    customerId: string,
    startAt: string,
    activityType: string,
    activityId: string,
  ): Key => ({
    PK: `CUSTOMER#${organizationId}#${customerId}`,
    SK: `ACTIVITY#${startAt}#${activityType}#${activityId}`,
  }),
} as const;
