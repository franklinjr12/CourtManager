import { randomUUID } from 'node:crypto';
import {
  BookingPolicySchema,
  DEFAULT_BOOKING_POLICY,
  type AuthContext,
  type BookingPolicy,
  type Court,
  type CustomerAuthContext,
  type CustomerReservationInput,
  type Organization,
  type Reservation,
  type User,
} from '@court-manager/contracts';
import type { Key, RecordItem, Repository, Write } from '../db.js';
import {
  assertTransition,
  assertTimeZone,
  calculateDuration,
  calculatePrice,
  addLocalMinutes,
  dayKeyInTimezone,
  expandSlots,
  isWithinOpeningHours,
  localTime,
  minutes,
  weekdayNameForDate,
  zonedDateTimeToIso,
  normalizeEmail,
  normalizePhone,
  paymentStatus,
  validateMatchDuration,
  recurrenceDates,
} from '../domain.js';
import { AppError } from '../errors.js';
import { classCatalogKey } from '../persistence/class-keys.js';
import { phase2Keys } from '../persistence/phase2-keys.js';
import {
  createToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from '../security.js';
import { reservationActivity } from './customer-activities.js';
import {
  CustomerAccountService,
  CustomerAuthService,
  CustomerSelfProfileService,
} from './customer-auth/index.js';
import {
  BookingPolicyService,
  ClassEnrollmentService,
  CustomerActivityService,
  CustomerBookingService,
  CustomerReservationService,
  ReservationParticipantService,
  WaitlistService,
} from './customer-portal/index.js';

type Input = Record<string, unknown>;
const now = () => new Date().toISOString();
const id = () => randomUUID();
const key = (entity: string, value: string): Key => ({
  PK: `${entity.toUpperCase()}#${value}`,
  SK: 'META',
});
const orgKey = (org: string, entity: string, value: string): Key => ({
  PK: `ORG#${org}`,
  SK: `${entity.toUpperCase()}#${value}`,
});
const as = <T = Record<string, unknown>>(item: RecordItem): T =>
  Object.fromEntries(
    Object.entries(item).filter(
      ([name]) => !['PK', 'SK', 'entity'].includes(name),
    ),
  ) as T;
const stored = (
  value: Record<string, unknown>,
  PK: string,
  SK = 'META',
  entity?: RecordItem['entity'],
): RecordItem =>
  ({ ...value, PK, SK, ...(entity ? { entity } : {}) }) as RecordItem;
const customerReservationIndex = (reservation: RecordItem) => {
  const index = phase2Keys.customerReservation(
    String(reservation.organizationId),
    String(reservation.customerId),
    String(reservation.startAt),
    String(reservation.reservationId),
  );
  return stored(
    as(reservation),
    index.PK,
    index.SK,
    'customerReservationIndex',
  );
};
const customerReservationHistoryIndex = (reservation: RecordItem) => {
  const index = phase2Keys.customerReservationHistory(
    String(reservation.organizationId),
    String(reservation.customerId),
    String(reservation.updatedAt),
    String(reservation.reservationId),
  );
  return stored(
    as(reservation),
    index.PK,
    index.SK,
    'customerReservationHistoryIndex',
  );
};
const customerReservationRequestIndex = (request: RecordItem) => {
  const index = phase2Keys.customerReservationRequest(
    String(request.organizationId),
    String(request.linkedCustomerId),
    String(request.createdAt),
    String(request.requestId),
  );
  return stored(
    as(request),
    index.PK,
    index.SK,
    'customerReservationRequestIndex',
  );
};
const customerReservationPaymentIndex = (payment: RecordItem) => {
  const index = phase2Keys.customerReservationPayment(
    String(payment.organizationId),
    String(payment.customerId),
    String(payment.reservationId),
    String(payment.paidAt),
    String(payment.paymentId),
  );
  return stored(
    as(payment),
    index.PK,
    index.SK,
    'customerReservationPaymentIndex',
  );
};
const withOrg = (ctx: AuthContext, entity: string, items: RecordItem[]) =>
  items.filter(
    (item) =>
      item.organizationId === ctx.organizationId && item.entity === entity,
  );
const assertRole = (ctx: AuthContext, roles: AuthContext['role'][]) => {
  if (!roles.includes(ctx.role))
    throw new AppError(
      'FORBIDDEN',
      'You do not have permission for this operation.',
    );
};
const organizationTimezone = async (
  repo: Repository,
  organizationId: string,
) => {
  const organization = await repo.get<RecordItem>({
    PK: `ORG#${organizationId}`,
    SK: 'META',
  });
  return String(organization?.timezone ?? 'UTC');
};

export class AuthService {
  constructor(private readonly repo: Repository) {}
  async login(email: string, password: string) {
    const users = await this.repo.scan<RecordItem>(
      (x) => x.entity === 'user' && x.email === email.toLowerCase(),
    );
    const record = users[0];
    if (
      !record ||
      !record.active ||
      !(await verifyPassword(password, String(record.passwordHash)))
    )
      throw new AppError('UNAUTHORIZED', 'Invalid email or password.');
    const token = createToken();
    const ttl = Number(process.env.SESSION_TTL_SECONDS ?? 86400);
    await this.repo.put(
      stored(
        {
          userId: record.userId,
          organizationId: record.organizationId,
          expiresAt: Math.floor(Date.now() / 1000) + ttl,
          createdAt: now(),
        },
        `SESSION#${hashToken(token)}`,
      ),
    );
    const organization = await this.repo.get<RecordItem>({
      PK: `ORG#${String(record.organizationId)}`,
      SK: 'META',
    });
    return {
      token,
      user: as(record) as User,
      organization: organization
        ? {
            ...as<Record<string, unknown>>(organization),
            bookingPolicy: organization.bookingPolicy ?? {
              ...DEFAULT_BOOKING_POLICY,
            },
          }
        : undefined,
    };
  }
  async authenticate(token: string) {
    const session = await this.repo.get<RecordItem>({
      PK: `SESSION#${hashToken(token)}`,
      SK: 'META',
    });
    if (!session || Number(session.expiresAt) <= Math.floor(Date.now() / 1000))
      throw new AppError('UNAUTHORIZED', 'Session expired.');
    const user = await this.repo.get<RecordItem>(
      orgKey(String(session.organizationId), 'USER', String(session.userId)),
    );
    if (!user || !user.active)
      throw new AppError('UNAUTHORIZED', 'User is disabled.');
    return {
      organizationId: String(user.organizationId),
      userId: String(user.userId),
      role: String(user.role) as AuthContext['role'],
    };
  }
  async logout(token: string) {
    await this.repo.delete({ PK: `SESSION#${hashToken(token)}`, SK: 'META' });
  }
}

export class OrganizationService {
  constructor(private readonly repo: Repository) {}
  async get(ctx: AuthContext) {
    const value = await this.repo.get<RecordItem>({
      PK: `ORG#${ctx.organizationId}`,
      SK: 'META',
    });
    if (!value) throw new AppError('NOT_FOUND', 'Organization was not found.');
    return {
      ...as<Organization>(value),
      bookingPolicy: (value.bookingPolicy as
        Organization['bookingPolicy'] | undefined) ?? {
        ...DEFAULT_BOOKING_POLICY,
      },
    };
  }
  async update(ctx: AuthContext, input: Input) {
    assertRole(ctx, ['OWNER']);
    if (input.timezone !== undefined) assertTimeZone(String(input.timezone));
    const current = await this.repo.get<RecordItem>({
      PK: `ORG#${ctx.organizationId}`,
      SK: 'META',
    });
    if (!current)
      throw new AppError('NOT_FOUND', 'Organization was not found.');
    const bookingPolicy =
      input.bookingPolicy === undefined
        ? (current.bookingPolicy ?? { ...DEFAULT_BOOKING_POLICY })
        : BookingPolicySchema.parse(input.bookingPolicy);
    const value = stored(
      {
        ...as(current),
        bookingPolicy,
        ...input,
        organizationId: ctx.organizationId,
        updatedAt: now(),
      },
      current.PK,
      current.SK,
      'organization',
    );
    await this.repo.put(value);
    return as(value);
  }
}

export class SportService {
  constructor(private readonly repo: Repository) {}
  private async getRecord(ctx: AuthContext, sportId: string) {
    const sport = await this.repo.get<RecordItem>(
      orgKey(ctx.organizationId, 'SPORT', sportId),
    );
    if (!sport || sport.entity !== 'sport')
      throw new AppError('NOT_FOUND', 'Sport was not found.');
    return sport;
  }
  async list(ctx: AuthContext, includeInactive = false) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    return (
      await this.repo.query<RecordItem>(`ORG#${ctx.organizationId}`, {
        beginsWith: 'SPORT#',
      })
    )
      .filter((sport) => includeInactive || sport.active === true)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map(as);
  }
  async get(ctx: AuthContext, sportId: string) {
    assertRole(ctx, ['OWNER']);
    return as(await this.getRecord(ctx, sportId));
  }
  async create(ctx: AuthContext, input: Input) {
    assertRole(ctx, ['OWNER']);
    const name = String(input.name ?? '').trim();
    if (!name)
      throw new AppError('VALIDATION_ERROR', 'Sport name is required.');
    const existing = await this.repo.query<RecordItem>(
      `ORG#${ctx.organizationId}`,
      { beginsWith: 'SPORT#' },
    );
    if (
      existing.some(
        (sport) => String(sport.name).toLowerCase() === name.toLowerCase(),
      )
    )
      throw new AppError('DUPLICATE', 'A sport with this name already exists.');
    const sportId = id();
    const value = stored(
      {
        sportId,
        organizationId: ctx.organizationId,
        name,
        active: input.active !== false,
        createdAt: now(),
        updatedAt: now(),
      },
      `ORG#${ctx.organizationId}`,
      `SPORT#${sportId}`,
      'sport',
    );
    await this.repo.put(value);
    return as(value);
  }
  async update(ctx: AuthContext, sportId: string, input: Input) {
    assertRole(ctx, ['OWNER']);
    const current = await this.getRecord(ctx, sportId);
    const name =
      input.name === undefined
        ? String(current.name)
        : String(input.name).trim();
    if (!name)
      throw new AppError('VALIDATION_ERROR', 'Sport name is required.');
    const existing = await this.repo.query<RecordItem>(
      `ORG#${ctx.organizationId}`,
      { beginsWith: 'SPORT#' },
    );
    if (
      existing.some(
        (sport) =>
          sport.sportId !== sportId &&
          String(sport.name).toLowerCase() === name.toLowerCase(),
      )
    )
      throw new AppError('DUPLICATE', 'A sport with this name already exists.');
    const value = stored(
      {
        ...as(current),
        name,
        active:
          input.active === undefined
            ? current.active === true
            : input.active === true,
        updatedAt: now(),
      },
      current.PK,
      current.SK,
      'sport',
    );
    await this.repo.put(value);
    return as(value);
  }
  async remove(ctx: AuthContext, sportId: string) {
    assertRole(ctx, ['OWNER']);
    await this.getRecord(ctx, sportId);
    const courts = await this.repo.query<RecordItem>(
      `ORG#${ctx.organizationId}`,
      { beginsWith: 'COURT#' },
    );
    if (courts.some((court) => court.sportId === sportId))
      throw new AppError(
        'CONFLICT',
        'Sport cannot be deleted while courts use it. Deactivate it instead.',
      );
    await this.repo.delete(orgKey(ctx.organizationId, 'SPORT', sportId));
  }
}

