import type { Key, RecordItem } from '../db.js';

/**
 * Single-table access keys for daily front-desk operations (Hoje, Agenda,
 * Reservas).
 *
 * `organizationReservation` is a denormalized copy of each reservation under
 * one organization partition, sorted by start time, so staff screens can read
 * one tenant's date range with a bounded Query instead of a table scan. It is
 * written in the same transaction/put as the source `RESERVATION#<id>` record.
 *
 * `reservationPaymentSummary` materializes the paid amount of one
 * reservation. Payment records stay authoritative; the summary is updated
 * transactionally with optimistic `expected` checks on payment create/remove.
 *
 * `organizationOpenRequest` is a denormalized copy of each public reservation
 * request while it is `REQUESTED`. It is written with the request and deleted
 * in the same write that moves the request out of `REQUESTED`, so Hoje counts
 * pending requests with one bounded Query.
 *
 * `organizationCharge` is a denormalized copy of each charge sorted by
 * `serviceAt`, rewritten wherever the customer charge index is written, so
 * Hoje reads one day's charges with a `CHARGE#<date>` prefix Query.
 */
export const operationalKeys = {
  organizationReservations: (organizationId: string): Key => ({
    PK: `ORG#${organizationId}#RESERVATIONS`,
    SK: 'RESERVATION#',
  }),
  organizationReservation: (
    organizationId: string,
    startAt: string,
    reservationId: string,
  ): Key => ({
    PK: `ORG#${organizationId}#RESERVATIONS`,
    SK: `RESERVATION#${startAt}#${reservationId}`,
  }),
  reservationPaymentSummary: (reservationId: string): Key => ({
    PK: `RESERVATION#${reservationId}`,
    SK: 'PAYMENT_SUMMARY',
  }),
  organizationOpenRequests: (organizationId: string): Key => ({
    PK: `ORG#${organizationId}#OPEN_REQUESTS`,
    SK: 'REQUEST#',
  }),
  organizationOpenRequest: (
    organizationId: string,
    createdAt: string,
    requestId: string,
  ): Key => ({
    PK: `ORG#${organizationId}#OPEN_REQUESTS`,
    SK: `REQUEST#${createdAt}#${requestId}`,
  }),
  organizationCharges: (organizationId: string): Key => ({
    PK: `ORG#${organizationId}#CHARGES`,
    SK: 'CHARGE#',
  }),
  organizationCharge: (
    organizationId: string,
    serviceAt: string,
    chargeId: string,
  ): Key => ({
    PK: `ORG#${organizationId}#CHARGES`,
    SK: `CHARGE#${serviceAt}#${chargeId}`,
  }),
};

const copy = (source: Record<string, unknown>, key: Key, entity: string) =>
  ({
    ...Object.fromEntries(
      Object.entries(source).filter(
        ([name]) => !['PK', 'SK', 'entity'].includes(name),
      ),
    ),
    ...key,
    entity,
  }) as RecordItem;

export const openRequestKey = (request: Record<string, unknown>) =>
  operationalKeys.organizationOpenRequest(
    String(request.organizationId),
    String(request.createdAt),
    String(request.requestId),
  );
export const openRequestIndex = (request: Record<string, unknown>) =>
  copy(request, openRequestKey(request), 'organizationOpenRequestIndex');
export const organizationChargeIndex = (charge: Record<string, unknown>) =>
  copy(
    charge,
    operationalKeys.organizationCharge(
      String(charge.organizationId),
      String(charge.serviceAt),
      String(charge.chargeId),
    ),
    'organizationChargeIndex',
  );
