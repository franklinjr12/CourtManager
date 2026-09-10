import { randomUUID } from 'node:crypto';
import type {
  AuthContext,
  Court,
  Reservation,
  User,
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
  weekdayNameForDate,
  zonedDateTimeToIso,
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
    return as(value);
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
    const value = stored(
      {
        ...as(current),
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
    assertRole(ctx, ['OWNER', 'STAFF']);
    return as(await this.getRecord(ctx, sportId));
  }
  async create(ctx: AuthContext, input: Input) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const name = String(input.name ?? '').trim();
    if (!name) throw new AppError('VALIDATION_ERROR', 'Sport name is required.');
    const existing = await this.repo.query<RecordItem>(
      `ORG#${ctx.organizationId}`,
      { beginsWith: 'SPORT#' },
    );
    if (existing.some((sport) => String(sport.name).toLowerCase() === name.toLowerCase()))
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
    assertRole(ctx, ['OWNER', 'STAFF']);
    const current = await this.getRecord(ctx, sportId);
    const name = input.name === undefined ? String(current.name) : String(input.name).trim();
    if (!name) throw new AppError('VALIDATION_ERROR', 'Sport name is required.');
    const existing = await this.repo.query<RecordItem>(
      `ORG#${ctx.organizationId}`,
      { beginsWith: 'SPORT#' },
    );
    if (existing.some((sport) => sport.sportId !== sportId && String(sport.name).toLowerCase() === name.toLowerCase()))
      throw new AppError('DUPLICATE', 'A sport with this name already exists.');
    const value = stored(
      {
        ...as(current),
        name,
        active: input.active === undefined ? current.active === true : input.active === true,
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
    assertRole(ctx, ['OWNER', 'STAFF']);
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
    assertRole(ctx, ['OWNER', 'STAFF']);
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
    assertRole(ctx, ['OWNER', 'STAFF']);
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
    assertRole(ctx, ['OWNER', 'STAFF']);
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
          record.status === 'CONFIRMED' &&
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
    assertRole(ctx, ['OWNER', 'STAFF']);
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
    if (last.length + additionalWrites.length <= 100) last.push(...additionalWrites);
    else batches.push([...additionalWrites]);
    for (const writes of batches) if (writes.length) await this.repo.transactWrite(writes);
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
  ) {
    const timezone = await organizationTimezone(this.repo, ctx.organizationId),
      oldStart = new Date(oldStartAt),
      oldEnd = new Date(oldEndAt),
      newStart = new Date(newStartAt),
      newEnd = new Date(newEndAt);
    calculateDuration(newStart, newEnd);
    if (
      !isWithinOpeningHours(
        newStart,
        newEnd,
        court.openingHours,
        court.slotMinutes,
        timezone,
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
      durationMinutes > 24 * 60 ||
      durationMinutes % court.slotMinutes !== 0
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
    const count = durationMinutes / court.slotMinutes;
    return starts.filter(
      (start, i) =>
        (date !== today || start >= localTime(new Date(), timezone)) &&
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
      .map((item) => as<Reservation>(item));
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
    const amount =
      typeof input.expectedAmount === 'number'
        ? input.expectedAmount
        : calculatePrice(Number(court.defaultHourlyPrice), duration);
    const timestamp = now();
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
      [{ type: 'put', item: record }, ...additionalWrites],
    );
    return as(record);
  }
  async update(ctx: AuthContext, reservationId: string, input: Input) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const current = await this.get(ctx, reservationId);
    if (current.status !== 'CONFIRMED')
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
        [{ type: 'put', item: value }],
      );
      return as(value);
    }
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
    assertTransition(
      String(current.status) as ReservationServiceStatus,
      status,
    );
    const value = stored(
      { ...as(current), status, updatedBy: ctx.userId, updatedAt: now() },
      current.PK,
      current.SK,
      'reservation',
    );
    if (status === 'CANCELLED') {
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
        [{ type: 'put', item: value }],
      );
      return as(value);
    }
    await this.repo.put(value);
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
          await this.repo.get<RecordItem>(key('reservation', reservationId)) ??
            stored(record, `RESERVATION#${reservationId}`, 'META', 'reservation'),
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
            [{ type: 'delete', key: key('reservation', String(record.reservationId)) }],
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
  'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

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
    return {
      available: await this.schedule.availability(ctx, court, date, duration),
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
    if (duration > 240)
      throw new AppError(
        'VALIDATION_ERROR',
        'Requests may be at most four hours.',
      );
    const timezone = String(venue.timezone ?? 'UTC');
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
      ],
    );
    return reservation;
  }
}