export class CourtService {
  constructor(
    private readonly repo: Repository,
    private readonly sports: SportService,
  ) {}
  private async resolveSport(ctx: AuthContext, input: Input) {
    if (input.sportId !== undefined) {
      const sport = await this.repo.get<RecordItem>(
        orgKey(ctx.organizationId, 'SPORT', String(input.sportId)),
      );
      if (!sport || sport.entity !== 'sport' || sport.active !== true)
        throw new AppError('NOT_FOUND', 'Active sport was not found.');
      return { sportId: sport.sportId, sport: String(sport.name) };
    }
    const name = String(input.sport ?? '').trim();
    if (!name) throw new AppError('VALIDATION_ERROR', 'Sport is required.');
    const existing = (await this.sports.list(ctx, true)).find(
      (sport) => String(sport.name).toLowerCase() === name.toLowerCase(),
    ) as Record<string, unknown> | undefined;
    if (existing) {
      if (existing.active !== true)
        throw new AppError('VALIDATION_ERROR', 'Sport is inactive.');
      return { sportId: existing.sportId, sport: String(existing.name) };
    }
    const created = await this.sports.create(ctx, { name });
    return { sportId: created.sportId, sport: String(created.name) };
  }
  private async find(ctx: AuthContext, courtId: string) {
    const court = await this.repo.get<RecordItem>(
      orgKey(ctx.organizationId, 'COURT', courtId),
    );
    if (!court || court.archivedAt || court.active !== true)
      throw new AppError('NOT_FOUND', 'Court was not found.');
    return court;
  }
  async list(ctx: AuthContext, includeArchived = false) {
    return (
      await this.repo.query<RecordItem>(`ORG#${ctx.organizationId}`, {
        beginsWith: 'COURT#',
      })
    )
      .filter((x) => includeArchived || (x.active === true && !x.archivedAt))
      .map(as);
  }
  async get(ctx: AuthContext, id: string) {
    return as(await this.find(ctx, id));
  }
  async create(ctx: AuthContext, input: Input) {
    assertRole(ctx, ['OWNER']);
    const courtId = id(),
      timestamp = now();
    const sport = await this.resolveSport(ctx, input);
    const value = stored(
      {
        ...input,
        ...sport,
        courtId,
        organizationId: ctx.organizationId,
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      `ORG#${ctx.organizationId}`,
      `COURT#${courtId}`,
      'court',
    );
    await this.repo.put(value);
    return as(value);
  }
  async update(ctx: AuthContext, courtId: string, input: Input) {
    assertRole(ctx, ['OWNER']);
    const current = await this.find(ctx, courtId);
    const sport =
      input.sport !== undefined || input.sportId !== undefined
        ? await this.resolveSport(ctx, input)
        : { sportId: current.sportId, sport: current.sport };
    const value = stored(
      {
        ...as(current),
        ...input,
        ...sport,
        courtId,
        organizationId: ctx.organizationId,
        updatedAt: now(),
      },
      current.PK,
      current.SK,
      'court',
    );
    await this.repo.put(value);
    return as(value);
  }
  async archive(ctx: AuthContext, courtId: string) {
    assertRole(ctx, ['OWNER']);
    const current = await this.find(ctx, courtId);
    const records = await this.repo.scan<RecordItem>();
    const nowMs = Date.now();
    const hasFutureOccupancy = records.some((record) => {
      if (
        record.organizationId !== ctx.organizationId ||
        record.courtId !== courtId
      )
        return false;
      if (record.entity === 'reservation')
        return (
          ['BOOKED', 'CHECKED_IN'].includes(String(record.status)) &&
          Date.parse(String(record.startAt)) > nowMs
        );
      if (record.entity === 'block')
        return (
          record.active === true && Date.parse(String(record.startAt)) > nowMs
        );
      if (record.entity === 'class')
        return (
          record.active === true &&
          String(record.endDate ?? record.startDate) >=
            new Date().toISOString().slice(0, 10)
        );
      return false;
    });
    if (hasFutureOccupancy)
      throw new AppError(
        'CONFLICT',
        'Court cannot be archived while future reservations, classes, or blocks exist.',
      );
    const value = stored(
      { ...as(current), active: false, archivedAt: now(), updatedAt: now() },
      current.PK,
      current.SK,
      'court',
    );
    await this.repo.put(value);
    return as(value);
  }
  async restore(ctx: AuthContext, courtId: string) {
    assertRole(ctx, ['OWNER']);
    const current = await this.repo.get<RecordItem>(
      orgKey(ctx.organizationId, 'COURT', courtId),
    );
    if (!current) throw new AppError('NOT_FOUND', 'Court was not found.');
    const rest = as(current);
    delete rest.archivedAt;
    const value = stored(
      { ...rest, active: true, updatedAt: now() },
      current.PK,
      current.SK,
      'court',
    );
    await this.repo.put(value);
    return as(value);
  }
}

export class CustomerService {
  constructor(private readonly repo: Repository) {}
  async list(ctx: AuthContext, search?: string, includeArchived = false) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const records = withOrg(ctx, 'customer', await this.repo.scan());
    return records
      .filter(
        (x) =>
          (includeArchived || !x.archived) &&
          (!search ||
            [x.name, x.phone, x.email].some((v) =>
              String(v ?? '')
                .toLowerCase()
                .includes(search.toLowerCase()),
            )),
      )
      .map(as);
  }
  async get(ctx: AuthContext, customerId: string) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const value = await this.repo.get<RecordItem>(
      orgKey(ctx.organizationId, 'CUSTOMER', customerId),
    );
    if (!value) throw new AppError('NOT_FOUND', 'Customer was not found.');
    return as(value);
  }
  async duplicates(ctx: AuthContext, input: Input) {
    const phone = normalizePhone(String(input.phone ?? '')),
      email = normalizeEmail(
        typeof input.email === 'string' ? input.email : undefined,
      );
    return (await this.list(ctx, undefined, true)).filter(
      (x) =>
        (phone && x.normalizedPhone === phone) ||
        (email && x.normalizedEmail === email),
    );
  }
  async create(ctx: AuthContext, input: Input) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const value = this.record(ctx, input);
    await this.repo.put(value);
    return as(value);
  }
  record(ctx: AuthContext, input: Input, customerId = id()) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const timestamp = now();
    return stored(
      {
        ...input,
        customerId,
        organizationId: ctx.organizationId,
        normalizedPhone: normalizePhone(String(input.phone ?? '')),
        normalizedEmail: normalizeEmail(
          typeof input.email === 'string' ? input.email : undefined,
        ),
        tags: Array.isArray(input.tags) ? input.tags : [],
        archived: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      `ORG#${ctx.organizationId}`,
      `CUSTOMER#${customerId}`,
      'customer',
    );
  }
  async update(ctx: AuthContext, customerId: string, input: Input) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const current = await this.repo.get<RecordItem>(
      orgKey(ctx.organizationId, 'CUSTOMER', customerId),
    );
    if (!current) throw new AppError('NOT_FOUND', 'Customer was not found.');
    const value = stored(
      {
        ...as(current),
        ...input,
        normalizedPhone: normalizePhone(
          String(input.phone ?? current.phone ?? ''),
        ),
        normalizedEmail: normalizeEmail(
          String(input.email ?? current.email ?? ''),
        ),
        updatedAt: now(),
      },
      current.PK,
      current.SK,
      'customer',
    );
    await this.repo.put(value);
    return as(value);
  }
  async archive(ctx: AuthContext, customerId: string) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    return this.update(ctx, customerId, { archived: true });
  }
}

export class ScheduleService {
  constructor(private readonly repo: Repository) {}
  private lockKey(org: string, court: string, date: string, slot: string): Key {
    return { PK: `SCHEDULE#${org}#${court}#${date}`, SK: `LOCK#${slot}` };
  }
  private metaKey(
    org: string,
    court: string,
    date: string,
    type: string,
    occupancyId: string,
  ): Key {
    return {
      PK: `SCHEDULE#${org}#${court}#${date}`,
      SK: `ITEM#${type}#${occupancyId}`,
    };
  }
  async locks(ctx: AuthContext, courtId: string, date: string) {
    return this.repo.query<RecordItem>(
      `SCHEDULE#${ctx.organizationId}#${courtId}#${date}`,
      {
        beginsWith: 'LOCK#',
      },
    );
  }
  async occupy(
    ctx: AuthContext,
    court: Court,
    startAt: string,
    endAt: string,
    occupancyType: 'RESERVATION' | 'CLASS' | 'BLOCK',
    occupancyId: string,
    additionalWrites: import('../db.js').Write[] = [],
  ) {
    const result = await this.occupyMany(
      ctx,
      court,
      [{ startAt, endAt, occupancyType, occupancyId }],
      additionalWrites,
    );
    return result[0] ?? [];
  }
  async occupyMany(
    ctx: AuthContext,
    court: Court,
    occupancies: {
      startAt: string;
      endAt: string;
      occupancyType: 'RESERVATION' | 'CLASS' | 'BLOCK';
      occupancyId: string;
    }[],
    additionalWrites: import('../db.js').Write[] = [],
  ) {
    if (court.active !== true || court.archivedAt)
      throw new AppError('VALIDATION_ERROR', 'Court is inactive.');
    const timezone = await organizationTimezone(this.repo, ctx.organizationId);
    const occupancyWrites: Write[][] = [];
    const result: string[][] = [];
    for (const occupancy of occupancies) {
      const start = new Date(occupancy.startAt);
      const end = new Date(occupancy.endAt);
      const duration = calculateDuration(start, end);
      if (
        duration > 24 * 60 ||
        !isWithinOpeningHours(
          start,
          end,
          court.openingHours,
          court.slotMinutes,
          timezone,
          occupancy.occupancyType === 'RESERVATION',
        )
      )
        throw new AppError(
          'VALIDATION_ERROR',
          'Time is outside court opening hours or slot boundaries.',
        );
      const date = dayKeyInTimezone(occupancy.startAt, timezone);
      const slots = expandSlots(
        localTime(start, timezone),
        localTime(end, timezone),
        court.slotMinutes,
      );
      result.push(slots);
      const writes: Write[] = [
        ...slots.map((slot) => ({
          type: 'put' as const,
          item: stored(
            { ...occupancy },
            `SCHEDULE#${ctx.organizationId}#${court.courtId}#${date}`,
            `LOCK#${slot}`,
          ),
          condition: 'attribute_not_exists(PK)',
        })),
        {
          type: 'put' as const,
          item: stored(
            { ...occupancy },
            `SCHEDULE#${ctx.organizationId}#${court.courtId}#${date}`,
            `ITEM#${occupancy.occupancyType}#${occupancy.occupancyId}`,
          ),
        },
      ];
      if (writes.length > 100)
        throw new AppError(
          'VALIDATION_ERROR',
          'A single court occupancy cannot exceed DynamoDB transaction limits.',
        );
      occupancyWrites.push(writes);
    }
    const batches: Write[][] = [];
    let batch: Write[] = [];
    for (const writes of occupancyWrites) {
      if (batch.length + writes.length > 100) {
        batches.push(batch);
        batch = [];
      }
      batch.push(...writes);
    }
    if (batch.length || !batches.length) batches.push(batch);
    const last = batches[batches.length - 1] ?? [];
    if (last.length + additionalWrites.length <= 100)
      last.push(...additionalWrites);
    else batches.push([...additionalWrites]);
    for (const writes of batches)
      if (writes.length) await this.repo.transactWrite(writes);
    return result;
  }
  async move(
    ctx: AuthContext,
    court: Court,
    oldStartAt: string,
    oldEndAt: string,
    newStartAt: string,
    newEndAt: string,
    occupancyType: 'RESERVATION' | 'CLASS' | 'BLOCK',
    occupancyId: string,
    additionalWrites: import('../db.js').Write[] = [],
    allowPartialEnd = false,
  ) {
    const timezone = await organizationTimezone(this.repo, ctx.organizationId),
      oldStart = new Date(oldStartAt),
      oldEnd = new Date(oldEndAt),
      newStart = new Date(newStartAt),
      newEnd = new Date(newEndAt);
    const duration = calculateDuration(newStart, newEnd);
    if (occupancyType === 'RESERVATION') validateMatchDuration(duration);
    if (
      !isWithinOpeningHours(
        newStart,
        newEnd,
        court.openingHours,
        court.slotMinutes,
        timezone,
        allowPartialEnd,
      )
    )
      throw new AppError(
        'VALIDATION_ERROR',
        'Time is outside court opening hours or slot boundaries.',
      );
    const format = (value: Date) => localTime(value, timezone);
    const oldSlots = expandSlots(
        format(oldStart),
        format(oldEnd),
        court.slotMinutes,
      ),
      newSlots = expandSlots(
        format(newStart),
        format(newEnd),
        court.slotMinutes,
      ),
      oldDate = dayKeyInTimezone(oldStartAt, timezone),
      newDate = dayKeyInTimezone(newStartAt, timezone),
      oldSet = new Set(oldSlots),
      newSet = new Set(newSlots);
    const writes: import('../db.js').Write[] = [];
    for (const slot of oldSlots)
      if (oldDate !== newDate || !newSet.has(slot))
        writes.push({
          type: 'delete',
          key: this.lockKey(ctx.organizationId, court.courtId, oldDate, slot),
        });
    for (const slot of newSlots)
      if (newDate !== oldDate || !oldSet.has(slot))
        writes.push({
          type: 'put',
          item: stored(
            {
              occupancyType,
              occupancyId,
              startAt: newStartAt,
              endAt: newEndAt,
            },
            `SCHEDULE#${ctx.organizationId}#${court.courtId}#${newDate}`,
            `LOCK#${slot}`,
          ),
          condition: 'attribute_not_exists(PK)',
        });
    writes.push({
      type: 'put',
      item: stored(
        { occupancyType, occupancyId, startAt: newStartAt, endAt: newEndAt },
        `SCHEDULE#${ctx.organizationId}#${court.courtId}#${newDate}`,
        `ITEM#${occupancyType}#${occupancyId}`,
      ),
    });
    if (oldDate !== newDate)
      writes.push({
        type: 'delete',
        key: this.metaKey(
          ctx.organizationId,
          court.courtId,
          oldDate,
          occupancyType,
          occupancyId,
        ),
      });
    await this.repo.transactWrite([...writes, ...additionalWrites]);
    return newSlots;
  }
  async release(
    ctx: AuthContext,
    courtId: string,
    startAt: string,
    endAt: string,
    slotMinutes: number,
    occupancyType: string,
    occupancyId: string,
    additionalWrites: import('../db.js').Write[] = [],
  ) {
    const timezone = await organizationTimezone(this.repo, ctx.organizationId),
      start = new Date(startAt),
      end = new Date(endAt);
    const slots = expandSlots(
      localTime(start, timezone),
      localTime(end, timezone),
      slotMinutes,
    );
    const date = dayKeyInTimezone(startAt, timezone);
    await this.repo.transactWrite([
      ...slots.map((slot) => ({
        type: 'delete' as const,
        key: this.lockKey(ctx.organizationId, courtId, date, slot),
      })),
      {
        type: 'delete',
        key: this.metaKey(
          ctx.organizationId,
          courtId,
          date,
          occupancyType,
          occupancyId,
        ),
      },
      ...additionalWrites,
    ]);
  }
  async availability(
    ctx: AuthContext,
    court: Court,
    date: string,
    durationMinutes: number,
  ) {
    if (court.active !== true || court.archivedAt) return [];
    if (
      !Number.isInteger(durationMinutes) ||
      durationMinutes <= 0 ||
      durationMinutes > 240
    )
      throw new AppError('VALIDATION_ERROR', 'Invalid duration.');
    const timezone = await organizationTimezone(this.repo, ctx.organizationId);
    const today = dayKeyInTimezone(new Date().toISOString(), timezone);
    if (date < today) return [];
    const weekday = weekdayNameForDate(date);
    const opening = court.openingHours[weekday as keyof Court['openingHours']];
    if (!opening) return [];
    const occupied = new Set(
      (await this.locks(ctx, court.courtId, date)).map((x) =>
        x.SK.replace('LOCK#', ''),
      ),
    );
    const starts = expandSlots(opening.open, opening.close, court.slotMinutes);
    const count = Math.ceil(durationMinutes / court.slotMinutes);
    return starts.filter(
      (start, i) =>
        (date !== today || start >= localTime(new Date(), timezone)) &&
        minutes(start) + durationMinutes <= minutes(opening.close) &&
        i + count <= starts.length &&
        starts.slice(i, i + count).every((slot) => !occupied.has(slot)),
    );
  }
}

