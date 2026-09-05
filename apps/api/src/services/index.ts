import { randomUUID } from 'node:crypto';
import type { AuthContext, Court, Customer, Reservation, User } from '@court-manager/contracts';
import type { Key, RecordItem, Repository } from '../db.js';
import {
  assertTransition,
  calculateDuration,
  calculatePrice,
  dayKey,
  expandSlots,
  isWithinOpeningHours,
  normalizeEmail,
  normalizePhone,
  paymentStatus,
  recurrenceDates,
} from '../domain.js';
import { AppError } from '../errors.js';
import { createToken, hashToken, verifyPassword } from '../security.js';

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
    Object.entries(item).filter(([name]) => !['PK', 'SK', 'entity'].includes(name)),
  ) as T;
const stored = (
  value: Record<string, unknown>,
  PK: string,
  SK = 'META',
  entity?: RecordItem['entity'],
): RecordItem => ({ ...value, PK, SK, ...(entity ? { entity } : {}) }) as RecordItem;
const withOrg = (ctx: AuthContext, entity: string, items: RecordItem[]) =>
  items.filter((item) => item.organizationId === ctx.organizationId && item.entity === entity);
const assertRole = (ctx: AuthContext, roles: AuthContext['role'][]) => {
  if (!roles.includes(ctx.role))
    throw new AppError('FORBIDDEN', 'You do not have permission for this operation.');
};

export class AuthService {
  constructor(private readonly repo: Repository) {}
  async login(email: string, password: string) {
    const users = await this.repo.scan<RecordItem>(
      (x) => x.entity === 'user' && x.email === email.toLowerCase(),
    );
    const record = users[0];
    if (!record || !record.active || !(await verifyPassword(password, String(record.passwordHash))))
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
      organization: organization ? as(organization) : undefined,
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
    if (!user || !user.active) throw new AppError('UNAUTHORIZED', 'User is disabled.');
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
    const value = await this.repo.get<RecordItem>({ PK: `ORG#${ctx.organizationId}`, SK: 'META' });
    if (!value) throw new AppError('NOT_FOUND', 'Organization was not found.');
    return as(value);
  }
  async update(ctx: AuthContext, input: Input) {
    assertRole(ctx, ['OWNER']);
    const current = await this.repo.get<RecordItem>({
      PK: `ORG#${ctx.organizationId}`,
      SK: 'META',
    });
    if (!current) throw new AppError('NOT_FOUND', 'Organization was not found.');
    const value = stored(
      { ...as(current), ...input, organizationId: ctx.organizationId, updatedAt: now() },
      current.PK,
      current.SK,
      'organization',
    );
    await this.repo.put(value);
    return as(value);
  }
}