export class PaymentService {
  constructor(private readonly repo: Repository) {}
  async create(ctx: AuthContext, input: Input) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const reservationId = input.reservationId
      ? String(input.reservationId)
      : undefined;
    const classId = input.classId ? String(input.classId) : undefined;
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
  async list(ctx: AuthContext) {
    return withOrg(ctx, 'class', await this.repo.scan()).map(as);
  }
  async occurrences(ctx: AuthContext, date: string) {
    const timezone = await organizationTimezone(this.repo, ctx.organizationId);
    const weekday = weekdayNameForDate(date);
    const weekdayNumber = [
      'SUNDAY',
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
      'SATURDAY',
    ].indexOf(weekday);
    return withOrg(ctx, 'class', await this.repo.scan())
      .filter(
        (item) =>
          item.active === true &&
          Number(item.weekday) === weekdayNumber &&
          date >= String(item.startDate) &&
          date <= String(item.endDate ?? item.startDate),
      )
      .map((item) => ({
        classId: item.classId,
        courtId: item.courtId,
        startAt: zonedDateTimeToIso(date, String(item.startTime), timezone),
        endAt: addLocalMinutes(
          date,
          String(item.startTime),
          Number(item.durationMinutes),
          timezone,
        ),
        name: item.name,
        sport: item.sport,
        occupancyType: 'CLASS',
        status: 'ACTIVE',
      }));
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
    const first = String(input.startDate),
      until = String(input.endDate ?? first);
    const timezone = await organizationTimezone(this.repo, ctx.organizationId);
    const occupancies: {
      startAt: string;
      endAt: string;
      occupancyType: 'CLASS';
      occupancyId: string;
    }[] = [];
    for (const date of recurrenceDates(
      first,
      until,
      Number(input.weekday),
      1,
    )) {
      const start = zonedDateTimeToIso(date, String(input.startTime), timezone);
      occupancies.push({
        startAt: start,
        endAt: addLocalMinutes(
          date,
          String(input.startTime),
          Number(input.durationMinutes),
          timezone,
        ),
        occupancyType: 'CLASS',
        occupancyId: classId + '-' + date,
      });
    }
    await this.schedule.occupyMany(ctx, c, occupancies, [
      { type: 'put', item: value },
    ]);
    return as(value);
  }
  async enroll(ctx: AuthContext, classId: string, customerId: string) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const enrollments = withOrg(
      ctx,
      'enrollment',
      (await this.repo.scan()).filter(
        (x) => x.classId === classId && x.status === 'ACTIVE',
      ),
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
  const sports = new SportService(repo),
    courts = new CourtService(repo, sports),
    schedule = new ScheduleService(repo),
    reservations = new ReservationService(repo, schedule, courts),
    customers = new CustomerService(repo);
  return {
    auth: new AuthService(repo),
    organizations: new OrganizationService(repo),
    sports,
    courts,
    customers,
    schedule,
    reservations,
    requests: new RequestService(
      repo,
      courts,
      schedule,
      reservations,
      customers,
    ),
    payments: new PaymentService(repo),
    expenses: new ExpenseService(repo),
    blocks: new BlockService(repo, courts, schedule),
    classes: new ClassService(repo, courts, schedule),
    repo,
  };
};