export class ReservationService {
  constructor(
    private readonly repo: Repository,
    private readonly schedule: ScheduleService,
    private readonly courts: CourtService,
  ) {}
  private async get(ctx: AuthContext, reservationId: string) {
    const r = await this.repo.get<RecordItem>(
      key('reservation', reservationId),
    );
    if (!r || r.organizationId !== ctx.organizationId)
      throw new AppError('NOT_FOUND', 'Reservation was not found.');
    if (r.status === 'CONFIRMED') r.status = 'BOOKED';
    return r;
  }
  async list(
    ctx: AuthContext,
    filters: Input,
  ): Promise<
    (Reservation & {
      customerName?: string;
      courtName?: string;
      paidAmount?: number;
      remainingAmount?: number;
      paymentStatus?: string;
    })[]
  > {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const timezone = await organizationTimezone(this.repo, ctx.organizationId);
    const items = withOrg(ctx, 'reservation', await this.repo.scan());
    const result = items
      .filter((x) => !filters.status || x.status === filters.status)
      .filter((x) => !filters.courtId || x.courtId === filters.courtId)
      .filter((x) => !filters.customerId || x.customerId === filters.customerId)
      .filter(
        (x) =>
          !filters.date ||
          dayKeyInTimezone(String(x.startAt), timezone) === filters.date,
      )
      .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)))
      .map((item) => ({
        ...as<Reservation>(item),
        status: (item.status === 'CONFIRMED'
          ? 'BOOKED'
          : item.status) as Reservation['status'],
      }));
    return Promise.all(
      result.map(async (reservation) => {
        const customer = await this.repo.get<RecordItem>(
          orgKey(
            ctx.organizationId,
            'CUSTOMER',
            String(reservation.customerId),
          ),
        );
        const court = await this.repo.get<RecordItem>(
          orgKey(ctx.organizationId, 'COURT', String(reservation.courtId)),
        );
        const payments = withOrg(
          ctx,
          'payment',
          (await this.repo.scan()).filter(
            (payment) => payment.reservationId === reservation.reservationId,
          ),
        );
        const paid = payments.reduce(
          (sum, payment) => sum + Number(payment.amount),
          0,
        );
        return {
          ...reservation,
          ...(customer ? { customerName: String(customer.name) } : {}),
          ...(court ? { courtName: String(court.name) } : {}),
          paidAmount: paid,
          remainingAmount: Math.max(
            0,
            Number(reservation.expectedAmount) - paid,
          ),
          paymentStatus: paymentStatus(
            Number(reservation.expectedAmount),
            paid,
          ),
        };
      }),
    );
  }
  async create(ctx: AuthContext, input: Input) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    return this.createWithId(ctx, id(), input);
  }
  async createWithId(
    ctx: AuthContext,
    reservationId: string,
    input: Input,
    additionalWrites: Write[] = [],
  ) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const court = (await this.courts.get(ctx, String(input.courtId))) as Court;
    const existingCustomer = await this.repo.get<RecordItem>(
      orgKey(ctx.organizationId, 'CUSTOMER', String(input.customerId)),
    );
    const pendingCustomer = additionalWrites.find(
      (write): write is Extract<Write, { type: 'put' }> =>
        write.type === 'put' &&
        write.item.entity === 'customer' &&
        write.item.customerId === input.customerId,
    )?.item;
    const customer = existingCustomer ?? pendingCustomer;
    if (!customer || customer.archived)
      throw new AppError('NOT_FOUND', 'Customer was not found.');
    const start = new Date(String(input.startAt)),
      end = new Date(String(input.endAt));
    const duration = calculateDuration(start, end);
    validateMatchDuration(duration);
    const amount =
      typeof input.expectedAmount === 'number'
        ? input.expectedAmount
        : calculatePrice(Number(court.defaultHourlyPrice), duration);
    const timestamp = now();
    const record = stored(
      {
        ...input,
        sport: court.sport,
        reservationId,
        organizationId: ctx.organizationId,
        status: 'BOOKED',
        source: input.source ?? 'STAFF',
        expectedAmount: amount,
        createdBy: ctx.userId,
        createdAt: timestamp,
        updatedBy: ctx.userId,
        updatedAt: timestamp,
      },
      `RESERVATION#${reservationId}`,
      'META',
      'reservation',
    );
    const charge = stored(
      {
        chargeId: `reservation-${reservationId}`,
        organizationId: ctx.organizationId,
        customerId: input.customerId,
        sourceType: 'RESERVATION',
        sourceId: reservationId,
        reservationId,
        description: 'Court reservation',
        amount,
        serviceAt: input.startAt,
        status: 'ACTIVE',
        createdBy: ctx.userId,
        createdAt: timestamp,
      },
      `CHARGE#reservation-${reservationId}`,
      'META',
      'charge',
    );
    await this.schedule.occupy(
      ctx,
      court,
      String(input.startAt),
      String(input.endAt),
      'RESERVATION',
      reservationId,
      [
        { type: 'put', item: record },
        { type: 'put', item: customerReservationIndex(record) },
        { type: 'put', item: charge },
        {
          type: 'put',
          item: reservationActivity(as<Reservation>(record), court),
        },
        ...additionalWrites,
      ],
    );
    return as(record);
  }
  async update(ctx: AuthContext, reservationId: string, input: Input) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const current = await this.get(ctx, reservationId);
    if (current.status !== 'BOOKED')
      throw new AppError(
        'INVALID_STATE',
        'Only confirmed reservations can be edited.',
      );
    const value = stored(
      {
        ...as(current),
        ...input,
        courtId: current.courtId,
        customerId: current.customerId,
        updatedBy: ctx.userId,
        updatedAt: now(),
      },
      current.PK,
      current.SK,
      'reservation',
    );
    if (input.startAt || input.endAt) {
      const court = (await this.courts.get(
        ctx,
        String(current.courtId),
      )) as Court;
      await this.schedule.move(
        ctx,
        court,
        String(current.startAt),
        String(current.endAt),
        String(input.startAt ?? current.startAt),
        String(input.endAt ?? current.endAt),
        'RESERVATION',
        reservationId,
        [
          { type: 'put', item: value },
          { type: 'put', item: customerReservationIndex(value) },
          { type: 'delete', key: customerReservationIndex(current) },
          {
            type: 'put',
            item: reservationActivity(as<Reservation>(value), court),
          },
        ],
        true,
      );
      if (input.expectedAmount !== undefined) {
        const charge = await this.repo.get<RecordItem>(
          key('charge', `reservation-${reservationId}`),
        );
        if (charge && charge.status === 'ACTIVE')
          await this.repo.put(
            stored(
              { ...as(charge), amount: input.expectedAmount },
              charge.PK,
              charge.SK,
              'charge',
            ),
          );
      }
      return as(value);
    }
    await this.repo.put(value);
    await this.repo.put(customerReservationIndex(value));
    if (input.expectedAmount !== undefined) {
      const charge = await this.repo.get<RecordItem>(
        key('charge', `reservation-${reservationId}`),
      );
      if (charge && charge.status === 'ACTIVE')
        await this.repo.put(
          stored(
            { ...as(charge), amount: input.expectedAmount },
            charge.PK,
            charge.SK,
            'charge',
          ),
        );
    }
    return as(value);
  }
  async transition(
    ctx: AuthContext,
    reservationId: string,
    status: 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW',
  ) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const current = await this.get(ctx, reservationId);
    assertTransition(
      String(current.status) as ReservationServiceStatus,
      status,
    );
    const timestamp = now();
    const value = stored(
      {
        ...as(current),
        status,
        updatedBy: ctx.userId,
        updatedAt: timestamp,
        ...(status === 'CHECKED_IN'
          ? { checkedInAt: timestamp, checkedInBy: ctx.userId }
          : {}),
        ...(status === 'COMPLETED'
          ? { completedAt: timestamp, completedBy: ctx.userId }
          : {}),
        ...(status === 'CANCELLED'
          ? { cancelledAt: timestamp, cancelledBy: ctx.userId }
          : {}),
        ...(status === 'NO_SHOW'
          ? { noShowAt: timestamp, noShowBy: ctx.userId }
          : {}),
      },
      current.PK,
      current.SK,
      'reservation',
    );
    if (status === 'CANCELLED' || status === 'NO_SHOW') {
      const court = (await this.courts.get(
        ctx,
        String(current.courtId),
      )) as Court;
      await this.schedule.release(
        ctx,
        String(current.courtId),
        String(current.startAt),
        String(current.endAt),
        court.slotMinutes,
        'RESERVATION',
        reservationId,
        [
          { type: 'put', item: value },
          { type: 'put', item: customerReservationIndex(value) },
          { type: 'put', item: customerReservationHistoryIndex(value) },
          {
            type: 'put',
            item: reservationActivity(as<Reservation>(value), court),
          },
          ...(status === 'CANCELLED'
            ? [
                {
                  type: 'put' as const,
                  item: stored(
                    {
                      ...((await this.repo.get<RecordItem>(
                        key('charge', `reservation-${reservationId}`),
                      )) ?? {}),
                      status: 'VOID',
                      voidedAt: timestamp,
                      voidedBy: ctx.userId,
                      voidReason: 'Reservation cancelled',
                    },
                    `CHARGE#reservation-${reservationId}`,
                    'META',
                    'charge',
                  ),
                },
              ]
            : []),
        ],
      );
      return as(value);
    }
    await this.repo.put(value);
    await this.repo.put(customerReservationIndex(value));
    if (status === 'COMPLETED')
      await this.repo.put(customerReservationHistoryIndex(value));
    const court = await this.courts.get(ctx, String(current.courtId));
    await this.repo.put(
      reservationActivity(as<Reservation>(value), court as Court),
    );
    return as(value);
  }
  async cancelForCustomer(
    customer: CustomerAuthContext,
    reservationId: string,
    policy: BookingPolicy,
    at = new Date(),
  ) {
    const current = await this.repo.get<RecordItem>(
      key('reservation', reservationId),
    );
    if (
      !current ||
      current.organizationId !== customer.organizationId ||
      current.customerId !== customer.customerId
    )
      throw new AppError('NOT_FOUND', 'Reservation was not found.');
    const eligibility = new BookingPolicyService(
      this.repo,
    ).customerCancellationEligibility(as<Reservation>(current), policy, at);
    if (!eligibility.eligible)
      throw new AppError(
        'INVALID_STATE',
        eligibility.reason ?? 'Reservation cannot be cancelled.',
      );
    const court = await this.repo.get<RecordItem>(
      orgKey(customer.organizationId, 'COURT', String(current.courtId)),
    );
    if (!court) throw new AppError('NOT_FOUND', 'Court was not found.');
    const timestamp = at.toISOString();
    const value = stored(
      {
        ...as(current),
        status: 'CANCELLED',
        updatedBy: customer.customerAccountId,
        updatedAt: timestamp,
        cancelledAt: timestamp,
        cancellationActor: 'CUSTOMER',
        cancelledByCustomerAccountId: customer.customerAccountId,
      },
      current.PK,
      current.SK,
      'reservation',
    );
    const charge = await this.repo.get<RecordItem>(
      key('charge', `reservation-${reservationId}`),
    );
    await this.schedule.release(
      {
        organizationId: customer.organizationId,
        userId: customer.customerAccountId,
        role: 'STAFF',
      },
      String(current.courtId),
      String(current.startAt),
      String(current.endAt),
      Number(court.slotMinutes),
      'RESERVATION',
      reservationId,
      [
        { type: 'put', item: value },
        { type: 'put', item: customerReservationIndex(value) },
        { type: 'put', item: customerReservationHistoryIndex(value) },
        {
          type: 'put',
          item: reservationActivity(
            as<Reservation>(value),
            court as unknown as Court,
          ),
        },
        ...(charge && charge.status === 'ACTIVE'
          ? [
              {
                type: 'put' as const,
                item: stored(
                  {
                    ...as(charge),
                    status: 'VOID',
                    voidedAt: timestamp,
                    voidedBy: customer.customerAccountId,
                    voidReason: 'Reservation cancelled by customer',
                  },
                  charge.PK,
                  charge.SK,
                  'charge',
                ),
              },
            ]
          : []),
      ],
    );
    return as(value);
  }
  async detail(ctx: AuthContext, reservationId: string) {
    const reservation = await this.get(ctx, reservationId);
    const customer = await this.repo.get<RecordItem>(
      orgKey(ctx.organizationId, 'CUSTOMER', String(reservation.customerId)),
    );
    const payments = withOrg(
      ctx,
      'payment',
      (await this.repo.scan()).filter((x) => x.reservationId === reservationId),
    );
    const paid = payments.reduce((sum, x) => sum + Number(x.amount), 0);
    return {
      ...as(reservation),
      customerName: customer?.name,
      payments: payments.map(as),
      paidAmount: paid,
      remainingAmount: Math.max(0, Number(reservation.expectedAmount) - paid),
      paymentStatus: paymentStatus(Number(reservation.expectedAmount), paid),
    };
  }
  async recurring(ctx: AuthContext, input: Input) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const court = (await this.courts.get(ctx, String(input.courtId))) as Court;
    const timezone = await organizationTimezone(this.repo, ctx.organizationId);
    const start = new Date(String(input.startAt)),
      until = String(input.untilDate);
    if (
      Number(input.intervalWeeks ?? 1) < 1 ||
      String(input.frequency ?? 'WEEKLY') !== 'WEEKLY'
    )
      throw new AppError(
        'VALIDATION_ERROR',
        'Only weekly recurrence is supported.',
      );
    const dates = recurrenceDates(
      dayKeyInTimezone(String(input.startAt), timezone),
      until,
      new Date(
        `${dayKeyInTimezone(String(input.startAt), timezone)}T12:00:00Z`,
      ).getUTCDay(),
      Number(input.intervalWeeks ?? 1),
    );
    const duration = calculateDuration(start, new Date(String(input.endAt)));
    validateMatchDuration(duration);
    const time = (value: Date) => localTime(value, timezone);
    const conflicts: string[] = [];
    for (const date of dates) {
      const available = await this.schedule.availability(
        ctx,
        court,
        date,
        duration,
      );
      if (!available.includes(time(start))) conflicts.push(date);
    }
    if (input.preview === true) return { dates, conflicts };
    if (conflicts.length && !input.skipConflicts)
      throw new AppError(
        'SCHEDULE_CONFLICT',
        'Some recurring occurrences are unavailable.',
        {
          conflicts,
        },
      );
    const seriesId = id(),
      series = stored(
        {
          seriesId,
          organizationId: ctx.organizationId,
          frequency: 'WEEKLY',
          intervalWeeks: Number(input.intervalWeeks ?? 1),
          untilDate: until,
          createdBy: ctx.userId,
          createdAt: now(),
        },
        `SERIES#${seriesId}`,
        'META',
      );
    const customer = await this.repo.get<RecordItem>(
      orgKey(ctx.organizationId, 'CUSTOMER', String(input.customerId)),
    );
    if (!customer || customer.archived)
      throw new AppError('NOT_FOUND', 'Customer was not found.');
    const records: RecordItem[] = [];
    try {
      for (const date of dates) {
        if (conflicts.includes(date)) continue;
        const occurrenceStart = zonedDateTimeToIso(date, time(start), timezone);
        const occurrenceEnd = addLocalMinutes(
          date,
          time(start),
          duration,
          timezone,
        );
        const reservationId = id();
        const record = await this.createWithId(ctx, reservationId, {
          courtId: input.courtId,
          customerId: input.customerId,
          startAt: occurrenceStart,
          endAt: occurrenceEnd,
          source: input.source ?? 'STAFF',
          ...(input.expectedAmount !== undefined
            ? { expectedAmount: input.expectedAmount }
            : {}),
          ...(input.notes ? { notes: input.notes } : {}),
          seriesId,
        });
        records.push(
          (await this.repo.get<RecordItem>(
            key('reservation', reservationId),
          )) ??
            stored(
              record,
              `RESERVATION#${reservationId}`,
              'META',
              'reservation',
            ),
        );
      }
      await this.repo.put(series);
    } catch (error) {
      for (const record of records) {
        try {
          await this.schedule.release(
            ctx,
            String(record.courtId),
            String(record.startAt),
            String(record.endAt),
            court.slotMinutes,
            'RESERVATION',
            String(record.reservationId),
            [
              {
                type: 'delete',
                key: key('reservation', String(record.reservationId)),
              },
            ],
          );
        } catch {
          // Preserve the original failure; cleanup is best effort.
        }
      }
      try {
        await this.repo.delete(key('series', seriesId));
      } catch {
        // Preserve the original failure; cleanup is best effort.
      }
      throw error;
    }
    return { seriesId, created: records.map(as), conflicts };
  }
}
type ReservationServiceStatus =
  'BOOKED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export class RequestService {
  constructor(
    private readonly repo: Repository,
    private readonly courts: CourtService,
    private readonly schedule: ScheduleService,
    private readonly reservations: ReservationService,
    private readonly customers: CustomerService,
    private readonly bookingPolicy: BookingPolicyService,
  ) {}
  async publicVenue(slug: string) {
    const orgs = await this.repo.scan<RecordItem>(
      (x) =>
        x.entity === 'organization' && x.slug === slug && x.active === true,
    );
    const org = orgs[0];
    if (!org) throw new AppError('NOT_FOUND', 'Venue was not found.');
    const courts = (
      await this.repo.query<RecordItem>(`ORG#${org.organizationId}`, {
        beginsWith: 'COURT#',
      })
    ).filter(
      (x) =>
        x.active === true && x.publiclyRequestable === true && !x.archivedAt,
    );
    return {
      organizationId: org.organizationId,
      name: org.name,
      slug: org.slug,
      timezone: org.timezone,
      currency: org.currency,
      phone: org.phone,
      email: org.email,
      bookingPolicy: (org.bookingPolicy as BookingPolicy | undefined) ?? {
        ...DEFAULT_BOOKING_POLICY,
      },
      courts: courts.map((x) => ({
        courtId: x.courtId,
        name: x.name,
        sport: x.sport,
        slotMinutes: x.slotMinutes,
      })),
    };
  }
  async publicAvailability(
    slug: string,
    courtId: string,
    date: string,
    duration: number,
  ) {
    const venue = await this.publicVenue(slug);
    const ctx: AuthContext = {
      organizationId: String(venue.organizationId),
      userId: 'public',
      role: 'STAFF',
    };
    const publicCourt = venue.courts.find((court) => court.courtId === courtId);
    if (!publicCourt)
      throw new AppError('NOT_FOUND', 'Court is not publicly available.');
    const court = (await this.courts.get(ctx, courtId)) as Court;
    const policy = await this.bookingPolicy.policy(
      String(venue.organizationId),
    );
    if (policy.reservationMode === 'STAFF_ONLY')
      return { available: [], onlineBookingAvailable: false };
    return {
      available: await this.schedule.availability(ctx, court, date, duration),
      onlineBookingAvailable: true,
    };
  }
  async createPublic(slug: string, input: Input) {
    const venue = await this.publicVenue(slug);
    const ctx: AuthContext = {
      organizationId: String(venue.organizationId),
      userId: 'public',
      role: 'STAFF',
    };
    const court = (await this.courts.get(ctx, String(input.courtId))) as Court;
    const policy = await this.bookingPolicy.policy(
      String(venue.organizationId),
    );
    if (policy.reservationMode !== 'REQUEST_APPROVAL')
      throw new AppError(
        'FORBIDDEN',
        policy.reservationMode === 'AUTO_CONFIRM'
          ? 'Sign in to reserve this court.'
          : 'Online booking is disabled for this venue.',
      );
    if (!court.active || !court.publiclyRequestable)
      throw new AppError(
        'VALIDATION_ERROR',
        'Court is not publicly available.',
      );
    const start = new Date(String(input.requestedStartAt)),
      end = new Date(String(input.requestedEndAt));
    if (start.getTime() < Date.now())
      throw new AppError('VALIDATION_ERROR', 'Past dates cannot be requested.');
    const duration = calculateDuration(start, end);
    validateMatchDuration(duration, true);
    const timezone = String(venue.timezone ?? 'UTC');
    if (
      !isWithinOpeningHours(
        start,
        end,
        court.openingHours,
        court.slotMinutes,
        timezone,
        true,
      )
    )
      throw new AppError(
        'VALIDATION_ERROR',
        'Time is outside court opening hours.',
      );
    const requestId = id();
    const value = stored(
      {
        ...input,
        requestId,
        organizationId: venue.organizationId,
        status: 'REQUESTED',
        createdAt: now(),
      },
      `REQUEST#${requestId}`,
      'META',
      'request',
    );
    await this.repo.put(value);
    await this.repo.put(customerReservationRequestIndex(value));
    return as(value);
  }
  async createForCustomer(
    customer: CustomerAuthContext,
    input: CustomerReservationInput,
  ) {
    const ctx: AuthContext = {
      organizationId: customer.organizationId,
      userId: `customer:${customer.customerAccountId}`,
      role: 'STAFF',
    };
    const court = (await this.courts.get(ctx, input.courtId)) as Court;
    if (!court.active || !court.publiclyRequestable)
      throw new AppError(
        'VALIDATION_ERROR',
        'Court is not publicly available.',
      );
    const timezone = await this.bookingPolicy.organizationTimezone(
      customer.organizationId,
    );
    const policy = await this.bookingPolicy.policy(customer.organizationId);
    this.bookingPolicy.assertCustomerCanBook(
      policy,
      timezone,
      court,
      input.startAt,
      input.endAt,
    );
    await this.bookingPolicy.assertCustomerCanCreateBooking(
      customer.organizationId,
      customer.customerId,
      policy,
    );
    const start = new Date(input.startAt);
    const end = new Date(input.endAt);
    if (
      !isWithinOpeningHours(
        start,
        end,
        court.openingHours,
        court.slotMinutes,
        timezone,
      )
    )
      throw new AppError(
        'VALIDATION_ERROR',
        'Time is outside court opening hours or slot boundaries.',
      );
    const customerRecord = await this.repo.get<RecordItem>(
      orgKey(customer.organizationId, 'CUSTOMER', customer.customerId),
    );
    if (!customerRecord || customerRecord.archived)
      throw new AppError('NOT_FOUND', 'Customer was not found.');
    const requestId = id();
    const value = stored(
      {
        requestId,
        organizationId: customer.organizationId,
        courtId: court.courtId,
        requestedStartAt: input.startAt,
        requestedEndAt: input.endAt,
        customerName: customerRecord.name,
        linkedCustomerId: customer.customerId,
        status: 'REQUESTED',
        ...(input.notes ? { notes: input.notes } : {}),
        createdAt: now(),
      },
      `REQUEST#${requestId}`,
      'META',
      'request',
    );
    await this.repo.put(value);
    if (value.linkedCustomerId)
      await this.repo.put(customerReservationRequestIndex(value));
    return as(value);
  }
  async list(ctx: AuthContext) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const threshold = Date.now() - 7 * 86400000;
    const values = withOrg(ctx, 'request', await this.repo.scan());
    return values.map((x) => ({
      ...as(x),
      status:
        x.status === 'REQUESTED' && Date.parse(String(x.createdAt)) < threshold
          ? 'EXPIRED'
          : x.status,
    }));
  }
  async reject(ctx: AuthContext, requestId: string, reason?: string) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const request = await this.repo.get<RecordItem>(key('request', requestId));
    if (!request || request.organizationId !== ctx.organizationId)
      throw new AppError('NOT_FOUND', 'Request was not found.');
    if (request.status !== 'REQUESTED')
      throw new AppError('INVALID_STATE', 'Request has already been reviewed.');
    const value = stored(
      {
        ...as(request),
        status: 'REJECTED',
        rejectionReason: reason,
        reviewedAt: now(),
        reviewedBy: ctx.userId,
      },
      request.PK,
      request.SK,
      'request',
    );
    await this.repo.put(value);
    return as(value);
  }
  async confirm(ctx: AuthContext, requestId: string, customerId?: string) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const request = await this.repo.get<RecordItem>(key('request', requestId));
    if (!request || request.organizationId !== ctx.organizationId)
      throw new AppError('NOT_FOUND', 'Request was not found.');
    if (request.status !== 'REQUESTED')
      throw new AppError('INVALID_STATE', 'Request has already been reviewed.');
    const customerRecord = customerId
      ? await this.repo.get<RecordItem>(
          orgKey(ctx.organizationId, 'CUSTOMER', customerId),
        )
      : this.customers.record(ctx, {
          name: request.customerName,
          phone: request.phone,
          email: request.email,
        });
    if (!customerRecord || customerRecord.archived)
      throw new AppError('NOT_FOUND', 'Customer was not found.');
    const reservationId = id();
    const value = stored(
      {
        ...as(request),
        status: 'CONFIRMED',
        linkedCustomerId: customerRecord.customerId,
        linkedReservationId: reservationId,
        reviewedAt: now(),
        reviewedBy: ctx.userId,
      },
      request.PK,
      request.SK,
      'request',
    );
    const reservation = await this.reservations.createWithId(
      ctx,
      reservationId,
      {
        courtId: request.courtId,
        customerId: customerRecord.customerId,
        startAt: request.requestedStartAt,
        endAt: request.requestedEndAt,
        source: 'PUBLIC_REQUEST',
      },
      [
        ...(customerId ? [] : [{ type: 'put' as const, item: customerRecord }]),
        { type: 'put', item: value },
        ...(request.linkedCustomerId
          ? [
              {
                type: 'put' as const,
                item: customerReservationRequestIndex(value),
              },
            ]
          : []),
      ],
    );
    return reservation;
  }
}

