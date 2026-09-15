import { randomUUID } from 'node:crypto';
import {
  ChargeSchema,
  FixedCourtAgreementActionInputSchema,
  FixedCourtAgreementBillingInputSchema,
  FixedCourtAgreementInputSchema,
  FixedCourtAgreementSchema,
  FixedCourtAgreementSlotChangeInputSchema,
  FixedCourtOccurrenceSchema,
  type AuthContext,
  type Charge,
  type Court,
  type FixedCourtAgreement,
  type FixedCourtOccurrence,
  type Reservation,
} from '@court-manager/contracts';
import type { RecordItem, Repository } from '../db.js';
import {
  addLocalMinutes,
  dayKeyInTimezone,
  recurrenceDates,
  zonedDateTimeToIso,
} from '../domain.js';
import { AppError } from '../errors.js';
import type { Phase3Persistence } from '../persistence/phase3-repository.js';
import type { CommercialActivityEventService } from './commercial-activity-events.js';
import type { ReservationCreateOptions, ReservationService } from './index.js';

type CourtGateway = {
  get(ctx: AuthContext, courtId: string): Promise<unknown>;
};

type ScheduleGateway = {
  availability(
    ctx: AuthContext,
    court: Court,
    date: string,
    durationMinutes: number,
  ): Promise<string[]>;
};

const now = () => new Date().toISOString();
const agreementId = () => `fixed-agreement-${randomUUID()}`;
const seriesIdFor = (id: string) => `fixed-series-${id}`;
const weekdays: Record<FixedCourtAgreement['weekday'], number> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

const validationError = (error: { flatten: () => unknown }) =>
  new AppError(
    'VALIDATION_ERROR',
    'Fixed court agreement validation failed.',
    error.flatten() as Record<string, unknown>,
  );

const assertStaff = (ctx: AuthContext) => {
  if (!['OWNER', 'STAFF'].includes(ctx.role))
    throw new AppError(
      'FORBIDDEN',
      'You do not have permission for this operation.',
    );
};

const validDate = (value: string) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new AppError('VALIDATION_ERROR', 'Expected a valid calendar date.');
  return date;
};

