import {
  DEFAULT_BOOKING_POLICY,
  type BookingPolicy,
  type Court,
  type Reservation,
} from '@court-manager/contracts';
import type { RecordItem, Repository } from '../db.js';
import { calculateDuration, dayKeyInTimezone } from '../domain.js';
import { AppError } from '../errors.js';

export class BookingPolicyService {
  constructor(private readonly repo: Repository) {}
  async organizationTimezone(organizationId: string) {
    const organization = await this.repo.get<RecordItem>({
      PK: `ORG#${organizationId}`,
      SK: 'META',
    });
    return String(organization?.timezone ?? 'UTC');
  }

  async policy(organizationId: string): Promise<BookingPolicy> {
    const organization = await this.repo.get<RecordItem>({
      PK: `ORG#${organizationId}`,
      SK: 'META',
    });
    if (!organization)
      throw new AppError('NOT_FOUND', 'Organization was not found.');
    return (
      (organization.bookingPolicy as BookingPolicy | undefined) ?? {
        ...DEFAULT_BOOKING_POLICY,
      }
    );
  }

  customerBookingWindow(
    policy: BookingPolicy,
    timezone: string,
    at = new Date(),
  ) {
    const firstDate = dayKeyInTimezone(at.toISOString(), timezone);
    const lastDate = new Date(`${firstDate}T12:00:00Z`);
    lastDate.setUTCDate(lastDate.getUTCDate() + policy.bookAheadDays);
    return { firstDate, lastDate: lastDate.toISOString().slice(0, 10) };
  }

  customerAllowedDurations(policy: BookingPolicy, court: Court) {
    const increment = Math.max(30, court.slotMinutes);
    const first =
      Math.ceil(policy.minimumReservationMinutes / increment) * increment;
    const result: number[] = [];
    for (
      let duration = first;
      duration <= policy.maximumReservationMinutes;
      duration += increment
    )
      result.push(duration);
    return result;
  }

  assertCustomerCanBook(
    policy: BookingPolicy,
    timezone: string,
    court: Court,
    startAt: string,
    endAt: string,
    at = new Date(),
  ) {
    if (policy.reservationMode === 'STAFF_ONLY')
      throw new AppError(
        'FORBIDDEN',
        'Online booking is disabled for this venue.',
      );
    const start = new Date(startAt);
    if (start.getTime() <= at.getTime())
      throw new AppError('VALIDATION_ERROR', 'Past times cannot be booked.');
    const date = dayKeyInTimezone(startAt, timezone);
    const window = this.customerBookingWindow(policy, timezone, at);
    if (date < window.firstDate || date > window.lastDate)
      throw new AppError(
        'VALIDATION_ERROR',
        'Requested time is outside the customer booking window.',
      );
    const duration = calculateDuration(start, new Date(endAt));
    if (!this.customerAllowedDurations(policy, court).includes(duration))
      throw new AppError(
        'VALIDATION_ERROR',
        'Reservation duration is not allowed by venue policy.',
      );
  }

  async customerActiveBookingCount(
    organizationId: string,
    customerId: string,
    at = new Date(),
  ) {
    const activeReservations = (
      await this.repo.scan<RecordItem>(
        (item) =>
          item.entity === 'reservation' &&
          item.organizationId === organizationId &&
          item.customerId === customerId,
      )
    ).filter(
      (reservation) =>
        ['BOOKED', 'CHECKED_IN'].includes(String(reservation.status)) &&
        Date.parse(String(reservation.endAt)) > at.getTime(),
    );
    const pendingRequests = (
      await this.repo.scan<RecordItem>(
        (item) =>
          item.entity === 'request' &&
          item.organizationId === organizationId &&
          item.linkedCustomerId === customerId,
      )
    ).filter(
      (request) =>
        request.status === 'REQUESTED' &&
        Date.parse(String(request.requestedEndAt)) > at.getTime(),
    );
    return activeReservations.length + pendingRequests.length;
  }

  async assertCustomerCanCreateBooking(
    organizationId: string,
    customerId: string,
    policy: BookingPolicy,
    at = new Date(),
  ) {
    const count = await this.customerActiveBookingCount(
      organizationId,
      customerId,
      at,
    );
    if (count >= policy.maximumActiveBookings)
      throw new AppError(
        'CONFLICT',
        'Maximum active customer bookings reached.',
      );
    return count;
  }

  customerCancellationEligibility(
    reservation: Reservation,
    policy: BookingPolicy,
    at = new Date(),
  ) {
    const cutoffAt = new Date(
      Date.parse(reservation.startAt) -
        policy.cancellationCutoffHours * 3600000,
    );
    const eligible = reservation.status === 'BOOKED' && at < cutoffAt;
    const reason =
      reservation.status === 'CANCELLED'
        ? 'Reservation is already cancelled.'
        : reservation.status === 'COMPLETED'
          ? 'Reservation is already completed.'
          : reservation.status !== 'BOOKED'
            ? 'Reservation cannot be cancelled in its current state.'
            : 'Cancellation period has ended.';
    return {
      reservationId: reservation.reservationId,
      eligible,
      status: reservation.status,
      cutoffAt: cutoffAt.toISOString(),
      evaluatedAt: at.toISOString(),
      ...(eligible
        ? {}
        : {
            reason,
          }),
    };
  }
}