export class StaffService {
  constructor(private readonly repo: Repository) {}
  async list(ctx: AuthContext) {
    assertRole(ctx, ['OWNER']);
    return (
      await this.repo.query<RecordItem>(`ORG#${ctx.organizationId}`, {
        beginsWith: 'USER#',
      })
    ).map((user) => {
      const value = as(user);
      delete value.passwordHash;
      return value;
    });
  }
  async coaches(ctx: AuthContext) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    return (
      await this.repo.query<RecordItem>(`ORG#${ctx.organizationId}`, {
        beginsWith: 'USER#',
      })
    )
      .filter((user) => user.role === 'COACH' && user.active === true)
      .map((user) => ({
        userId: String(user.userId),
        name: String(user.name),
      }));
  }
  private async get(ctx: AuthContext, userId: string) {
    const user = await this.repo.get<RecordItem>(
      orgKey(ctx.organizationId, 'USER', userId),
    );
    if (!user) throw new AppError('NOT_FOUND', 'Staff member was not found.');
    return user;
  }
  async create(ctx: AuthContext, input: Input) {
    assertRole(ctx, ['OWNER']);
    const email = normalizeEmail(String(input.email));
    const users = await this.repo.scan<RecordItem>(
      (x) => x.entity === 'user' && x.organizationId === ctx.organizationId,
    );
    if (users.some((x) => normalizeEmail(String(x.email)) === email))
      throw new AppError(
        'CONFLICT',
        'A staff member with this email already exists.',
      );
    const userId = id(),
      timestamp = now();
    const value = stored(
      {
        userId,
        organizationId: ctx.organizationId,
        name: String(input.name).trim(),
        email,
        role: input.role,
        passwordHash: await hashPassword(String(input.password)),
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      `ORG#${ctx.organizationId}`,
      `USER#${userId}`,
      'user',
    );
    await this.repo.put(value);
    const result = as(value);
    delete result.passwordHash;
    return result;
  }
  async update(ctx: AuthContext, userId: string, input: Input) {
    assertRole(ctx, ['OWNER']);
    const current = await this.get(ctx, userId);
    const email =
      input.email === undefined
        ? String(current.email)
        : normalizeEmail(String(input.email));
    const users = await this.repo.scan<RecordItem>(
      (x) => x.entity === 'user' && x.organizationId === ctx.organizationId,
    );
    if (
      current.role === 'OWNER' &&
      current.active === true &&
      input.active === false &&
      users.filter(
        (x) => x.role === 'OWNER' && x.active === true && x.userId !== userId,
      ).length === 0
    )
      throw new AppError(
        'CONFLICT',
        'The final active owner cannot be deactivated.',
      );
    if (
      users.some(
        (x) => x.userId !== userId && normalizeEmail(String(x.email)) === email,
      )
    )
      throw new AppError(
        'CONFLICT',
        'A staff member with this email already exists.',
      );
    if (
      current.role === 'OWNER' &&
      current.active === true &&
      input.role &&
      input.role !== 'OWNER' &&
      users.filter(
        (x) => x.role === 'OWNER' && x.active === true && x.userId !== userId,
      ).length === 0
    )
      throw new AppError(
        'CONFLICT',
        'The final active owner cannot be demoted.',
      );
    const value = stored(
      { ...as(current), ...input, email, updatedAt: now() },
      current.PK,
      current.SK,
      'user',
    );
    await this.repo.put(value);
    const result = as(value);
    delete result.passwordHash;
    return result;
  }
  async resetPassword(ctx: AuthContext, userId: string, password: string) {
    assertRole(ctx, ['OWNER']);
    const current = await this.get(ctx, userId);
    const value = stored(
      {
        ...as(current),
        passwordHash: await hashPassword(password),
        updatedAt: now(),
      },
      current.PK,
      current.SK,
      'user',
    );
    await this.repo.put(value);
    return { reset: true };
  }
  async deactivate(ctx: AuthContext, userId: string) {
    assertRole(ctx, ['OWNER']);
    const users = await this.repo.scan<RecordItem>(
      (x) => x.entity === 'user' && x.organizationId === ctx.organizationId,
    );
    const current = await this.get(ctx, userId);
    if (
      current.role === 'OWNER' &&
      current.active === true &&
      users.filter((x) => x.role === 'OWNER' && x.active === true).length <= 1
    )
      throw new AppError(
        'CONFLICT',
        'The final active owner cannot be deactivated.',
      );
    return this.update(ctx, userId, { active: false });
  }
  async activate(ctx: AuthContext, userId: string) {
    return this.update(ctx, userId, { active: true });
  }
}