export class CourtService {
  constructor(private readonly repo: Repository) {}
  private async find(ctx: AuthContext, courtId: string) {
    const court = await this.repo.get<RecordItem>(orgKey(ctx.organizationId, 'COURT', courtId));
    if (!court || court.archivedAt) throw new AppError('NOT_FOUND', 'Court was not found.');
    return court;
  }
  async list(ctx: AuthContext, includeArchived = false) {
    return (
      await this.repo.query<RecordItem>(`ORG#${ctx.organizationId}`, { beginsWith: 'COURT#' })
    )
      .filter((x) => includeArchived || !x.archivedAt)
      .map(as);
  }
  async get(ctx: AuthContext, id: string) {
    return as(await this.find(ctx, id));
  }
  async create(ctx: AuthContext, input: Input) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const courtId = id(),
      timestamp = now();
    const value = stored(
      {
        ...input,
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
    assertRole(ctx, ['OWNER', 'STAFF']);
    const current = await this.find(ctx, courtId);
    const value = stored(
      { ...as(current), ...input, courtId, organizationId: ctx.organizationId, updatedAt: now() },
      current.PK,
      current.SK,
      'court',
    );
    await this.repo.put(value);
    return as(value);
  }
  async archive(ctx: AuthContext, courtId: string) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const current = await this.find(ctx, courtId);
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
    assertRole(ctx, ['OWNER', 'STAFF']);
    const current = await this.repo.get<RecordItem>(orgKey(ctx.organizationId, 'COURT', courtId));
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
    assertRole(ctx, ['OWNER', 'STAFF', 'COACH']);
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
    const value = await this.repo.get<RecordItem>(
      orgKey(ctx.organizationId, 'CUSTOMER', customerId),
    );
    if (!value) throw new AppError('NOT_FOUND', 'Customer was not found.');
    return as(value);
  }
  async duplicates(ctx: AuthContext, input: Input) {
    const phone = normalizePhone(String(input.phone ?? '')),
      email = normalizeEmail(typeof input.email === 'string' ? input.email : undefined);
    return (await this.list(ctx, undefined, true)).filter(
      (x) => (phone && x.normalizedPhone === phone) || (email && x.normalizedEmail === email),
    );
  }
  async create(ctx: AuthContext, input: Input) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const customerId = id(),
      timestamp = now();
    const value = stored(
      {
        ...input,
        customerId,
        organizationId: ctx.organizationId,
        normalizedPhone: normalizePhone(String(input.phone ?? '')),
        normalizedEmail: normalizeEmail(typeof input.email === 'string' ? input.email : undefined),
        tags: Array.isArray(input.tags) ? input.tags : [],
        archived: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      `ORG#${ctx.organizationId}`,
      `CUSTOMER#${customerId}`,
      'customer',
    );
    await this.repo.put(value);
    return as(value);
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
        normalizedPhone: normalizePhone(String(input.phone ?? current.phone ?? '')),
        normalizedEmail: normalizeEmail(String(input.email ?? current.email ?? '')),
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
    return { PK: `SCHEDULE#${org}#${court}#${date}`, SK: `ITEM#${type}#${occupancyId}` };
  }
  async locks(ctx: AuthContext, courtId: string, date: string) {
    return this.repo.query<RecordItem>(`SCHEDULE#${ctx.organizationId}#${courtId}#${date}`, {
      beginsWith: 'LOCK#',
    });
  }
  async occupy(
    ctx: AuthContext,
    court: Court,
    startAt: string,
    endAt: string,
    occupancyType: 'RESERVATION' | 'CLASS' | 'BLOCK',
    occupancyId: string,
  ) {
    const start = new Date(startAt),
      end = new Date(endAt);
    const duration = calculateDuration(start, end);
    if (
      duration > 24 * 60 ||
      !isWithinOpeningHours(start, end, court.openingHours, court.slotMinutes)
    )
      throw new AppError(
        'VALIDATION_ERROR',
        'Time is outside court opening hours or slot boundaries.',
      );
    const slots = expandSlots(
      `${String(start.getUTCHours()).padStart(2, '0')}:${String(start.getUTCMinutes()).padStart(2, '0')}`,
      `${String(end.getUTCHours()).padStart(2, '0')}:${String(end.getUTCMinutes()).padStart(2, '0')}`,
      court.slotMinutes,
    );
    const date = dayKey(startAt);
    const writes: import('../db.js').Write[] = slots.map((slot) => ({
      type: 'put',
      item: stored(
        { occupancyType, occupancyId, startAt, endAt },
        `SCHEDULE#${ctx.organizationId}#${court.courtId}#${date}`,
        `LOCK#${slot}`,
      ),
      condition: 'attribute_not_exists(PK)',
    }));
    writes.push({
      type: 'put',
      item: stored(
        { occupancyType, occupancyId, startAt, endAt },
        `SCHEDULE#${ctx.organizationId}#${court.courtId}#${date}`,
        `ITEM#${occupancyType}#${occupancyId}`,
      ),
    });
    await this.repo.transactWrite(writes);
    return slots;
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
  ) {
    const oldStart = new Date(oldStartAt),
      oldEnd = new Date(oldEndAt),
      newStart = new Date(newStartAt),
      newEnd = new Date(newEndAt);
    calculateDuration(newStart, newEnd);
    if (!isWithinOpeningHours(newStart, newEnd, court.openingHours, court.slotMinutes))
      throw new AppError(
        'VALIDATION_ERROR',
        'Time is outside court opening hours or slot boundaries.',
      );
    const format = (value: Date) =>
      `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
    const oldSlots = expandSlots(format(oldStart), format(oldEnd), court.slotMinutes),
      newSlots = expandSlots(format(newStart), format(newEnd), court.slotMinutes),
      oldDate = dayKey(oldStartAt),
      newDate = dayKey(newStartAt),
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
            { occupancyType, occupancyId, startAt: newStartAt, endAt: newEndAt },
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
    await this.repo.transactWrite(writes);
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
  ) {
    const start = new Date(startAt),
      end = new Date(endAt);
    const slots = expandSlots(
      `${String(start.getUTCHours()).padStart(2, '0')}:${String(start.getUTCMinutes()).padStart(2, '0')}`,
      `${String(end.getUTCHours()).padStart(2, '0')}:${String(end.getUTCMinutes()).padStart(2, '0')}`,
      slotMinutes,
    );
    await this.repo.transactWrite([
      ...slots.map((slot) => ({
        type: 'delete' as const,
        key: this.lockKey(ctx.organizationId, courtId, dayKey(startAt), slot),
      })),
      {
        type: 'delete',
        key: this.metaKey(ctx.organizationId, courtId, dayKey(startAt), occupancyType, occupancyId),
      },
    ]);
  }
  async availability(ctx: AuthContext, court: Court, date: string, durationMinutes: number) {
    if (![30, 60].includes(durationMinutes) || durationMinutes % court.slotMinutes !== 0)
      throw new AppError('VALIDATION_ERROR', 'Invalid duration.');
    const weekdays = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const weekday = weekdays[new Date(`${date}T12:00:00Z`).getUTCDay()] ?? 'SUNDAY';
    const opening = court.openingHours[weekday as keyof Court['openingHours']];
    if (!opening) return [];
    const occupied = new Set(
      (await this.locks(ctx, court.courtId, date)).map((x) => x.SK.replace('LOCK#', '')),
    );
    const starts = expandSlots(opening.open, opening.close, court.slotMinutes);
    const count = durationMinutes / court.slotMinutes;
    return starts.filter(
      (_, i) =>
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
    const r = await this.repo.get<RecordItem>(key('reservation', reservationId));
    if (!r || r.organizationId !== ctx.organizationId)
      throw new AppError('NOT_FOUND', 'Reservation was not found.');
    return r;
  }
  async list(ctx: AuthContext, filters: Input) {
    const items = withOrg(ctx, 'reservation', await this.repo.scan());
    return items
      .filter((x) => !filters.status || x.status === filters.status)
      .filter((x) => !filters.courtId || x.courtId === filters.courtId)
      .filter((x) => !filters.customerId || x.customerId === filters.customerId)
      .filter((x) => !filters.date || dayKey(String(x.startAt)) === filters.date)
      .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)))
      .map(as);
  }
  async create(ctx: AuthContext, input: Input) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const court = (await this.courts.get(ctx, String(input.courtId))) as Court;
    const customer = await this.repo.get<RecordItem>(
      orgKey(ctx.organizationId, 'CUSTOMER', String(input.customerId)),
    );
    if (!customer || customer.archived) throw new AppError('NOT_FOUND', 'Customer was not found.');
    const start = new Date(String(input.startAt)),
      end = new Date(String(input.endAt));
    const duration = calculateDuration(start, end);
    const amount =
      typeof input.expectedAmount === 'number'
        ? input.expectedAmount
        : calculatePrice(Number(court.defaultHourlyPrice), duration);
    const reservationId = id(),
      timestamp = now();
    const record = stored(
      {
        ...input,
        reservationId,
        organizationId: ctx.organizationId,
        status: 'CONFIRMED',
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
    await this.schedule.occupy(
      ctx,
      court,
      String(input.startAt),
      String(input.endAt),
      'RESERVATION',
      reservationId,
    );
    await this.repo.put(record);
    return as(record);
  }
  async update(ctx: AuthContext, reservationId: string, input: Input) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const current = await this.get(ctx, reservationId);
    if (current.status !== 'CONFIRMED')
      throw new AppError('INVALID_STATE', 'Only confirmed reservations can be edited.');
    if (input.startAt || input.endAt) {
      const court = (await this.courts.get(ctx, String(current.courtId))) as Court;
      await this.schedule.move(
        ctx,
        court,
        String(current.startAt),
        String(current.endAt),
        String(input.startAt ?? current.startAt),
        String(input.endAt ?? current.endAt),
        'RESERVATION',
        reservationId,
      );
    }
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
    await this.repo.put(value);
    return as(value);
  }
  async transition(
    ctx: AuthContext,
    reservationId: string,
    status: 'COMPLETED' | 'CANCELLED' | 'NO_SHOW',
  ) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const current = await this.get(ctx, reservationId);
    assertTransition(String(current.status) as ReservationServiceStatus, status);
    if (status === 'CANCELLED') {
      const court = (await this.courts.get(ctx, String(current.courtId))) as Court;
      await this.schedule.release(
        ctx,
        String(current.courtId),
        String(current.startAt),
        String(current.endAt),
        court.slotMinutes,
        'RESERVATION',
        reservationId,
      );
    }
    const value = stored(
      { ...as(current), status, updatedBy: ctx.userId, updatedAt: now() },
      current.PK,
      current.SK,
      'reservation',
    );
    await this.repo.put(value);
    return as(value);
  }
  async detail(ctx: AuthContext, reservationId: string) {
    const reservation = await this.get(ctx, reservationId);
    const payments = withOrg(
      ctx,
      'payment',
      (await this.repo.scan()).filter((x) => x.reservationId === reservationId),
    );
    const paid = payments.reduce((sum, x) => sum + Number(x.amount), 0);
    return {
      ...as(reservation),
      payments: payments.map(as),
      paidAmount: paid,
      remainingAmount: Math.max(0, Number(reservation.expectedAmount) - paid),
      paymentStatus: paymentStatus(Number(reservation.expectedAmount), paid),
    };
  }
  async recurring(ctx: AuthContext, input: Input) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const court = (await this.courts.get(ctx, String(input.courtId))) as Court;
    const start = new Date(String(input.startAt)),
      until = String(input.untilDate);
    if (Number(input.intervalWeeks ?? 1) < 1 || String(input.frequency ?? 'WEEKLY') !== 'WEEKLY')
      throw new AppError('VALIDATION_ERROR', 'Only weekly recurrence is supported.');
    const dates = recurrenceDates(
      dayKey(String(input.startAt)),
      until,
      start.getUTCDay(),
      Number(input.intervalWeeks ?? 1),
    );
    const duration = calculateDuration(start, new Date(String(input.endAt)));
    const time = (value: Date) =>
      `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
    const conflicts: string[] = [];
    for (const date of dates) {
      const available = await this.schedule.availability(ctx, court, date, duration);
      if (!available.includes(time(start))) conflicts.push(date);
    }
    if (input.preview === true) return { dates, conflicts };
    if (conflicts.length && !input.skipConflicts)
      throw new AppError('SCHEDULE_CONFLICT', 'Some recurring occurrences are unavailable.', {
        conflicts,
      });
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
        'reservation',
      );
    await this.repo.put(series);
    const created: Record<string, unknown>[] = [];
    for (const date of dates) {
      if (conflicts.includes(date)) continue;
      const occurrenceStart = `${date}T${time(start)}:00.000Z`,
        occurrenceEnd = new Date(
          new Date(occurrenceStart).getTime() + duration * 60000,
        ).toISOString();
      try {
        created.push(
          await this.create(ctx, {
            courtId: court.courtId,
            customerId: input.customerId,
            startAt: occurrenceStart,
            endAt: occurrenceEnd,
            expectedAmount: input.expectedAmount,
            source: input.source ?? 'STAFF',
            seriesId,
          }),
        );
      } catch (error) {
        if (!input.skipConflicts) throw error;
      }
    }
    return { seriesId, created, conflicts };
  }
}
type ReservationServiceStatus = 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export class RequestService {
  constructor(
    private readonly repo: Repository,
    private readonly courts: CourtService,
    private readonly schedule: ScheduleService,
    private readonly reservations: ReservationService,
    private readonly customers: CustomerService,
  ) {}
  async publicVenue(slug: string) {
    const orgs = await this.repo.scan<RecordItem>(
      (x) => x.entity === 'organization' && x.slug === slug && x.active === true,
    );
    const org = orgs[0];
    if (!org) throw new AppError('NOT_FOUND', 'Venue was not found.');
    const courts = (
      await this.repo.query<RecordItem>(`ORG#${org.organizationId}`, { beginsWith: 'COURT#' })
    ).filter((x) => x.active === true && x.publiclyRequestable === true && !x.archivedAt);
    return {
      organizationId: org.organizationId,
      name: org.name,
      slug: org.slug,
      timezone: org.timezone,
      currency: org.currency,
      phone: org.phone,
      email: org.email,
      courts: courts.map((x) => ({
        courtId: x.courtId,
        name: x.name,
        sport: x.sport,
        slotMinutes: x.slotMinutes,
      })),
    };
  }
  async publicAvailability(slug: string, courtId: string, date: string, duration: number) {
    const venue = await this.publicVenue(slug);
    const ctx: AuthContext = {
      organizationId: String(venue.organizationId),
      userId: 'public',
      role: 'STAFF',
    };
    const court = (await this.courts.get(ctx, courtId)) as Court;
    return { available: await this.schedule.availability(ctx, court, date, duration) };
  }
  async createPublic(slug: string, input: Input) {
    const venue = await this.publicVenue(slug);
    const ctx: AuthContext = {
      organizationId: String(venue.organizationId),
      userId: 'public',
      role: 'STAFF',
    };
    const court = (await this.courts.get(ctx, String(input.courtId))) as Court;
    if (!court.active || !court.publiclyRequestable)
      throw new AppError('VALIDATION_ERROR', 'Court is not publicly available.');
    const start = new Date(String(input.requestedStartAt)),
      end = new Date(String(input.requestedEndAt));
    if (start.getTime() < Date.now())
      throw new AppError('VALIDATION_ERROR', 'Past dates cannot be requested.');
    const duration = calculateDuration(start, end);
    if (duration > 240)
      throw new AppError('VALIDATION_ERROR', 'Requests may be at most four hours.');
    if (!isWithinOpeningHours(start, end, court.openingHours, court.slotMinutes))
      throw new AppError('VALIDATION_ERROR', 'Time is outside court opening hours.');
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
    const court = (await this.courts.get(ctx, String(request.courtId))) as Court;
    const customer = customerId
      ? await this.customers.get(ctx, customerId)
      : await this.customers.create(ctx, {
          name: request.customerName,
          phone: request.phone,
          email: request.email,
        });
    const reservation = await this.reservations.create(ctx, {
      courtId: request.courtId,
      customerId: (customer as Customer).customerId,
      startAt: request.requestedStartAt,
      endAt: request.requestedEndAt,
      source: 'PUBLIC_REQUEST',
    });
    const value = stored(
      {
        ...as(request),
        status: 'CONFIRMED',
        linkedCustomerId: (customer as Customer).customerId,
        linkedReservationId: (reservation as Reservation).reservationId,
        reviewedAt: now(),
        reviewedBy: ctx.userId,
      },
      request.PK,
      request.SK,
      'request',
    );
    await this.repo.put(value);
    void court;
    return reservation;
  }
}

