import type {
  BookingPolicy,
  Court,
  CustomerAuthContext,
  CustomerRebookingDraft,
  CustomerReservationRequest,
  CustomerReservationSummary,
  Reservation,
} from '@court-manager/contracts';
import type { RecordItem, Repository } from '../db.js';
import { calculateDuration, dayKeyInTimezone, localTime } from '../domain.js';
import { AppError } from '../errors.js';
import { phase2Keys } from '../persistence/phase2-keys.js';
import { BookingPolicyService } from './booking-policy.js';
import type { CustomerBookingService } from './customer-bookings.js';
import { ReservationParticipantService } from './reservation-participants.js';

type ReservationWriter = {
  cancelForCustomer(
    customer: CustomerAuthContext,
    reservationId: string,
    policy: BookingPolicy,
  ): Promise<unknown>;
};

const as = <T>(item: RecordItem): T =>
  Object.fromEntries(
    Object.entries(item).filter(
      ([name]) => !['PK', 'SK', 'entity'].includes(name),
    ),
  ) as T;

const key = (entity: string, value: string) => ({
  PK: `${entity.toUpperCase()}#${value}`,
  SK: 'META',
});
const HISTORICAL_RESERVATION_STATUSES = [
  'CANCELLED',
  'COMPLETED',
  'NO_SHOW',
] as const;

export class CustomerReservationService {
  constructor(
    private readonly repo: Repository,
    private readonly policy: BookingPolicyService,
    private readonly reservations: ReservationWriter,
    private readonly bookings: CustomerBookingService,
    private readonly participants: ReservationParticipantService,
  ) {}

  private async court(ctx: CustomerAuthContext, courtId: string) {
    const court = await this.repo.get<RecordItem>({
      PK: `ORG#${ctx.organizationId}`,
      SK: `COURT#${courtId}`,
    });
    if (!court) throw new AppError('NOT_FOUND', 'Court was not found.');
    return court as unknown as Court;
  }

  private async summary(
    ctx: CustomerAuthContext,
    reservation: Reservation,
    policy: BookingPolicy,
  ): Promise<CustomerReservationSummary> {
    const court = await this.court(ctx, reservation.courtId);
    return {
      itemType: 'RESERVATION',
      reservationId: reservation.reservationId,
      court: { courtId: court.courtId, name: court.name, sport: court.sport },
      startAt: reservation.startAt,
      endAt: reservation.endAt,
      durationMinutes: Math.round(
        (Date.parse(reservation.endAt) - Date.parse(reservation.startAt)) /
          60000,
      ),
      status: reservation.status,
      source: reservation.source,
      expectedAmount: reservation.expectedAmount,
      paymentStatus: await this.paymentStatus(ctx, reservation),
      cancellationEligibility: this.policy.customerCancellationEligibility(
        reservation,
        policy,
      ),
    };
  }

  private async paymentStatus(
    ctx: CustomerAuthContext,
    reservation: Reservation,
  ) {
    const payments = await this.repo.query<RecordItem>(
      phase2Keys.customerReservationPayments(
        ctx.organizationId,
        ctx.customerId,
        reservation.reservationId,
      ).PK,
      { beginsWith: 'PAYMENT#' },
    );
    const paid = payments.reduce(
      (sum, payment) => sum + Number(payment.amount),
      0,
    );
    return paid >= reservation.expectedAmount
      ? 'PAID'
      : paid > 0
        ? 'PARTIALLY_PAID'
        : 'UNPAID';
  }

  async upcoming(ctx: CustomerAuthContext, limit: number) {
    const policy = await this.policy.policy(ctx.organizationId);
    const rows = await this.repo.query<RecordItem>(
      phase2Keys.customerReservations(ctx.organizationId, ctx.customerId).PK,
      {
        between: [`RESERVATION#${new Date().toISOString()}`, 'RESERVATION#~'],
        limit,
      },
    );
    const reservations = await Promise.all(
      rows
        .filter((row) => row.entity === 'customerReservationIndex')
        .filter(
          (row) =>
            !HISTORICAL_RESERVATION_STATUSES.includes(
              String(
                row.status,
              ) as (typeof HISTORICAL_RESERVATION_STATUSES)[number],
            ),
        )
        .map((row) => this.summary(ctx, as<Reservation>(row), policy)),
    );
    const requests = await this.pendingRequests(ctx, limit);
    return { reservations, requests };
  }