export class ChargeService {
  constructor(private readonly repo: Repository) {}
  async list(ctx: AuthContext, filters: Input = {}) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const from = filters.from ? String(filters.from) : undefined,
      to = filters.to ? String(filters.to) : undefined;
    const payments = withOrg(ctx, 'payment', await this.repo.scan());
    return withOrg(ctx, 'charge', await this.repo.scan())
      .filter(
        (charge) =>
          (!filters.customerId || charge.customerId === filters.customerId) &&
          (!filters.sourceType || charge.sourceType === filters.sourceType) &&
          (!from || String(charge.serviceAt).slice(0, 10) >= from) &&
          (!to || String(charge.serviceAt).slice(0, 10) <= to) &&
          (String(filters.outstandingOnly) !== 'true' ||
            this.paidFor(charge, payments) < Number(charge.amount)),
      )
      .map((charge) => ({
        ...as<Record<string, unknown>>(charge),
        paidAmount: this.paidFor(charge, payments),
        outstanding: Math.max(
          0,
          Number(charge.amount) - this.paidFor(charge, payments),
        ),
        paymentStatus: paymentStatus(
          Number(charge.amount),
          this.paidFor(charge, payments),
        ),
      }));
  }
  private paidFor(charge: RecordItem, payments: RecordItem[]) {
    return payments
      .filter(
        (payment) =>
          payment.chargeId === charge.chargeId ||
          (!payment.chargeId &&
            ((charge.reservationId &&
              payment.reservationId === charge.reservationId) ||
              (charge.classId && payment.classId === charge.classId))),
      )
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
  }
  async get(ctx: AuthContext, chargeId: string) {
    const charge = await this.repo.get<RecordItem>(key('charge', chargeId));
    if (!charge || charge.organizationId !== ctx.organizationId)
      throw new AppError('NOT_FOUND', 'Charge was not found.');
    const payments = withOrg(ctx, 'payment', await this.repo.scan());
    return {
      ...as<Record<string, unknown>>(charge),
      paidAmount: this.paidFor(charge, payments),
      outstanding: Math.max(
        0,
        Number(charge.amount) - this.paidFor(charge, payments),
      ),
      paymentStatus: paymentStatus(
        Number(charge.amount),
        this.paidFor(charge, payments),
      ),
    };
  }
  async summary(ctx: AuthContext, filters: Input = {}) {
    const charges = (await this.list(ctx, filters)) as Array<
        Record<string, unknown> & {
          paidAmount: number;
          outstanding: number;
          paymentStatus: string;
        }
      >,
      expenses = withOrg(ctx, 'expense', await this.repo.scan());
    const payments = withOrg(ctx, 'payment', await this.repo.scan())
      .filter(
        (p) =>
          !filters.from ||
          String(p.paidAt).slice(0, 10) >= String(filters.from),
      )
      .filter(
        (p) =>
          !filters.to || String(p.paidAt).slice(0, 10) <= String(filters.to),
      );
    return {
      expectedRevenue: charges
        .filter((x) => x.status === 'ACTIVE')
        .reduce((n, x) => n + Number(x.amount), 0),
      recordedPayments: payments.reduce((n, x) => n + Number(x.amount), 0),
      outstanding: charges
        .filter((x) => x.status === 'ACTIVE')
        .reduce((n, x) => n + Number(x.outstanding), 0),
      expenses: expenses
        .filter(
          (x) =>
            (!filters.from || String(x.date) >= String(filters.from)) &&
            (!filters.to || String(x.date) <= String(filters.to)),
        )
        .reduce((n, x) => n + Number(x.amount), 0),
    };
  }
  async balances(ctx: AuthContext) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const charges = (await this.list(ctx)) as Array<
        Record<string, unknown> & {
          paidAmount: number;
          outstanding: number;
          paymentStatus: string;
        }
      >,
      customers = new Map(
        withOrg(ctx, 'customer', await this.repo.scan()).map((x) => [
          String(x.customerId),
          x,
        ]),
      );
    const result = new Map<
      string,
      {
        customerId: string;
        customerName: string;
        charges: number;
        payments: number;
        outstanding: number;
      }
    >();
    for (const charge of charges.filter((x) => x.status === 'ACTIVE')) {
      const customerId = String(charge.customerId),
        row = result.get(customerId) ?? {
          customerId,
          customerName: String(customers.get(customerId)?.name ?? ''),
          charges: 0,
          payments: 0,
          outstanding: 0,
        };
      row.charges += Number(charge.amount);
      row.payments += Number(charge.paidAmount);
      row.outstanding += Number(charge.outstanding);
      result.set(customerId, row);
    }
    return [...result.values()].sort((a, b) => b.outstanding - a.outstanding);
  }
}