export class PaymentService {
  constructor(private readonly repo: Repository) {}
  async create(ctx: AuthContext, input: Input) {
    assertRole(ctx, ['OWNER', 'STAFF']);
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
    return as(value);
  }
  async remove(ctx: AuthContext, paymentId: string) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const p = await this.repo.get<RecordItem>(key('payment', paymentId));
    if (!p || p.organizationId !== ctx.organizationId)
      throw new AppError('NOT_FOUND', 'Payment was not found.');
    await this.repo.delete(key('payment', paymentId));
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
}

export class BlockService {
  constructor(
    private readonly repo: Repository,
    private readonly courts: CourtService,
    private readonly schedule: ScheduleService,
  ) {}
  async list(ctx: AuthContext) {
    return withOrg(ctx, 'block', await this.repo.scan())
      .filter((x) => x.active)
      .map(as);
  }
  async create(ctx: AuthContext, input: Input) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const court = (await this.courts.get(ctx, String(input.courtId))) as Court;
    const blockId = id();
    await this.schedule.occupy(
      ctx,
      court,
      String(input.startAt),
      String(input.endAt),
      'BLOCK',
      blockId,
    );
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
    await this.repo.put(value);
    return as(value);
  }
  async cancel(ctx: AuthContext, blockId: string) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const block = await this.repo.get<RecordItem>(key('block', blockId));
    if (!block || block.organizationId !== ctx.organizationId)
      throw new AppError('NOT_FOUND', 'Block was not found.');
    const court = (await this.courts.get(ctx, String(block.courtId))) as Court;
    await this.schedule.release(
      ctx,
      String(block.courtId),
      String(block.startAt),
      String(block.endAt),
      court.slotMinutes,
      'BLOCK',
      blockId,
    );
    const value = stored(
      { ...as(block), active: false, updatedAt: now() },
      block.PK,
      block.SK,
      'block',
    );
    await this.repo.put(value);
    return as(value);
  }
}