  private async pendingRequests(ctx: CustomerAuthContext, limit: number) {
    const rows = await this.repo.query<RecordItem>(
      phase2Keys.customerReservationRequests(ctx.organizationId, ctx.customerId)
        .PK,
      { beginsWith: 'RESERVATION_REQUEST#', limit },
    );
    return Promise.all(
      rows
        .filter(
          (row) =>
            row.entity === 'customerReservationRequestIndex' &&
            row.status === 'REQUESTED',
        )
        .map(async (row): Promise<CustomerReservationRequest> => {
          const court = await this.court(ctx, String(row.courtId));
          return {
            itemType: 'REQUEST',
            requestId: String(row.requestId),
            court: {
              courtId: court.courtId,
              name: court.name,
              sport: court.sport,
            },
            startAt: String(row.requestedStartAt),
            endAt: String(row.requestedEndAt),
            status: 'REQUESTED',
            createdAt: String(row.createdAt),
          };
        }),
    );
  }

  async history(ctx: CustomerAuthContext, limit: number, cursor?: string) {
    const policy = await this.policy.policy(ctx.organizationId);
    const prefix = 'RESERVATION_HISTORY#';
    const decoded = cursor ? decodeURIComponent(cursor) : undefined;
    if (decoded && !decoded.startsWith(prefix))
      throw new AppError(
        'VALIDATION_ERROR',
        'Invalid reservation history cursor.',
      );
    const rows = await this.repo.query<RecordItem>(
      phase2Keys.customerReservations(ctx.organizationId, ctx.customerId).PK,
      {
        between: [decoded ? `${decoded}\u0000` : prefix, `${prefix}~`],
        limit: limit + 1,
      },
    );
    const page = rows.slice(0, limit);
    return {
      data: await Promise.all(
        page
          .filter(
            (row) =>
              row.entity === 'customerReservationHistoryIndex' &&
              HISTORICAL_RESERVATION_STATUSES.includes(
                String(
                  row.status,
                ) as (typeof HISTORICAL_RESERVATION_STATUSES)[number],
              ),
          )
          .map((row) => this.summary(ctx, as<Reservation>(row), policy)),
      ),
      nextCursor:
        rows.length > limit
          ? encodeURIComponent(String(page.at(-1)?.SK))
          : null,
    };
  }