export class PaymentService {
  constructor(private readonly repo: Repository) {}
  async create(ctx: AuthContext, input: Input) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    let chargeId = input.chargeId ? String(input.chargeId) : undefined;
    let reservationId = input.reservationId
      ? String(input.reservationId)
      : undefined;
    let classId = input.classId ? String(input.classId) : undefined;
    if (chargeId) {
      const charge = await this.repo.get<RecordItem>(key('charge', chargeId));
      if (
        !charge ||
        charge.organizationId !== ctx.organizationId ||
        charge.status !== 'ACTIVE'
      )
        throw new AppError('NOT_FOUND', 'Active charge was not found.');
      reservationId = charge.reservationId as string | undefined;
      classId = charge.classId as string | undefined;
      input = {
        ...input,
        customerId: charge.customerId,
        reservationId,
        classId,
        chargeId,
      };
    }
    if ((reservationId ? 1 : 0) + (classId ? 1 : 0) !== 1)
      throw new AppError(
        'VALIDATION_ERROR',
        'Exactly one reservation or class is required.',
      );
    const customer = await this.repo.get<RecordItem>(
      orgKey(ctx.organizationId, 'CUSTOMER', String(input.customerId)),
    );
    if (!customer || customer.archived)
      throw new AppError('NOT_FOUND', 'Customer was not found.');
    if (reservationId) {
      const reservation = await this.repo.get<RecordItem>(
        key('reservation', reservationId),
      );
      if (!reservation || reservation.organizationId !== ctx.organizationId)
        throw new AppError('NOT_FOUND', 'Reservation was not found.');
      if (String(reservation.customerId) !== String(input.customerId))
        throw new AppError(
          'VALIDATION_ERROR',
          'Payment customer does not match the reservation customer.',
        );
    } else {
      const cls = await this.repo.get<RecordItem>(key('class', classId!));
      if (!cls || cls.organizationId !== ctx.organizationId)
        throw new AppError('NOT_FOUND', 'Class was not found.');
    }
    const paymentId = id(),
      value = stored(
        {
          ...input,
          paymentId,
          organizationId: ctx.organizationId,
          recordedBy: ctx.userId,
          createdAt: now(),
        },
        `PAYMENT#${paymentId}`,
        'META',
        'payment',
      );
    await this.repo.put(value);
    if (reservationId)
      await this.repo.put(customerReservationPaymentIndex(value));
    return as(value);
  }
  async remove(ctx: AuthContext, paymentId: string) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const p = await this.repo.get<RecordItem>(key('payment', paymentId));
    if (!p || p.organizationId !== ctx.organizationId)
      throw new AppError('NOT_FOUND', 'Payment was not found.');
    await this.repo.delete(key('payment', paymentId));
    if (p.reservationId)
      await this.repo.delete(customerReservationPaymentIndex(p));
  }
  async list(ctx: AuthContext) {
    return withOrg(ctx, 'payment', await this.repo.scan()).map(as);
  }
}
export class ExpenseService {
  constructor(private readonly repo: Repository) {}
  async list(ctx: AuthContext) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    return withOrg(ctx, 'expense', await this.repo.scan()).map(as);
  }
  async create(ctx: AuthContext, input: Input) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const expenseId = id(),
      value = stored(
        {
          ...input,
          expenseId,
          organizationId: ctx.organizationId,
          createdBy: ctx.userId,
          createdAt: now(),
        },
        `EXPENSE#${expenseId}`,
        'META',
        'expense',
      );
    await this.repo.put(value);
    return as(value);
  }
  async remove(ctx: AuthContext, expenseId: string) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const expense = await this.repo.get<RecordItem>(key('expense', expenseId));
    if (!expense || expense.organizationId !== ctx.organizationId)
      throw new AppError('NOT_FOUND', 'Expense was not found.');
    if (ctx.role !== 'OWNER')
      throw new AppError('FORBIDDEN', 'Only owners can correct expenses.');
    await this.repo.delete(key('expense', expenseId));
  }
}

export class BlockService {
  constructor(
    private readonly repo: Repository,
    private readonly courts: CourtService,
    private readonly schedule: ScheduleService,
  ) {}
  async list(ctx: AuthContext, date?: string) {
    const timezone = await organizationTimezone(this.repo, ctx.organizationId);
    return withOrg(ctx, 'block', await this.repo.scan())
      .filter(
        (x) =>
          x.active &&
          (!date || dayKeyInTimezone(String(x.startAt), timezone) === date),
      )
      .map(as);
  }
  async create(ctx: AuthContext, input: Input) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const court = (await this.courts.get(ctx, String(input.courtId))) as Court;
    const blockId = id();
    const value = stored(
      {
        ...input,
        blockId,
        organizationId: ctx.organizationId,
        active: true,
        createdBy: ctx.userId,
        createdAt: now(),
        updatedAt: now(),
      },
      `BLOCK#${blockId}`,
      'META',
      'block',
    );
    await this.schedule.occupy(
      ctx,
      court,
      String(input.startAt),
      String(input.endAt),
      'BLOCK',
      blockId,
      [{ type: 'put', item: value }],
    );
    return as(value);
  }
  async cancel(ctx: AuthContext, blockId: string) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const block = await this.repo.get<RecordItem>(key('block', blockId));
    if (!block || block.organizationId !== ctx.organizationId)
      throw new AppError('NOT_FOUND', 'Block was not found.');
    const court = (await this.courts.get(ctx, String(block.courtId))) as Court;
    const value = stored(
      {
        ...as(block),
        active: false,
        updatedAt: now(),
      },
      block.PK,
      block.SK,
      'block',
    );
    await this.schedule.release(
      ctx,
      String(block.courtId),
      String(block.startAt),
      String(block.endAt),
      court.slotMinutes,
      'BLOCK',
      blockId,
      [{ type: 'put', item: value }],
    );
    return as(value);
  }
}

export class ClassService {
  constructor(
    private readonly repo: Repository,
    private readonly courts: CourtService,
    private readonly schedule: ScheduleService,
  ) {}
  private async getClass(ctx: AuthContext, classId: string) {
    const value = await this.repo.get<RecordItem>(key('class', classId));
    if (!value || value.organizationId !== ctx.organizationId)
      throw new AppError('NOT_FOUND', 'Class was not found.');
    return value;
  }
  private async authorizeClass(ctx: AuthContext, cls: RecordItem) {
    if (ctx.role === 'COACH' && String(cls.coachId) !== ctx.userId)
      throw new AppError('FORBIDDEN', 'You can only access your own classes.');
  }
  private async sessions(ctx: AuthContext, classId?: string) {
    return withOrg(ctx, 'classSession', await this.repo.scan()).filter(
      (x) => !classId || x.classId === classId,
    );
  }
  async list(ctx: AuthContext) {
    assertRole(ctx, ['OWNER', 'STAFF', 'COACH']);
    const values = withOrg(ctx, 'class', await this.repo.scan());
    return (
      ctx.role === 'COACH'
        ? values.filter((x) => x.coachId === ctx.userId)
        : values
    ).map(as);
  }
  async occurrences(ctx: AuthContext, date: string) {
    assertRole(ctx, ['OWNER', 'STAFF', 'COACH']);
    const values = (await this.sessions(ctx)).filter(
      (x) => String(x.startAt).slice(0, 10) === date,
    );
    const result = [] as Record<string, unknown>[];
    for (const value of values) {
      const cls = await this.getClass(ctx, String(value.classId));
      if (ctx.role === 'COACH' && cls.coachId !== ctx.userId) continue;
      const enrollments = withOrg(
        ctx,
        'enrollment',
        (await this.repo.scan()).filter(
          (x) => x.classId === value.classId && x.status === 'ACTIVE',
        ),
      );
      const attendance = withOrg(
        ctx,
        'attendance',
        (await this.repo.scan()).filter((x) => x.sessionId === value.sessionId),
      );
      result.push({
        ...as(value),
        name: cls.name,
        sport: cls.sport,
        occupancyType: 'CLASS',
        enrolled: enrollments.length,
        checkedIn: attendance.filter((x) =>
          ['CHECKED_IN', 'COMPLETED'].includes(String(x.status)),
        ).length,
      });
    }
    return result;
  }
  async create(ctx: AuthContext, input: Input) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const coach = await this.repo.get<RecordItem>(
      orgKey(ctx.organizationId, 'USER', String(input.coachId)),
    );
    if (!coach || coach.active !== true || coach.role !== 'COACH')
      throw new AppError('NOT_FOUND', 'Active coach was not found.');
    const court = (await this.courts.get(ctx, String(input.courtId))) as Court;
    const classId = id();
    const type = String(input.type ?? 'GROUP');
    const capacity = type === 'PRIVATE' ? 1 : Number(input.capacity);
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new AppError('VALIDATION_ERROR', 'Class capacity is required.');
    const scheduleType = String(input.scheduleType ?? 'WEEKLY');
    const first = String(input.startDate);
    const until = String(input.endDate ?? first);
    const weekday = Number(
      input.weekday ?? new Date(`${first}T12:00:00Z`).getUTCDay(),
    );
    const dates =
      scheduleType === 'SINGLE'
        ? [first]
        : recurrenceDates(
            first,
            until,
            weekday,
            Number(input.intervalWeeks ?? 1),
          );
    const timezone = await organizationTimezone(this.repo, ctx.organizationId);
    const timestamp = now();
    const value = stored(
      {
        ...input,
        classId,
        organizationId: ctx.organizationId,
        type,
        capacity,
        enrolledCount: 0,
        scheduleType,
        weekday,
        intervalWeeks: Number(input.intervalWeeks ?? 1),
        pricePerParticipant: Number(
          input.pricePerParticipant ?? input.price ?? 0,
        ),
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      `CLASS#${classId}`,
      'META',
      'class',
    );
    const occupancies: {
      startAt: string;
      endAt: string;
      occupancyType: 'CLASS';
      occupancyId: string;
    }[] = [];
    const sessionWrites: Write[] = [];
    for (const date of dates) {
      const startAt = zonedDateTimeToIso(
        date,
        String(input.startTime),
        timezone,
      );
      const endAt = addLocalMinutes(
        date,
        String(input.startTime),
        Number(input.durationMinutes),
        timezone,
      );
      const sessionId = `${classId}-${date}`;
      const session = stored(
        {
          sessionId,
          organizationId: ctx.organizationId,
          classId,
          courtId: input.courtId,
          coachId: input.coachId,
          startAt,
          endAt,
          status: 'SCHEDULED',
          capacity,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        `CLASS_SESSION#${sessionId}`,
        'META',
        'classSession',
      );
      sessionWrites.push({
        type: 'put',
        item: session,
        condition: 'attribute_not_exists(PK)',
      });
      occupancies.push({
        startAt,
        endAt,
        occupancyType: 'CLASS',
        occupancyId: sessionId,
      });
    }
    value.sessionIds = sessionWrites.flatMap((write) =>
      write.type === 'put' ? [write.item.sessionId] : [],
    );
    try {
      await this.schedule.occupyMany(ctx, court, occupancies, [
        { type: 'put', item: value },
        {
          type: 'put',
          item: { ...classCatalogKey(ctx.organizationId, classId), classId },
        },
        ...sessionWrites,
      ]);
    } catch (error) {
      for (const session of sessionWrites)
        if (session.type === 'put') {
          try {
            await this.schedule.release(
              ctx,
              String(session.item.courtId),
              String(session.item.startAt),
              String(session.item.endAt),
              court.slotMinutes,
              'CLASS',
              String(session.item.sessionId),
            );
          } catch {
            // Cleanup is best effort; retain the original schedule conflict.
          }
          await this.repo.delete(session.item);
        }
      await this.repo.delete(value);
      await this.repo.delete(classCatalogKey(ctx.organizationId, classId));
      throw error;
    }
    return as(value);
  }
  async getDetail(ctx: AuthContext, classId: string) {
    const cls = await this.getClass(ctx, classId);
    await this.authorizeClass(ctx, cls);
    const sessions = (await this.sessions(ctx, classId)).sort((a, b) =>
      String(a.startAt).localeCompare(String(b.startAt)),
    );
    const enrollments = withOrg(
      ctx,
      'enrollment',
      (await this.repo.scan()).filter((x) => x.classId === classId),
    );
    return {
      ...as(cls),
      enrollments: enrollments.map(as),
      sessions: sessions.map(as),
    };
  }
  async enrollments(ctx: AuthContext, classId: string) {
    const cls = await this.getClass(ctx, classId);
    await this.authorizeClass(ctx, cls);
    return withOrg(
      ctx,
      'enrollment',
      (await this.repo.scan()).filter((x) => x.classId === classId),
    ).map(as);
  }
  async enroll(ctx: AuthContext, classId: string, customerId: string) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    return new ClassEnrollmentService(this.repo).enroll(
      ctx,
      classId,
      customerId,
      ctx.userId,
    );
  }
  async enrollSelf(ctx: CustomerAuthContext, classId: string) {
    return new ClassEnrollmentService(this.repo).enroll(
      ctx,
      classId,
      ctx.customerId,
      ctx.customerAccountId,
    );
  }
  async leaveSelf(ctx: CustomerAuthContext, classId: string) {
    return new ClassEnrollmentService(this.repo).leaveSelf(ctx, classId);
  }
  async customerClasses(ctx: CustomerAuthContext, cursor?: string) {
    return new ClassEnrollmentService(this.repo).discover(ctx, cursor);
  }
  async cancelEnrollment(
    ctx: AuthContext,
    classId: string,
    enrollmentId: string,
  ) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    return new ClassEnrollmentService(this.repo).cancel(
      ctx,
      classId,
      enrollmentId,
      ctx.userId,
    );
  }
  private async getSession(ctx: AuthContext, sessionId: string) {
    const session = await this.repo.get<RecordItem>({
      PK: `CLASS_SESSION#${sessionId}`,
      SK: 'META',
    });
    if (!session || session.organizationId !== ctx.organizationId)
      throw new AppError('NOT_FOUND', 'Class session was not found.');
    const cls = await this.getClass(ctx, String(session.classId));
    await this.authorizeClass(ctx, cls);
    return { session, cls };
  }
  async roster(ctx: AuthContext, sessionId: string) {
    const { session, cls } = await this.getSession(ctx, sessionId);
    const enrollments = withOrg(
      ctx,
      'enrollment',
      (await this.repo.scan()).filter(
        (x) => x.classId === session.classId && x.status === 'ACTIVE',
      ),
    );
    const attendance = withOrg(
      ctx,
      'attendance',
      (await this.repo.scan()).filter((x) => x.sessionId === sessionId),
    );
    const customers = new Map(
      (await this.repo.scan<RecordItem>())
        .filter(
          (x) =>
            x.entity === 'customer' && x.organizationId === ctx.organizationId,
        )
        .map((x) => [String(x.customerId), x]),
    );
    const coach = await this.repo.get<RecordItem>(
      orgKey(ctx.organizationId, 'USER', String(session.coachId)),
    );
    const court = await this.repo.get<RecordItem>(
      orgKey(ctx.organizationId, 'COURT', String(session.courtId)),
    );
    return {
      session: as(session),
      class: as(cls),
      coach: coach ? { userId: coach.userId, name: coach.name } : undefined,
      court: court ? { courtId: court.courtId, name: court.name } : undefined,
      enrollmentCount: enrollments.length,
      participants: enrollments.map((enrollment) => ({
        customerId: enrollment.customerId,
        name: customers.get(String(enrollment.customerId))?.name,
        enrollmentId: enrollment.enrollmentId,
        status:
          attendance.find((x) => x.customerId === enrollment.customerId)
            ?.status ?? 'BOOKED',
        attendanceId: attendance.find(
          (x) => x.customerId === enrollment.customerId,
        )?.attendanceId,
      })),
    };
  }
  async participantTransition(
    ctx: AuthContext,
    sessionId: string,
    customerId: string,
    status: 'CHECKED_IN' | 'COMPLETED' | 'NO_SHOW',
  ) {
    assertRole(ctx, ['OWNER', 'STAFF', 'COACH']);
    const { session } = await this.getSession(ctx, sessionId);
    if (session.status === 'CANCELLED')
      throw new AppError(
        'INVALID_STATE',
        'Cancelled sessions have no attendance lifecycle.',
      );
    const roster = await this.roster(ctx, sessionId);
    const participant = roster.participants.find(
      (x) => x.customerId === customerId,
    );
    if (!participant)
      throw new AppError(
        'NOT_FOUND',
        'Customer is not enrolled in this class.',
      );
    const from = String(participant.status);
    if (!(
      (from === 'BOOKED' && ['CHECKED_IN', 'NO_SHOW'].includes(status)) ||
      (from === 'CHECKED_IN' && status === 'COMPLETED')
    ))
      throw new AppError(
        'INVALID_STATE',
        `Cannot change attendance from ${from} to ${status}.`,
      );
    const timestamp = now();
    const attendanceId = String(
      participant.attendanceId ?? `${sessionId}-${customerId}`,
    );
    const current = attendanceId.includes('-')
      ? await this.repo.get<RecordItem>(key('attendance', attendanceId))
      : undefined;
    const value = stored(
      {
        ...(current ? as(current) : {}),
        attendanceId,
        organizationId: ctx.organizationId,
        classId: session.classId,
        sessionId,
        customerId,
        status,
        recordedBy: ctx.userId,
        createdAt: current?.createdAt ?? timestamp,
        ...(status === 'CHECKED_IN'
          ? { checkedInAt: timestamp, checkedInBy: ctx.userId }
          : {}),
        ...(status === 'COMPLETED'
          ? { completedAt: timestamp, completedBy: ctx.userId }
          : {}),
        ...(status === 'NO_SHOW'
          ? { noShowAt: timestamp, noShowBy: ctx.userId }
          : {}),
      },
      `ATTENDANCE#${attendanceId}`,
      'META',
      'attendance',
    );
    await this.repo.put(value);
    return as(value);
  }
  async completeSession(ctx: AuthContext, sessionId: string) {
    assertRole(ctx, ['OWNER', 'STAFF', 'COACH']);
    const { session } = await this.getSession(ctx, sessionId);
    if (session.status !== 'SCHEDULED')
      throw new AppError('INVALID_STATE', 'Session is not scheduled.');
    const roster = await this.roster(ctx, sessionId);
    for (const participant of roster.participants)
      if (participant.status === 'CHECKED_IN')
        await this.participantTransition(
          ctx,
          sessionId,
          String(participant.customerId),
          'COMPLETED',
        );
      else if (participant.status === 'BOOKED')
        await this.participantTransition(
          ctx,
          sessionId,
          String(participant.customerId),
          'NO_SHOW',
        );
    const timestamp = now();
    const value = stored(
      {
        ...as(session),
        status: 'COMPLETED',
        completedAt: timestamp,
        completedBy: ctx.userId,
        updatedAt: timestamp,
      },
      session.PK,
      session.SK,
      'classSession',
    );
    await this.repo.put(value);
    return as(value);
  }
  async cancelSession(ctx: AuthContext, sessionId: string, reason?: string) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const { session } = await this.getSession(ctx, sessionId);
    if (session.status !== 'SCHEDULED')
      throw new AppError('INVALID_STATE', 'Session is not scheduled.');
    const court = (await this.courts.get(
      ctx,
      String(session.courtId),
    )) as Court;
    const timestamp = now();
    const value = stored(
      {
        ...as(session),
        status: 'CANCELLED',
        cancellationReason: reason,
        cancelledAt: timestamp,
        cancelledBy: ctx.userId,
        updatedAt: timestamp,
      },
      session.PK,
      session.SK,
      'classSession',
    );
    await this.schedule.release(
      ctx,
      String(session.courtId),
      String(session.startAt),
      String(session.endAt),
      court.slotMinutes,
      'CLASS',
      sessionId,
      [{ type: 'put', item: value }],
    );
    for (const charge of withOrg(ctx, 'charge', await this.repo.scan()).filter(
      (x) => x.classSessionId === sessionId && x.status === 'ACTIVE',
    ))
      await this.repo.put(
        stored(
          {
            ...as(charge),
            status: 'VOID',
            voidedAt: timestamp,
            voidedBy: ctx.userId,
            voidReason: 'Class session cancelled',
          },
          charge.PK,
          charge.SK,
          'charge',
        ),
      );
    return as(value);
  }
  async deactivate(ctx: AuthContext, classId: string) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const cls = await this.getClass(ctx, classId);
    const value = stored(
      { ...as(cls), active: false, updatedAt: now() },
      cls.PK,
      cls.SK,
      'class',
    );
    await this.repo.transactWrite([
      {
        type: 'put',
        item: value,
        expected: { enrolledCount: cls.enrolledCount, active: cls.active },
      },
    ]);
    const today = Date.now();
    for (const session of (await this.sessions(ctx, classId)).filter(
      (x) => x.status === 'SCHEDULED' && Date.parse(String(x.startAt)) >= today,
    ))
      await this.cancelSession(
        ctx,
        String(session.sessionId),
        'Class deactivated',
      );
    return as(value);
  }
  async attendance(ctx: AuthContext, input: Input) {
    assertRole(ctx, ['OWNER', 'STAFF', 'COACH']);
    if (input.sessionId)
      return this.participantTransition(
        ctx,
        String(input.sessionId),
        String(input.customerId),
        String(input.status) === 'PRESENT' ? 'CHECKED_IN' : 'NO_SHOW',
      );
    const date = String(input.date);
    const session = (await this.sessions(ctx, String(input.classId))).find(
      (x) => String(x.startAt).slice(0, 10) === date,
    );
    if (!session)
      throw new AppError('NOT_FOUND', 'Class session was not found.');
    return this.participantTransition(
      ctx,
      String(session.sessionId),
      String(input.customerId),
      String(input.status) === 'PRESENT' ? 'CHECKED_IN' : 'NO_SHOW',
    );
  }
}