const addDays = (value: string, days: number) => {
  const date = validDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const addMonths = (value: string, months: number) => {
  const date = validDate(value);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
};

const nextBillingDate = (agreement: FixedCourtAgreement, startDate: string) => {
  if (agreement.billingInterval === 'WEEKLY') return addDays(startDate, 7);
  if (agreement.billingInterval === 'MONTHLY') return addMonths(startDate, 1);
  return addDays(startDate, agreement.customIntervalDays ?? 1);
};

const materializationEnd = (agreement: FixedCourtAgreement) =>
  agreement.endDate ?? addDays(agreement.startDate, 365);

const datesFor = (
  agreement: Pick<
    FixedCourtAgreement,
    'startDate' | 'endDate' | 'weekday' | 'intervalWeeks'
  >,
  fromDate = agreement.startDate,
) =>
  recurrenceDates(
    fromDate,
    agreement.endDate ?? addDays(agreement.startDate, 365),
    weekdays[agreement.weekday],
    agreement.intervalWeeks,
  );

const asAgreement = (value: unknown) => {
  const parsed = FixedCourtAgreementSchema.safeParse(value);
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
};

const asOccurrence = (value: unknown) => {
  const parsed = FixedCourtOccurrenceSchema.safeParse(value);
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
};

/**
 * Fixed agreements own commercial billing, while each occurrence still goes
 * through ReservationService and ScheduleService for occupancy and history.
 */
export class FixedCourtAgreementService {
  constructor(
    private readonly persistence: Phase3Persistence,
    private readonly repo: Repository,
    private readonly courts: CourtGateway,
    private readonly schedule: ScheduleGateway,
    private readonly reservations: ReservationService,
    private readonly activityEvents?: CommercialActivityEventService,
  ) {}

  private async recordEvent(
    eventType:
      | 'FIXED_AGREEMENT_STARTED'
      | 'FIXED_AGREEMENT_CHANGED'
      | 'FIXED_AGREEMENT_CANCELLED',
    agreement: FixedCourtAgreement,
    occurredAt: string,
    dedupeKey?: string,
  ) {
    await this.activityEvents?.record({
      organizationId: agreement.organizationId,
      customerId: agreement.customerId,
      eventType,
      sourceType: 'FIXED_AGREEMENT',
      sourceId: agreement.agreementId,
      occurredAt,
      ...(dedupeKey ? { dedupeKey } : {}),
    });
  }

  private async organizationSettings(organizationId: string) {
    const organization = await this.repo.get<RecordItem>({
      PK: `ORG#${organizationId}`,
      SK: 'META',
    });
    return {
      timezone: String(organization?.timezone ?? 'UTC'),
      currency: String(organization?.currency ?? 'BRL'),
    };
  }

  private async customerExists(ctx: AuthContext, customerId: string) {
    const customer = await this.repo.get<RecordItem>({
      PK: `ORG#${ctx.organizationId}`,
      SK: `CUSTOMER#${customerId}`,
    });
    if (!customer || customer.entity !== 'customer' || customer.archived)
      throw new AppError('NOT_FOUND', 'Customer was not found.');
  }

  private async conflicts(
    ctx: AuthContext,
    agreement: Pick<
      FixedCourtAgreement,
      'courtId' | 'weekday' | 'startTime' | 'durationMinutes' | 'intervalWeeks'
    > & { startDate: string; endDate?: string | undefined },
    fromDate = agreement.startDate,
    ignoreDates = new Set<string>(),
  ) {
    const court = (await this.courts.get(ctx, agreement.courtId)) as Court;
    const conflicts: string[] = [];
    for (const date of datesFor(agreement, fromDate)) {
      if (ignoreDates.has(date)) continue;
      const available = await this.schedule.availability(
        ctx,
        court,
        date,
        agreement.durationMinutes,
      );
      if (!available.includes(agreement.startTime)) conflicts.push(date);
    }
    return { court, dates: datesFor(agreement, fromDate), conflicts };
  }

  private async ensureSeries(agreement: FixedCourtAgreement) {
    const seriesId =
      agreement.reservationSeriesId ?? seriesIdFor(agreement.agreementId);
    const existing = await this.repo.get<RecordItem>({
      PK: `SERIES#${seriesId}`,
      SK: 'META',
    });
    if (
      existing &&
      (existing.organizationId !== agreement.organizationId ||
        (existing.agreementId &&
          existing.agreementId !== agreement.agreementId))
    )
      throw new AppError(
        'CONFLICT',
        'The reservation series belongs to another commercial agreement.',
      );
    await this.repo.put({
      PK: `SERIES#${seriesId}`,
      SK: 'META',
      seriesId,
      organizationId: agreement.organizationId,
      frequency: 'WEEKLY',
      intervalWeeks: agreement.intervalWeeks,
      untilDate: materializationEnd(agreement),
      agreementId: agreement.agreementId,
      createdAt: agreement.createdAt,
      updatedAt: agreement.updatedAt,
    });
    return seriesId;
  }

  private async ensureAgreementCharge(
    ctx: AuthContext,
    agreement: FixedCourtAgreement,
    periodStartDate: string,
  ) {
    if (agreement.endDate && periodStartDate > agreement.endDate)
      throw new AppError(
        'INVALID_STATE',
        'The billing period starts after the agreement ends.',
      );
    const chargeId = `fixed-agreement-${agreement.agreementId}-${periodStartDate}`;
    const key = { PK: `CHARGE#${chargeId}`, SK: 'META' };
    const existing = await this.repo.get<RecordItem>(key);
    if (existing) {
      if (
        existing.organizationId !== agreement.organizationId ||
        existing.sourceType !== 'FIXED_COURT_AGREEMENT' ||
        existing.sourceId !== agreement.agreementId
      )
        throw new AppError(
          'CONFLICT',
          'A different charge uses this billing period.',
        );
      await this.persistence.indexCharge(existing as unknown as Charge);
      return existing;
    }
    const parsed = ChargeSchema.safeParse({
      chargeId,
      organizationId: agreement.organizationId,
      customerId: agreement.customerId,
      sourceType: 'FIXED_COURT_AGREEMENT',
      sourceId: agreement.agreementId,
      fixedCourtAgreementId: agreement.agreementId,
      description: 'Fixed recurring court agreement',
      amount: agreement.monthlyPrice,
      serviceAt: `${periodStartDate}T00:00:00.000Z`,
      status: 'ACTIVE',
      createdBy: ctx.userId,
      createdAt: now(),
    });
    if (!parsed.success) throw validationError(parsed.error);
    const charge = { ...parsed.data, ...key, entity: 'charge' as const };
    try {
      await this.repo.put(charge, 'attribute_not_exists(PK)');
    } catch (error) {
      const retry = await this.repo.get<RecordItem>(key);
      if (!retry) throw error;
      await this.persistence.indexCharge(retry as unknown as Charge);
      return retry;
    }
    await this.persistence.indexCharge(parsed.data);
    return parsed.data;
  }

  private async createOccurrences(
    ctx: AuthContext,
    agreement: FixedCourtAgreement,
    dates: string[],
    court: Court,
  ) {
    const created: FixedCourtOccurrence[] = [];
    for (const date of dates) {
      const startAt = zonedDateTimeToIso(
        date,
        agreement.startTime,
        agreement.timezone,
      );
      const endAt = addLocalMinutes(
        date,
        agreement.startTime,
        agreement.durationMinutes,
        agreement.timezone,
      );
      const reservationId = randomUUID();
      const reservation = (await this.reservations.createWithId(
        ctx,
        reservationId,
        {
          courtId: agreement.courtId,
          customerId: agreement.customerId,
          startAt,
          endAt,
          source: 'STAFF',
          seriesId: agreement.reservationSeriesId,
          fixedCourtAgreementId: agreement.agreementId,
        },
        [],
        { skipDirectCharge: true } satisfies ReservationCreateOptions,
      )) as Reservation & { serviceAmount?: number };
      const timestamp = now();
      const occurrence = asOccurrence({
        occurrenceId: `${agreement.agreementId}-${date}-${randomUUID().slice(0, 8)}`,
        organizationId: agreement.organizationId,
        agreementId: agreement.agreementId,
        customerId: agreement.customerId,
        courtId: agreement.courtId,
        reservationId,
        date,
        startAt,
        endAt,
        status: 'BOOKED',
        price: reservation.serviceAmount ?? reservation.expectedAmount,
        currency: agreement.currency,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await this.persistence.putFixedCourtOccurrence(occurrence);
      created.push(occurrence);
    }
    return { created, court };
  }

  private async cancelFutureOccurrences(
    ctx: AuthContext,
    agreement: FixedCourtAgreement,
    effectiveDate: string,
  ) {
    const occurrences =
      await this.persistence.listFixedCourtOccurrencesByAgreement(
        ctx.organizationId,
        agreement.agreementId,
      );
    for (const occurrence of occurrences) {
      if (
        occurrence.status !== 'BOOKED' ||
        occurrence.date < effectiveDate ||
        !occurrence.reservationId
      )
        continue;
      const reservation = await this.repo.get<RecordItem>({
        PK: `RESERVATION#${occurrence.reservationId}`,
        SK: 'META',
      });
      if (reservation?.status === 'BOOKED')
        await this.reservations.transition(
          ctx,
          occurrence.reservationId,
          'CANCELLED',
        );
      const cancelled = asOccurrence({
        ...occurrence,
        status: 'CANCELLED',
        cancelledAt: now(),
        updatedAt: now(),
      });
      await this.persistence.putFixedCourtOccurrence(cancelled, occurrence);
    }
  }

  private async getRaw(ctx: AuthContext, id: string) {
    const agreement = await this.persistence.getFixedCourtAgreement(
      ctx.organizationId,
      id,
    );
    if (!agreement)
      throw new AppError('NOT_FOUND', 'Fixed court agreement was not found.');
    return agreement;
  }

  private effectiveDate(
    agreement: Pick<FixedCourtAgreement, 'timezone'>,
    requestedDate?: string,
  ) {
    return (
      requestedDate ??
      dayKeyInTimezone(new Date().toISOString(), agreement.timezone)
    );
  }

  async list(
    ctx: AuthContext,
    options: {
      status?: FixedCourtAgreement['status'];
      customerId?: string;
      limit?: number;
    } = {},
  ) {
    assertStaff(ctx);
    const agreements = options.customerId
      ? await this.persistence.listFixedCourtAgreementsByCustomer(
          ctx.organizationId,
          options.customerId,
          { limit: options.limit ?? 100 },
        )
      : await this.persistence.listFixedCourtAgreementsByOrganization(
          ctx.organizationId,
          options.limit ?? 100,
        );
    return options.status
      ? agreements.filter((agreement) => agreement.status === options.status)
      : agreements;
  }

  async get(ctx: AuthContext, id: string) {
    assertStaff(ctx);
    const agreement = await this.getRaw(ctx, id);
    const today = dayKeyInTimezone(
      new Date().toISOString(),
      agreement.timezone,
    );
    if (
      agreement.endDate &&
      agreement.endDate < today &&
      ['ACTIVE', 'PAUSED'].includes(agreement.status)
    ) {
      const expired = asAgreement({
        ...agreement,
        status: 'EXPIRED',
        updatedAt: now(),
      });
      await this.persistence.putFixedCourtAgreement(expired, agreement);
      return {
        ...expired,
        occurrences:
          await this.persistence.listFixedCourtOccurrencesByAgreement(
            ctx.organizationId,
            id,
          ),
      };
    }
    return {
      ...agreement,
      occurrences: await this.persistence.listFixedCourtOccurrencesByAgreement(
        ctx.organizationId,
        id,
      ),
    };
  }

  async create(ctx: AuthContext, input: unknown) {
    assertStaff(ctx);
    const parsed = FixedCourtAgreementInputSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    await this.customerExists(ctx, parsed.data.customerId);
    if (parsed.data.membershipId) {
      const membership = await this.persistence.getMembership(
        ctx.organizationId,
        parsed.data.membershipId,
      );
      if (
        !membership ||
        membership.customerId !== parsed.data.customerId ||
        membership.organizationId !== ctx.organizationId
      )
        throw new AppError(
          'NOT_FOUND',
          'The membership was not found for this customer.',
        );
    }
    const settings = await this.organizationSettings(ctx.organizationId);
    const timezone = parsed.data.timezone ?? settings.timezone;
    const court = (await this.courts.get(ctx, parsed.data.courtId)) as Court;
    if (parsed.data.durationMinutes > 240)
      throw new AppError(
        'VALIDATION_ERROR',
        'Fixed court duration cannot exceed 240 minutes.',
      );
    if (parsed.data.endDate && parsed.data.endDate < parsed.data.startDate)
      throw new AppError(
        'VALIDATION_ERROR',
        'End date must not be before start date.',
      );
    const candidate = {
      ...parsed.data,
      timezone,
      currency: parsed.data.currency ?? settings.currency,
      agreementId: agreementId(),
      organizationId: ctx.organizationId,
      status: 'ACTIVE' as const,
      billingInterval: parsed.data.billingInterval,
      createdAt: now(),
      updatedAt: now(),
    };
    const base = asAgreement(candidate);
    const preview = await this.conflicts(ctx, base);
    if (parsed.data.preview)
      return { dates: preview.dates, conflicts: preview.conflicts };
    if (preview.conflicts.length && !parsed.data.skipConflicts)
      throw new AppError(
        'SCHEDULE_CONFLICT',
        'Some fixed court agreement occurrences are unavailable.',
        { conflicts: preview.conflicts },
      );
    const seriesId = await this.ensureSeries(base);
    const agreement = asAgreement({ ...base, reservationSeriesId: seriesId });
    await this.persistence.putFixedCourtAgreement(agreement);
    const dates = preview.dates.filter(
      (date) => !preview.conflicts.includes(date),
    );
    try {
      await this.createOccurrences(ctx, agreement, dates, court);
      await this.ensureAgreementCharge(ctx, agreement, agreement.startDate);
    } catch (error) {
      await this.cancelFutureOccurrences(
        ctx,
        agreement,
        agreement.startDate,
      ).catch(() => undefined);
      const cancelled = asAgreement({
        ...agreement,
        status: 'CANCELLED',
        cancelledAt: now(),
        updatedAt: now(),
      });
      await this.persistence
        .putFixedCourtAgreement(cancelled, agreement)
        .catch(() => undefined);
      throw error;
    }
    await this.recordEvent(
      'FIXED_AGREEMENT_STARTED',
      agreement,
      `${agreement.startDate}T00:00:00.000Z`,
    );
    return {
      ...agreement,
      occurrences: await this.persistence.listFixedCourtOccurrencesByAgreement(
        ctx.organizationId,
        agreement.agreementId,
      ),
      conflicts: preview.conflicts,
    };
  }

  async occurrences(ctx: AuthContext, id: string) {
    assertStaff(ctx);
    await this.getRaw(ctx, id);
    return this.persistence.listFixedCourtOccurrencesByAgreement(
      ctx.organizationId,
      id,
    );
  }

  async pause(ctx: AuthContext, id: string, input: unknown = {}) {
    assertStaff(ctx);
    const parsed = FixedCourtAgreementActionInputSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    const current = await this.getRaw(ctx, id);
    if (current.status !== 'ACTIVE')
      throw new AppError(
        'INVALID_STATE',
        'Only active agreements can be paused.',
      );
    const effectiveDate = this.effectiveDate(
      current,
      parsed.data.effectiveDate,
    );
    await this.cancelFutureOccurrences(ctx, current, effectiveDate);
    const updated = asAgreement({
      ...current,
      status: 'PAUSED',
      updatedAt: now(),
    });
    await this.persistence.putFixedCourtAgreement(updated, current);
    await this.recordEvent(
      'FIXED_AGREEMENT_CHANGED',
      updated,
      updated.updatedAt,
      `PAUSED:${updated.updatedAt}`,
    );
    return updated;
  }

  async resume(ctx: AuthContext, id: string, input: unknown = {}) {
    assertStaff(ctx);
    const parsed = FixedCourtAgreementActionInputSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    const current = await this.getRaw(ctx, id);
    if (current.status !== 'PAUSED')
      throw new AppError(
        'INVALID_STATE',
        'Only paused agreements can be resumed.',
      );
    const effectiveDate = this.effectiveDate(
      current,
      parsed.data.effectiveDate,
    );
    const active = asAgreement({
      ...current,
      status: 'ACTIVE',
      updatedAt: now(),
    });
    const existing =
      await this.persistence.listFixedCourtOccurrencesByAgreement(
        ctx.organizationId,
        id,
      );
    const existingDates = new Set(
      existing
        .filter((item) => item.status === 'BOOKED')
        .map((item) => item.date),
    );
    const preview = await this.conflicts(
      ctx,
      active,
      effectiveDate,
      existingDates,
    );
    if (preview.conflicts.length && !parsed.data.skipConflicts)
      throw new AppError(
        'SCHEDULE_CONFLICT',
        'Some resumed occurrences are unavailable.',
        {
          conflicts: preview.conflicts,
        },
      );
    await this.persistence.putFixedCourtAgreement(active, current);
    await this.createOccurrences(
      ctx,
      active,
      preview.dates.filter(
        (date) => !preview.conflicts.includes(date) && !existingDates.has(date),
      ),
      preview.court,
    );
    await this.recordEvent(
      'FIXED_AGREEMENT_CHANGED',
      active,
      active.updatedAt,
      `RESUMED:${active.updatedAt}`,
    );
    return active;
  }

  async cancel(ctx: AuthContext, id: string, input: unknown = {}) {
    assertStaff(ctx);
    const parsed = FixedCourtAgreementActionInputSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    const current = await this.getRaw(ctx, id);
    if (['CANCELLED', 'EXPIRED'].includes(current.status)) return current;
    await this.cancelFutureOccurrences(
      ctx,
      current,
      this.effectiveDate(current, parsed.data.effectiveDate),
    );
    const updated = asAgreement({
      ...current,
      status: 'CANCELLED',
      cancelledAt: now(),
      updatedAt: now(),
    });
    await this.persistence.putFixedCourtAgreement(updated, current);
    await this.recordEvent(
      'FIXED_AGREEMENT_CANCELLED',
      updated,
      updated.cancelledAt ?? updated.updatedAt,
    );
    return updated;
  }

  async changeSlot(ctx: AuthContext, id: string, input: unknown) {
    assertStaff(ctx);
    const parsed = FixedCourtAgreementSlotChangeInputSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    const current = await this.getRaw(ctx, id);
    if (current.status !== 'ACTIVE')
      throw new AppError(
        'INVALID_STATE',
        'Only active agreements can change future slots.',
      );
    if (current.endDate && parsed.data.effectiveDate > current.endDate)
      throw new AppError(
        'VALIDATION_ERROR',
        'The effective date is after the agreement ends.',
      );
    const candidate = asAgreement({
      ...current,
      ...parsed.data,
      ...(parsed.data.skipConflicts ? {} : {}),
      updatedAt: now(),
    });
    const oldOccurrences =
      await this.persistence.listFixedCourtOccurrencesByAgreement(
        ctx.organizationId,
        id,
      );
    const activeFuture = oldOccurrences.filter(
      (item) =>
        item.status === 'BOOKED' && item.date >= parsed.data.effectiveDate,
    );
    const sameSlot =
      candidate.courtId === current.courtId &&
      candidate.weekday === current.weekday &&
      candidate.startTime === current.startTime &&
      candidate.durationMinutes === current.durationMinutes &&
      candidate.intervalWeeks === current.intervalWeeks;
    const preview = await this.conflicts(
      ctx,
      candidate,
      parsed.data.effectiveDate,
      sameSlot ? new Set(activeFuture.map((item) => item.date)) : new Set(),
    );
    if (preview.conflicts.length && !parsed.data.skipConflicts)
      throw new AppError(
        'SCHEDULE_CONFLICT',
        'Some changed occurrences are unavailable.',
        {
          conflicts: preview.conflicts,
        },
      );
    await this.cancelFutureOccurrences(ctx, current, parsed.data.effectiveDate);
    await this.persistence.putFixedCourtAgreement(candidate, current);
    await this.ensureSeries(candidate);
    const court = (await this.courts.get(ctx, candidate.courtId)) as Court;
    await this.createOccurrences(
      ctx,
      candidate,
      preview.dates.filter((date) => !preview.conflicts.includes(date)),
      court,
    );
    await this.recordEvent(
      'FIXED_AGREEMENT_CHANGED',
      candidate,
      candidate.updatedAt,
      `SLOT:${candidate.updatedAt}`,
    );
    return {
      ...candidate,
      occurrences: await this.persistence.listFixedCourtOccurrencesByAgreement(
        ctx.organizationId,
        id,
      ),
    };
  }

  async bill(ctx: AuthContext, id: string, input: unknown = {}) {
    assertStaff(ctx);
    const parsed = FixedCourtAgreementBillingInputSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    const agreement = await this.getRaw(ctx, id);
    if (['CANCELLED', 'EXPIRED'].includes(agreement.status))
      throw new AppError(
        'INVALID_STATE',
        'Inactive agreements cannot be billed.',
      );
    let periodStartDate = parsed.data.periodStartDate;
    if (!periodStartDate) {
      const charges = await this.persistence.listCustomerCharges(
        agreement.organizationId,
        agreement.customerId,
      );
      const latest = charges
        .filter(
          (charge) =>
            charge.sourceType === 'FIXED_COURT_AGREEMENT' &&
            charge.sourceId === agreement.agreementId,
        )
        .map((charge) => charge.serviceAt.slice(0, 10))
        .sort()
        .at(-1);
      periodStartDate = latest
        ? nextBillingDate(agreement, latest)
        : agreement.startDate;
    }
    if (periodStartDate < agreement.startDate)
      throw new AppError(
        'VALIDATION_ERROR',
        'The billing period precedes the agreement start date.',
      );
    return this.ensureAgreementCharge(ctx, agreement, periodStartDate);
  }
}