  async rebookingDraft(
    ctx: CustomerAuthContext,
    reservationId: string,
    at = new Date(),
  ): Promise<CustomerRebookingDraft> {
    const record = await this.repo.get<RecordItem>(
      key('reservation', reservationId),
    );
    if (
      !record ||
      record.organizationId !== ctx.organizationId ||
      record.customerId !== ctx.customerId
    )
      throw new AppError('NOT_FOUND', 'Reservation was not found.');
    if (
      !HISTORICAL_RESERVATION_STATUSES.includes(
        String(
          record.status,
        ) as (typeof HISTORICAL_RESERVATION_STATUSES)[number],
      )
    )
      throw new AppError(
        'INVALID_STATE',
        'Only historical reservations can be booked again.',
      );

    const reservation = as<Reservation>(record);
    const sourceCourt = await this.repo.get<RecordItem>({
      PK: `ORG#${ctx.organizationId}`,
      SK: `COURT#${reservation.courtId}`,
    });
    const sport = String(reservation.sport ?? sourceCourt?.sport ?? '').trim();
    if (!sport)
      throw new AppError(
        'NOT_FOUND',
        'The original court is no longer available for rebooking.',
      );

    const timezone = await this.policy.organizationTimezone(ctx.organizationId);
    const bookingPolicy = await this.policy.policy(ctx.organizationId);
    const window = this.policy.customerBookingWindow(
      bookingPolicy,
      timezone,
      at,
    );
    const previousDate = dayKeyInTimezone(reservation.startAt, timezone);
    const startTime = localTime(new Date(reservation.startAt), timezone);
    const durationMinutes = calculateDuration(
      new Date(reservation.startAt),
      new Date(reservation.endAt),
    );
    const currentWeekday = new Date(
      `${window.firstDate}T12:00:00Z`,
    ).getUTCDay();
    const previousWeekday = new Date(`${previousDate}T12:00:00Z`).getUTCDay();
    const offset = (previousWeekday - currentWeekday + 7) % 7 || 7;
    const candidate = new Date(`${window.firstDate}T12:00:00Z`);
    candidate.setUTCDate(candidate.getUTCDate() + offset);
    const candidateDate = candidate.toISOString().slice(0, 10);
    const suggestedDate =
      candidateDate > window.lastDate ? window.lastDate : candidateDate;

    const availability = await this.bookings.availability(ctx, {
      sport,
      date: suggestedDate,
      durationMinutes,
    });
    const preferredCourtId =
      sourceCourt?.active === true &&
      sourceCourt.publiclyRequestable === true &&
      !sourceCourt.archivedAt &&
      String(sourceCourt.sport).toLocaleLowerCase() ===
        sport.toLocaleLowerCase()
        ? reservation.courtId
        : null;

    return {
      sourceReservationId: reservationId,
      date: suggestedDate,
      startTime,
      durationMinutes,
      sport,
      preferredCourtId,
      availability,
    };
  }

  async detail(ctx: CustomerAuthContext, reservationId: string) {
    const record = await this.repo.get<RecordItem>(
      key('reservation', reservationId),
    );
    if (
      !record ||
      record.organizationId !== ctx.organizationId ||
      record.customerId !== ctx.customerId
    )
      throw new AppError('NOT_FOUND', 'Reservation was not found.');
    const reservation = as<Reservation>(record);
    const participants = await this.participants.list(ctx, reservationId);
    return {
      ...(await this.summary(
        ctx,
        reservation,
        await this.policy.policy(ctx.organizationId),
      )),
      participants: participants.participants,
      participantsMutable: participants.mutable,
      participantsNextCursor: participants.nextCursor,
    };
  }

  async cancel(ctx: CustomerAuthContext, id: string) {
    const reservation = await this.repo.get<RecordItem>(key('reservation', id));
    if (reservation) {
      if (
        reservation.organizationId !== ctx.organizationId ||
        reservation.customerId !== ctx.customerId
      )
        throw new AppError('NOT_FOUND', 'Reservation was not found.');
      return this.reservations.cancelForCustomer(
        ctx,
        id,
        await this.policy.policy(ctx.organizationId),
      );
    }
    const request = await this.repo.get<RecordItem>(key('request', id));
    if (
      !request ||
      request.organizationId !== ctx.organizationId ||
      request.linkedCustomerId !== ctx.customerId
    )
      throw new AppError('NOT_FOUND', 'Reservation or request was not found.');
    if (request.status !== 'REQUESTED')
      throw new AppError('INVALID_STATE', 'Request cannot be withdrawn.');
    const timestamp = new Date().toISOString();
    const value = {
      ...as<Record<string, unknown>>(request),
      status: 'WITHDRAWN',
      withdrawnAt: timestamp,
      withdrawnByCustomerAccountId: ctx.customerAccountId,
    };
    const storedRequest = {
      ...value,
      PK: request.PK,
      SK: request.SK,
      entity: 'request' as const,
    };
    await this.repo.transactWrite([
      { type: 'put', item: storedRequest },
      {
        type: 'put',
        item: {
          ...storedRequest,
          ...phase2Keys.customerReservationRequest(
            ctx.organizationId,
            ctx.customerId,
            String(request.createdAt),
            id,
          ),
          entity: 'customerReservationRequestIndex',
        },
      },
    ]);
    return value;
  }
}