export class TodayService {
  constructor(private readonly repo: Repository) {}
  async get(ctx: AuthContext, instant = new Date()) {
    const organization = await this.repo.get<RecordItem>(
      key('organization', ctx.organizationId),
    );
    const timezone = String(organization?.timezone ?? 'UTC');
    const date = dayKeyInTimezone(instant.toISOString(), timezone);
    const courts = (
      await this.repo.query<RecordItem>(`ORG#${ctx.organizationId}`, {
        beginsWith: 'COURT#',
      })
    ).filter((x) => x.active === true && !x.archivedAt);
    const reservations =
      ctx.role === 'COACH'
        ? []
        : withOrg(ctx, 'reservation', await this.repo.scan()).filter(
            (x) =>
              dayKeyInTimezone(String(x.startAt), timezone) === date &&
              x.status !== 'CANCELLED',
          );
    const sessions = withOrg(
      ctx,
      'classSession',
      await this.repo.scan(),
    ).filter(
      (x) =>
        dayKeyInTimezone(String(x.startAt), timezone) === date &&
        x.status !== 'CANCELLED' &&
        (ctx.role !== 'COACH' || x.coachId === ctx.userId),
    );
    const blocks =
      ctx.role === 'COACH'
        ? []
        : withOrg(ctx, 'block', await this.repo.scan()).filter(
            (x) =>
              x.active === true &&
              dayKeyInTimezone(String(x.startAt), timezone) === date,
          );
    const customers = new Map(
      withOrg(ctx, 'customer', await this.repo.scan()).map((x) => [
        String(x.customerId),
        x,
      ]),
    );
    const classRecords = new Map(
      withOrg(ctx, 'class', await this.repo.scan()).map((x) => [
        String(x.classId),
        x,
      ]),
    );
    const enrollments = withOrg(
      ctx,
      'enrollment',
      await this.repo.scan(),
    ).filter((x) => x.status === 'ACTIVE');
    const attendance = withOrg(ctx, 'attendance', await this.repo.scan());
    const activity = (
      [
        ...reservations.map((x) => ({ ...x, kind: 'RESERVATION' })),
        ...sessions.map((x) => ({ ...x, kind: 'CLASS' })),
        ...blocks.map((x) => ({ ...x, kind: 'BLOCK' })),
      ] as (RecordItem & { kind: string })[]
    ).sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
    const currentMs = instant.getTime();
    const enrich = (item: RecordItem): Record<string, unknown> => ({
      ...as<Record<string, unknown>>(item),
      startAt: item.startAt,
      endAt: item.endAt,
      customerName: item.customerId
        ? customers.get(String(item.customerId))?.name
        : undefined,
      className: item.classId
        ? classRecords.get(String(item.classId))?.name
        : undefined,
    });
    const courtStatus = courts.map((court) => {
      const current = activity.find(
        (x) =>
          x.courtId === court.courtId &&
          Date.parse(String(x.startAt)) <= currentMs &&
          Date.parse(String(x.endAt)) > currentMs,
      );
      const next = activity.find(
        (x) =>
          x.courtId === court.courtId &&
          Date.parse(String(x.startAt)) > currentMs,
      );
      return {
        court: as(court),
        status: current
          ? current.kind === 'BLOCK'
            ? 'BLOCKED'
            : current.kind
          : 'AVAILABLE',
        current: current ? enrich(current) : undefined,
        next: next ? enrich(next) : undefined,
      };
    });
    const nextHour = currentMs + 60 * 60000;
    const arrivals = reservations
      .filter(
        (x) =>
          x.status === 'BOOKED' &&
          Date.parse(String(x.startAt)) >= currentMs &&
          Date.parse(String(x.startAt)) <= nextHour,
      )
      .map(enrich);
    const classArrivals = sessions
      .filter(
        (x) =>
          Date.parse(String(x.startAt)) >= currentMs &&
          Date.parse(String(x.startAt)) <= nextHour,
      )
      .map((x) => ({
        ...enrich(x),
        participants: enrollments
          .filter((e) => e.classId === x.classId)
          .map((e) => ({
            customerId: e.customerId,
            name: customers.get(String(e.customerId))?.name,
            status:
              attendance.find(
                (a) =>
                  a.sessionId === x.sessionId && a.customerId === e.customerId,
              )?.status ?? 'BOOKED',
          })),
      }));
    const overdue = reservations
      .filter(
        (x) =>
          x.status === 'BOOKED' && Date.parse(String(x.startAt)) <= currentMs,
      )
      .map((x) => ({
        type: 'LATE_RESERVATION_CHECKIN',
        label: `${String(customers.get(String(x.customerId))?.name ?? 'Customer')} has not checked in`,
        reservationId: x.reservationId,
        startAt: x.startAt,
      }));
    const lateClass = sessions.flatMap((x) =>
      enrollments
        .filter((e) => e.classId === x.classId)
        .filter(
          (e) =>
            Date.parse(String(x.startAt)) <= currentMs &&
            !attendance.some(
              (a) =>
                a.sessionId === x.sessionId && a.customerId === e.customerId,
            ),
        )
        .map((e) => ({
          type: 'LATE_CLASS_CHECKIN',
          label: `${String(customers.get(String(e.customerId))?.name ?? 'Customer')} has not checked in`,
          sessionId: x.sessionId,
          customerId: e.customerId,
        })),
    );
    const pendingRequests =
      ctx.role === 'COACH'
        ? []
        : withOrg(ctx, 'request', await this.repo.scan())
            .filter((x) => x.status === 'REQUESTED')
            .map(as);
    const charges =
      ctx.role === 'COACH'
        ? []
        : withOrg(ctx, 'charge', await this.repo.scan()).filter(
            (x) =>
              x.status === 'ACTIVE' &&
              String(x.serviceAt).slice(0, 10) === date,
          );
    const payments =
      ctx.role === 'COACH'
        ? []
        : withOrg(ctx, 'payment', await this.repo.scan());
    const paymentAttention = charges
      .filter((charge) => {
        const paid = payments
          .filter(
            (payment) =>
              payment.chargeId === charge.chargeId ||
              (!payment.chargeId &&
                ((charge.reservationId &&
                  payment.reservationId === charge.reservationId) ||
                  (charge.classId && payment.classId === charge.classId))),
          )
          .reduce((n, payment) => n + Number(payment.amount), 0);
        return paid < Number(charge.amount);
      })
      .map((charge) => ({
        type: 'OUTSTANDING_TODAY_PAYMENT',
        label: `${String(customers.get(String(charge.customerId))?.name ?? 'Customer')} has an outstanding balance`,
        customerId: charge.customerId,
        chargeId: charge.chargeId,
      }));
    return {
      date,
      generatedAt: instant.toISOString(),
      summary: {
        reservations: reservations.length,
        classSessions: sessions.length,
        pendingRequests: pendingRequests.length,
        uncheckedIn: overdue.length + lateClass.length,
        outstandingActions:
          pendingRequests.length +
          overdue.length +
          lateClass.length +
          paymentAttention.length,
      },
      courts: courtStatus,
      arrivalsNextHour: [...arrivals, ...classArrivals].sort((a, b) =>
        String((a as Record<string, unknown>)['startAt']).localeCompare(
          String((b as Record<string, unknown>)['startAt']),
        ),
      ),
      overdueCheckIns: overdue,
      pendingRequests,
      attention: [...overdue, ...lateClass, ...paymentAttention],
    };
  }
}