export class ClassService {
  constructor(
    private readonly repo: Repository,
    private readonly courts: CourtService,
    private readonly schedule: ScheduleService,
  ) {}
  async list(ctx: AuthContext) {
    return withOrg(ctx, 'class', await this.repo.scan()).map(as);
  }
  async create(ctx: AuthContext, input: Input) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const c = (await this.courts.get(ctx, String(input.courtId))) as Court;
    const classId = id(),
      value = stored(
        {
          ...input,
          classId,
          organizationId: ctx.organizationId,
          active: true,
          createdAt: now(),
          updatedAt: now(),
        },
        `CLASS#${classId}`,
        'META',
        'class',
      );
    await this.repo.put(value);
    const first = String(input.startDate),
      until = String(input.endDate ?? first);
    for (const date of recurrenceDates(first, until, Number(input.weekday), 1)) {
      const start = `${date}T${String(input.startTime)}:00.000Z`;
      const endDate = new Date(
        new Date(start).getTime() + Number(input.durationMinutes) * 60000,
      ).toISOString();
      await this.schedule.occupy(ctx, c, String(start), endDate, 'CLASS', classId + '-' + date);
    }
    return as(value);
  }
  async enroll(ctx: AuthContext, classId: string, customerId: string) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const enrollments = withOrg(
      ctx,
      'enrollment',
      (await this.repo.scan()).filter((x) => x.classId === classId && x.status === 'ACTIVE'),
    );
    const cls = await this.repo.get<RecordItem>(key('class', classId));
    if (!cls || cls.organizationId !== ctx.organizationId)
      throw new AppError('NOT_FOUND', 'Class was not found.');
    if (enrollments.length >= Number(cls.capacity))
      throw new AppError('CONFLICT', 'Class is full.');
    const enrollmentId = id(),
      value = stored(
        {
          enrollmentId,
          organizationId: ctx.organizationId,
          classId,
          customerId,
          status: 'ACTIVE',
          joinedAt: now(),
        },
        `ENROLLMENT#${enrollmentId}`,
        'META',
        'enrollment',
      );
    await this.repo.put(value);
    return as(value);
  }
  async attendance(ctx: AuthContext, input: Input) {
    assertRole(ctx, ['OWNER', 'STAFF', 'COACH']);
    const attendanceId = id(),
      value = stored(
        {
          ...input,
          attendanceId,
          organizationId: ctx.organizationId,
          recordedBy: ctx.userId,
          createdAt: now(),
        },
        `ATTENDANCE#${attendanceId}`,
        'META',
        'attendance',
      );
    await this.repo.put(value);
    return as(value);
  }
}

export const buildServices = (repo: Repository) => {
  const courts = new CourtService(repo),
    schedule = new ScheduleService(repo),
    reservations = new ReservationService(repo, schedule, courts),
    customers = new CustomerService(repo);
  return {
    auth: new AuthService(repo),
    organizations: new OrganizationService(repo),
    courts,
    customers,
    schedule,
    reservations,
    requests: new RequestService(repo, courts, schedule, reservations, customers),
    payments: new PaymentService(repo),
    expenses: new ExpenseService(repo),
    blocks: new BlockService(repo, courts, schedule),
    classes: new ClassService(repo, courts, schedule),
    repo,
  };
};
