import type { Key } from '../db.js';

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
};