const eachDate = (from: string, to: string) => {
  const dates: string[] = [],
    current = new Date(`${from}T12:00:00Z`),
    end = new Date(`${to}T12:00:00Z`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
};
export class ReportService {
  constructor(private readonly repo: Repository) {}
  async operations(ctx: AuthContext, filters: Input) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const organization = await this.repo.get<RecordItem>(
        key('organization', ctx.organizationId),
      ),
      timezone = String(organization?.timezone ?? 'UTC');
    const from = String(
        filters.from ??
          dayKeyInTimezone(new Date().toISOString(), timezone).slice(0, 8) +
            '01',
      ),
      to = String(
        filters.to ?? dayKeyInTimezone(new Date().toISOString(), timezone),
      );
    const dates = eachDate(from, to),
      courts = (
        await this.repo.query<RecordItem>(`ORG#${ctx.organizationId}`, {
          beginsWith: 'COURT#',
        })
      ).filter((x) => x.active === true || x.courtId === filters.courtId);
    const reservations = withOrg(
      ctx,
      'reservation',
      await this.repo.scan(),
    ).filter((x) => {
      const day = dayKeyInTimezone(String(x.startAt), timezone);
      return (
        day >= from &&
        day <= to &&
        (!filters.courtId || x.courtId === filters.courtId)
      );
    });
    const sessions = withOrg(
      ctx,
      'classSession',
      await this.repo.scan(),
    ).filter((x) => {
      const day = dayKeyInTimezone(String(x.startAt), timezone);
      return (
        day >= from &&
        day <= to &&
        (!filters.courtId || x.courtId === filters.courtId)
      );
    });
    const blocks = withOrg(ctx, 'block', await this.repo.scan()).filter((x) => {
      const day = dayKeyInTimezone(String(x.startAt), timezone);
      return x.active === true && day >= from && day <= to;
    });
    const opening = (court: RecordItem, date: string) => {
      const weekday = weekdayNameForDate(date);
      const hours = (court.openingHours ?? {}) as Record<
        string,
        { open: string; close: string } | null
      >;
      const value = hours[weekday];
      return value
        ? Number(minutes(String(value.close)) - minutes(String(value.open)))
        : 0;
    };
    const overlapMinutes = (
      aStart: string,
      aEnd: string,
      bStart: string,
      bEnd: string,
    ) =>
      Math.max(
        0,
        Math.min(Date.parse(aEnd), Date.parse(bEnd)) -
          Math.max(Date.parse(aStart), Date.parse(bStart)),
      ) / 60000;
    const utilization = courts.map((court) => {
      const openingMinutes = dates.reduce(
          (n, date) => n + opening(court, date),
          0,
        ),
        blockedMinutes = blocks
          .filter((x) => x.courtId === court.courtId)
          .reduce(
            (n, x) =>
              n +
              overlapMinutes(
                String(x.startAt),
                String(x.endAt),
                `${from}T00:00:00Z`,
                `${to}T23:59:59Z`,
              ),
            0,
          ),
        scheduled = [
          ...reservations.filter(
            (x) => x.courtId === court.courtId && x.status !== 'CANCELLED',
          ),
          ...sessions.filter(
            (x) => x.courtId === court.courtId && x.status !== 'CANCELLED',
          ),
        ],
        scheduledMinutes = scheduled.reduce(
          (n, x) =>
            n +
            (Date.parse(String(x.endAt)) - Date.parse(String(x.startAt))) /
              60000,
          0,
        ),
        actualMinutes =
          reservations
            .filter(
              (x) =>
                x.courtId === court.courtId &&
                ['CHECKED_IN', 'COMPLETED'].includes(String(x.status)),
            )
            .reduce(
              (n, x) =>
                n +
                (Date.parse(String(x.endAt)) - Date.parse(String(x.startAt))) /
                  60000,
              0,
            ) +
          sessions
            .filter(
              (x) => x.courtId === court.courtId && x.status === 'COMPLETED',
            )
            .reduce(
              (n, x) =>
                n +
                (Date.parse(String(x.endAt)) - Date.parse(String(x.startAt))) /
                  60000,
              0,
            ),
        sellableMinutes = Math.max(0, openingMinutes - blockedMinutes);
      return {
        courtId: court.courtId,
        courtName: court.name,
        openingMinutes,
        blockedMinutes,
        sellableMinutes,
        scheduledMinutes,
        actualMinutes,
        scheduledUtilizationPercent: sellableMinutes
          ? (scheduledMinutes / sellableMinutes) * 100
          : 0,
        actualUtilizationPercent: sellableMinutes
          ? (actualMinutes / sellableMinutes) * 100
          : 0,
      };
    });
    const charges = withOrg(ctx, 'charge', await this.repo.scan()).filter(
        (x) =>
          x.status === 'ACTIVE' &&
          String(x.serviceAt).slice(0, 10) >= from &&
          String(x.serviceAt).slice(0, 10) <= to,
      ),
      payments = withOrg(ctx, 'payment', await this.repo.scan()).filter(
        (x) =>
          String(x.paidAt).slice(0, 10) >= from &&
          String(x.paidAt).slice(0, 10) <= to,
      ),
      expenses = withOrg(ctx, 'expense', await this.repo.scan()).filter(
        (x) => String(x.date) >= from && String(x.date) <= to,
      );
    return {
      from,
      to,
      utilization,
      totalReservations: reservations.length,
      completed: reservations.filter((x) => x.status === 'COMPLETED').length,
      cancelled: reservations.filter((x) => x.status === 'CANCELLED').length,
      noShow: reservations.filter((x) => x.status === 'NO_SHOW').length,
      reservationsByCourt: Object.fromEntries(
        courts.map((c) => [
          c.name,
          reservations.filter((r) => r.courtId === c.courtId).length,
        ]),
      ),
      reservationsBySource: Object.fromEntries(
        [
          'STAFF',
          'WHATSAPP',
          'PHONE',
          'WALK_IN',
          'PUBLIC_REQUEST',
          'OTHER',
        ].map((source) => [
          source,
          reservations.filter((r) => r.source === source).length,
        ]),
      ),
      expectedRevenue: charges.reduce((n, x) => n + Number(x.amount), 0),
      recordedPayments: payments.reduce((n, x) => n + Number(x.amount), 0),
      outstanding: charges.reduce(
        (n, charge) =>
          n +
          Math.max(
            0,
            Number(charge.amount) -
              payments
                .filter(
                  (p) =>
                    p.chargeId === charge.chargeId ||
                    (!p.chargeId &&
                      ((charge.reservationId &&
                        p.reservationId === charge.reservationId) ||
                        (charge.classId && p.classId === charge.classId))),
                )
                .reduce((sum, p) => sum + Number(p.amount), 0),
          ),
        0,
      ),
      expenses: expenses.reduce((n, x) => n + Number(x.amount), 0),
    };
  }
}

export class CustomerProfileService {
  constructor(private readonly repo: Repository) {}
  async get(ctx: AuthContext, customerId: string) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const customer = await this.repo.get<RecordItem>(
      orgKey(ctx.organizationId, 'CUSTOMER', customerId),
    );
    if (!customer) throw new AppError('NOT_FOUND', 'Customer was not found.');
    const reservations = withOrg(
        ctx,
        'reservation',
        await this.repo.scan(),
      ).filter((x) => x.customerId === customerId),
      enrollments = withOrg(ctx, 'enrollment', await this.repo.scan()).filter(
        (x) => x.customerId === customerId,
      ),
      attendance = withOrg(ctx, 'attendance', await this.repo.scan()).filter(
        (x) => x.customerId === customerId,
      ),
      payments = withOrg(ctx, 'payment', await this.repo.scan()).filter(
        (x) => x.customerId === customerId,
      ),
      charges = withOrg(ctx, 'charge', await this.repo.scan()).filter(
        (x) => x.customerId === customerId,
      ),
      activeCharges = charges.filter((x) => x.status === 'ACTIVE');
    const paid = payments.reduce((n, x) => n + Number(x.amount), 0),
      totalCharges = activeCharges.reduce((n, x) => n + Number(x.amount), 0);
    return {
      customer: as(customer),
      summary: {
        reservationCount: reservations.length,
        completedReservations: reservations.filter(
          (x) => x.status === 'COMPLETED',
        ).length,
        classAttendances: attendance.filter((x) =>
          ['CHECKED_IN', 'COMPLETED', 'PRESENT'].includes(String(x.status)),
        ).length,
        cancellations: reservations.filter((x) => x.status === 'CANCELLED')
          .length,
        noShows: reservations.filter((x) =>
          ['NO_SHOW', 'ABSENT'].includes(String(x.status)),
        ).length,
        totalCharges,
        recordedPayments: paid,
        outstanding: Math.max(0, totalCharges - paid),
      },
      reservations: reservations.map(as),
      classActivity: [...enrollments.map(as), ...attendance.map(as)],
      payments: payments.map(as),
      charges: charges.map(as),
    };
  }
}

export const buildServices = (repo: Repository) => {
  const sports = new SportService(repo),
    courts = new CourtService(repo, sports),
    schedule = new ScheduleService(repo),
    bookingPolicy = new BookingPolicyService(repo),
    reservations = new ReservationService(repo, schedule, courts),
    customers = new CustomerService(repo);
  const waitlists = new WaitlistService(
    repo,
    courts,
    schedule,
    bookingPolicy,
    reservations,
  );
  const requests = new RequestService(
    repo,
    courts,
    schedule,
    reservations,
    customers,
    bookingPolicy,
  );
  const customerBookings = new CustomerBookingService(
    bookingPolicy,
    courts,
    schedule,
    reservations,
    requests,
  );
  const reservationParticipants = new ReservationParticipantService(repo);
  const customerReservations = new CustomerReservationService(
    repo,
    bookingPolicy,
    reservations,
    customerBookings,
    reservationParticipants,
  );
  return {
    auth: new AuthService(repo),
    customerAuth: new CustomerAuthService(repo),
    organizations: new OrganizationService(repo),
    bookingPolicy,
    sports,
    courts,
    customers,
    customerAccounts: new CustomerAccountService(repo),
    customerSelfProfile: new CustomerSelfProfileService(repo),
    schedule,
    reservations,
    requests,
    customerBookings,
    customerActivities: new CustomerActivityService(repo),
    customerReservations,
    reservationParticipants,
    waitlists,
    payments: new PaymentService(repo),
    staff: new StaffService(repo),
    charges: new ChargeService(repo),
    finance: new ChargeService(repo),
    today: new TodayService(repo),
    reports: new ReportService(repo),
    customerProfiles: new CustomerProfileService(repo),
    expenses: new ExpenseService(repo),
    blocks: new BlockService(repo, courts, schedule),
    classes: new ClassService(repo, courts, schedule),
    repo,
  };
};

export type Services = ReturnType<typeof buildServices>;
