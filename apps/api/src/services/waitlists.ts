import { randomUUID } from 'node:crypto';
import type {
  AuthContext,
  Court,
  CustomerAuthContext,
  CustomerClassWaitlistInput,
  CustomerCourtWaitlistInput,
  StaffWaitlist,
  Waitlist,
} from '@court-manager/contracts';
import type { Key, RecordItem, Repository, Write } from '../db.js';
import {
  addLocalMinutes,
  isWithinOpeningHours,
  zonedDateTimeToIso,
} from '../domain.js';
import { AppError } from '../errors.js';
import { phase2Keys } from '../persistence/phase2-keys.js';
import { BookingPolicyService } from './booking-policy.js';
import { ClassEnrollmentService } from './class-enrollment.js';

type CustomerScope = CustomerAuthContext;
type StaffScope = { organizationId: string; userId: string; role: 'STAFF' };
type CourtReader = {
  get(ctx: StaffScope, courtId: string): Promise<unknown>;
};
type ScheduleReader = {
  availability(
    ctx: StaffScope,
    court: Court,
    date: string,
    durationMinutes: number,
  ): Promise<string[]>;
};
type ReservationWriter = {
  createWithId(
    ctx: AuthContext,
    reservationId: string,
    input: Record<string, unknown>,
    additionalWrites?: Write[],
  ): Promise<unknown>;
};

const primary = (kind: string, id: string): Key => ({
  PK: `${kind}#${id}`,
  SK: 'META',
});
const as = <T>(item: RecordItem): T =>
  Object.fromEntries(
    Object.entries(item).filter(
      ([name]) => !['PK', 'SK', 'entity'].includes(name),
    ),
  ) as T;
const stored = (value: Record<string, unknown>, key: Key): RecordItem => ({
  ...value,
  ...key,
  entity: 'waitlist',
});
const now = () => new Date().toISOString();

export class WaitlistService {
  constructor(
    private readonly repo: Repository,
    private readonly courts: CourtReader,
    private readonly schedule: ScheduleReader,
    private readonly bookingPolicy: BookingPolicyService,
    private readonly reservations: ReservationWriter,
  ) {}

  private assertStaff(ctx: AuthContext) {
    if (!['OWNER', 'STAFF'].includes(ctx.role))
      throw new AppError(
        'FORBIDDEN',
        'You do not have permission for this operation.',
      );
  }

  private staffContext(ctx: {
    organizationId: string;
    customerAccountId?: string;
    userId?: string;
  }): StaffScope {
    return {
      organizationId: ctx.organizationId,
      userId: ctx.customerAccountId
        ? `customer:${ctx.customerAccountId}`
        : (ctx.userId ?? 'staff'),
      role: 'STAFF',
    };
  }

  private async customerExists(ctx: CustomerScope) {
    const customer = await this.repo.get<RecordItem>({
      PK: `ORG#${ctx.organizationId}`,
      SK: `CUSTOMER#${ctx.customerId}`,
    });
    if (!customer || customer.archived)
      throw new AppError('NOT_FOUND', 'Customer was not found.');
  }

  private customerIndex(source: RecordItem) {
    return phase2Keys.customerWaitlist(
      String(source.organizationId),
      String(source.customerId),
      String(source.joinedAt),
      String(source.waitlistId),
    );
  }

  private resourceIndex(source: RecordItem) {
    if (source.type === 'CLASS')
      return phase2Keys.classWaitlist(
        String(source.organizationId),
        String(source.classId),
        String(source.joinedAt),
        String(source.waitlistId),
      );
    return phase2Keys.courtWaitlist(
      String(source.organizationId),
      String(source.courtId),
      String(source.desiredDate),
      String(source.desiredStartTime),
      String(source.joinedAt),
      String(source.waitlistId),
    );
  }

  private organizationIndex(source: RecordItem) {
    return phase2Keys.organizationWaitlist(
      String(source.organizationId),
      String(source.joinedAt),
      String(source.waitlistId),
    );
  }

  private identity(source: RecordItem) {
    const value =
      source.type === 'CLASS'
        ? `CLASS#${String(source.classId)}`
        : `COURT_SLOT#${String(source.courtId)}#${String(source.desiredDate)}#${String(source.desiredStartTime)}#${String(source.durationMinutes)}`;
    return phase2Keys.customerWaitlistIdentity(
      String(source.organizationId),
      String(source.customerId),
      value,
    );
  }

  private index(source: RecordItem, key: Key) {
    return stored(as<Record<string, unknown>>(source), key);
  }

  private async create(source: RecordItem) {
    const customerIndex = this.customerIndex(source);
    const resourceIndex = this.resourceIndex(source);
    const identity = this.identity(source);
    try {
      await this.repo.transactWrite([
        { type: 'put', item: source, condition: 'attribute_not_exists(PK)' },
        {
          type: 'put',
          item: this.index(source, customerIndex),
          condition: 'attribute_not_exists(PK)',
        },
        {
          type: 'put',
          item: this.index(source, resourceIndex),
          condition: 'attribute_not_exists(PK)',
        },
        {
          type: 'put',
          item: stored(
            { waitlistId: source.waitlistId, status: 'ACTIVE' },
            identity,
          ),
          condition: 'attribute_not_exists(PK)',
        },
        {
          type: 'put',
          item: this.index(source, this.organizationIndex(source)),
          condition: 'attribute_not_exists(PK)',
        },
      ]);
    } catch (error) {
      if ((error as { code?: string }).code === 'SCHEDULE_CONFLICT')
        throw new AppError(
          'DUPLICATE',
          'Customer already has this active waitlist entry.',
        );
      throw error;
    }
    return as<Waitlist>(source);
  }

  async joinCourt(ctx: CustomerScope, input: CustomerCourtWaitlistInput) {
    await this.customerExists(ctx);
    const court = (await this.courts.get(
      this.staffContext(ctx),
      input.courtId,
    )) as Court;
    if (court.publiclyRequestable !== true)
      throw new AppError(
        'VALIDATION_ERROR',
        'Court is not publicly available.',
      );
    const policy = await this.bookingPolicy.policy(ctx.organizationId);
    const timezone = await this.bookingPolicy.organizationTimezone(
      ctx.organizationId,
    );
    const window = this.bookingPolicy.customerBookingWindow(policy, timezone);
    if (
      input.desiredDate < window.firstDate ||
      input.desiredDate > window.lastDate
    )
      throw new AppError(
        'VALIDATION_ERROR',
        'Requested date is outside the customer booking window.',
      );
    if (
      !this.bookingPolicy
        .customerAllowedDurations(policy, court)
        .includes(input.durationMinutes)
    )
      throw new AppError(
        'VALIDATION_ERROR',
        'Reservation duration is not allowed by venue policy.',
      );
    const startAt = zonedDateTimeToIso(
      input.desiredDate,
      input.desiredStartTime,
      timezone,
    );
    const endAt = addLocalMinutes(
      input.desiredDate,
      input.desiredStartTime,
      input.durationMinutes,
      timezone,
    );
    if (
      !isWithinOpeningHours(
        new Date(startAt),
        new Date(endAt),
        court.openingHours,
        court.slotMinutes,
        timezone,
      )
    )
      throw new AppError(
        'VALIDATION_ERROR',
        'Time is outside court opening hours or slot boundaries.',
      );
    const available = await this.schedule.availability(
      this.staffContext(ctx),
      court,
      input.desiredDate,
      input.durationMinutes,
    );
    if (available.includes(input.desiredStartTime))
      throw new AppError(
        'CONFLICT',
        'Court slot is available. Book it instead.',
      );
    const waitlistId = randomUUID();
    const timestamp = now();
    return this.create(
      stored(
        {
          waitlistId,
          organizationId: ctx.organizationId,
          customerId: ctx.customerId,
          type: 'COURT_SLOT',
          courtId: input.courtId,
          desiredDate: input.desiredDate,
          desiredStartTime: input.desiredStartTime,
          durationMinutes: input.durationMinutes,
          status: 'ACTIVE',
          joinedAt: timestamp,
        },
        phase2Keys.waitlist(waitlistId),
      ),
    );
  }

  async joinClass(ctx: CustomerScope, input: CustomerClassWaitlistInput) {
    await this.customerExists(ctx);
    const cls = await this.repo.get<RecordItem>(
      primary('CLASS', input.classId),
    );
    if (!cls || cls.organizationId !== ctx.organizationId)
      throw new AppError('NOT_FOUND', 'Class was not found.');
    if (cls.active !== true)
      throw new AppError('INVALID_STATE', 'Class is inactive.');
    if (typeof cls.enrolledCount !== 'number')
      throw new AppError(
        'INVALID_STATE',
        'Class data requires the class discovery migration.',
      );
    if (Number(cls.enrolledCount) < Number(cls.capacity))
      throw new AppError(
        'CONFLICT',
        'Class has available capacity. Enroll instead.',
      );
    const enrollment = await this.repo.get({
      PK: `ORG#${ctx.organizationId}#CLASS#${input.classId}`,
      SK: `CUSTOMER#${ctx.customerId}`,
    });
    if (enrollment?.status === 'ACTIVE')
      throw new AppError(
        'CONFLICT',
        'Customer is already enrolled in this class.',
      );
    const waitlistId = randomUUID();
    const timestamp = now();
    const source = stored(
      {
        waitlistId,
        organizationId: ctx.organizationId,
        customerId: ctx.customerId,
        type: 'CLASS',
        classId: input.classId,
        status: 'ACTIVE',
        joinedAt: timestamp,
      },
      phase2Keys.waitlist(waitlistId),
    );
    return this.createWithClassCheck(source, cls);
  }

  private async createWithClassCheck(source: RecordItem, cls: RecordItem) {
    const customerIndex = this.customerIndex(source);
    const resourceIndex = this.resourceIndex(source);
    const identity = this.identity(source);
    try {
      await this.repo.transactWrite([
        {
          type: 'check',
          key: primary('CLASS', String(cls.classId)),
          expected: {
            enrolledCount: cls.enrolledCount,
            active: true,
            updatedAt: cls.updatedAt,
          },
        },
        { type: 'put', item: source, condition: 'attribute_not_exists(PK)' },
        {
          type: 'put',
          item: this.index(source, customerIndex),
          condition: 'attribute_not_exists(PK)',
        },
        {
          type: 'put',
          item: this.index(source, resourceIndex),
          condition: 'attribute_not_exists(PK)',
        },
        {
          type: 'put',
          item: stored(
            { waitlistId: source.waitlistId, status: 'ACTIVE' },
            identity,
          ),
          condition: 'attribute_not_exists(PK)',
        },
        {
          type: 'put',
          item: this.index(source, this.organizationIndex(source)),
          condition: 'attribute_not_exists(PK)',
        },
      ]);
    } catch (error) {
      if ((error as { code?: string }).code === 'SCHEDULE_CONFLICT')
        throw new AppError(
          'DUPLICATE',
          'Customer already has this active waitlist entry.',
        );
      throw error;
    }
    return as<Waitlist>(source);
  }

  async list(ctx: CustomerScope) {
    const rows = await this.repo.query<RecordItem>(
      phase2Keys.customerWaitlists(ctx.organizationId, ctx.customerId).PK,
      { beginsWith: 'WAITLIST#ACTIVE#' },
    );
    return rows
      .filter((row) => row.entity === 'waitlist' && row.status === 'ACTIVE')
      .map((row) => as<Waitlist>(row));
  }

  async staffList(ctx: AuthContext): Promise<StaffWaitlist[]> {
    this.assertStaff(ctx);
    const rows = (
      await this.repo.query<RecordItem>(
        phase2Keys.organizationWaitlists(ctx.organizationId).PK,
        { beginsWith: 'ENTRY#', limit: 100 },
      )
    ).filter((row) => row.entity === 'waitlist');
    const uniqueKeys = (keys: Key[]) => [
      ...new Map(keys.map((key) => [`${key.PK}|${key.SK}`, key])).values(),
    ];
    const related = await this.batchGet([
      ...uniqueKeys(
        rows.map((row) => ({
          PK: `ORG#${ctx.organizationId}`,
          SK: `CUSTOMER#${String(row.customerId)}`,
        })),
      ),
      ...uniqueKeys(
        rows
          .filter((row) => row.type === 'COURT_SLOT' || row.type === 'COURT')
          .map((row) => ({
            PK: `ORG#${ctx.organizationId}`,
            SK: `COURT#${String(row.courtId)}`,
          })),
      ),
      ...uniqueKeys(
        rows
          .filter((row) => row.type === 'CLASS')
          .map((row) => primary('CLASS', String(row.classId))),
      ),
    ]);
    const lookup = new Map(related.map((row) => [`${row.PK}|${row.SK}`, row]));
    const get = (key: Key) => lookup.get(`${key.PK}|${key.SK}`);
    const courtRows = rows.filter(
      (row) => row.type === 'COURT_SLOT' || row.type === 'COURT',
    );
    const availability = new Map<string, boolean>();
    await Promise.all(
      courtRows.map(async (row) => {
        const court = get({
          PK: `ORG#${ctx.organizationId}`,
          SK: `COURT#${String(row.courtId)}`,
        }) as Court | undefined;
        if (!court || row.status !== 'ACTIVE') return;
        const key = `${row.courtId}|${row.desiredDate}|${row.durationMinutes}`;
        if (availability.has(key)) return;
        const available = await this.schedule.availability(
          this.staffContext(ctx),
          court,
          String(row.desiredDate),
          Number(row.durationMinutes),
        );
        availability.set(key, available.includes(String(row.desiredStartTime)));
      }),
    );
    return rows.map((row) => {
      const customer = get({
        PK: `ORG#${ctx.organizationId}`,
        SK: `CUSTOMER#${String(row.customerId)}`,
      });
      const court = get({
        PK: `ORG#${ctx.organizationId}`,
        SK: `COURT#${String(row.courtId)}`,
      });
      const cls =
        row.type === 'CLASS'
          ? get(primary('CLASS', String(row.classId)))
          : undefined;
      const isCourt = row.type === 'COURT_SLOT' || row.type === 'COURT';
      const available = isCourt
        ? availability.get(
            `${row.courtId}|${row.desiredDate}|${row.durationMinutes}`,
          )
        : undefined;
      const enrolledCount = cls ? Number(cls.enrolledCount ?? 0) : undefined;
      const capacity = cls ? Number(cls.capacity) : undefined;
      const actionable =
        row.status === 'ACTIVE' &&
        (isCourt
          ? available === true
          : cls?.active === true && enrolledCount! < capacity!);
      const requestedActivity = isCourt
        ? `${String(court?.name ?? `Court ${row.courtId}`)} · ${String(row.desiredDate)} ${String(row.desiredStartTime)} · ${String(row.durationMinutes)} min`
        : String(cls?.name ?? `Class ${row.classId}`);
      return {
        ...as<Waitlist>(row),
        customerName: String(customer?.name ?? 'Customer'),
        requestedActivity,
        ...(court ? { courtName: String(court.name) } : {}),
        ...(cls ? { className: String(cls.name) } : {}),
        actionable,
        currentAvailability: isCourt
          ? available === undefined
            ? {}
            : { available }
          : cls
            ? { enrolledCount, capacity }
            : {},
      } as StaffWaitlist;
    });
  }

  private async batchGet(keys: Key[]) {
    const unique = [
      ...new Map(keys.map((key) => [`${key.PK}|${key.SK}`, key])).values(),
    ];
    const result: RecordItem[] = [];
    for (let offset = 0; offset < unique.length; offset += 100)
      result.push(
        ...(await this.repo.batchGet(unique.slice(offset, offset + 100))),
      );
    return result;
  }

  private closeWrites(source: RecordItem, updated: RecordItem): Write[] {
    return [
      {
        type: 'put',
        item: updated,
        expected: { status: 'ACTIVE', customerId: source.customerId },
      },
      {
        type: 'put',
        item: this.index(updated, this.organizationIndex(source)),
        expected: { status: 'ACTIVE' },
      },
      {
        type: 'delete',
        key: this.customerIndex(source),
        condition: 'attribute_exists(PK)',
      },
      {
        type: 'put',
        item: this.index(updated, this.resourceIndex(source)),
        expected: { status: 'ACTIVE' },
      },
      {
        type: 'delete',
        key: this.identity(source),
        condition: 'attribute_exists(PK)',
      },
    ];
  }

  private async sourceForStaff(ctx: AuthContext, waitlistId: string) {
    this.assertStaff(ctx);
    const source = await this.repo.get<RecordItem>(
      phase2Keys.waitlist(waitlistId),
    );
    if (
      !source ||
      source.entity !== 'waitlist' ||
      source.organizationId !== ctx.organizationId
    )
      throw new AppError('NOT_FOUND', 'Waitlist was not found.');
    return source;
  }

  async fulfill(ctx: AuthContext, waitlistId: string) {
    const source = await this.sourceForStaff(ctx, waitlistId);
    if (source.status !== 'ACTIVE') return { waitlist: as<Waitlist>(source) };
    const updatedBase = {
      ...as<Record<string, unknown>>(source),
      status: 'FULFILLED',
      fulfilledAt: now(),
      fulfilledBy: ctx.userId,
    };
    if (source.type === 'CLASS') {
      const enrollmentId = randomUUID();
      const updated = stored(
        { ...updatedBase, linkedEnrollmentId: enrollmentId },
        { PK: source.PK, SK: source.SK },
      );
      const enrollment = await new ClassEnrollmentService(this.repo).enroll(
        ctx,
        String(source.classId),
        String(source.customerId),
        ctx.userId,
        { enrollmentId, additionalWrites: this.closeWrites(source, updated) },
      );
      return { waitlist: as<Waitlist>(updated), enrollment };
    }
    const court = (await this.courts.get(
      this.staffContext(ctx),
      String(source.courtId),
    )) as Court;
    const timezone = await this.bookingPolicy.organizationTimezone(
      ctx.organizationId,
    );
    const startAt = zonedDateTimeToIso(
      String(source.desiredDate),
      String(source.desiredStartTime),
      timezone,
    );
    const endAt = addLocalMinutes(
      String(source.desiredDate),
      String(source.desiredStartTime),
      Number(source.durationMinutes),
      timezone,
    );
    const available = await this.schedule.availability(
      this.staffContext(ctx),
      court,
      String(source.desiredDate),
      Number(source.durationMinutes),
    );
    if (!available.includes(String(source.desiredStartTime)))
      throw new AppError('CONFLICT', 'Court is no longer available.');
    const reservationId = randomUUID();
    const updated = stored(
      { ...updatedBase, linkedReservationId: reservationId },
      { PK: source.PK, SK: source.SK },
    );
    const reservation = await this.reservations.createWithId(
      ctx,
      reservationId,
      {
        courtId: source.courtId,
        customerId: source.customerId,
        startAt,
        endAt,
        source: 'STAFF',
      },
      this.closeWrites(source, updated),
    );
    return { waitlist: as<Waitlist>(updated), reservation };
  }

  async expire(ctx: AuthContext, waitlistId: string) {
    const source = await this.sourceForStaff(ctx, waitlistId);
    if (source.status !== 'ACTIVE') return as<Waitlist>(source);
    const updated = stored(
      {
        ...as<Record<string, unknown>>(source),
        status: 'EXPIRED',
        expiredAt: now(),
        expiredBy: ctx.userId,
      },
      { PK: source.PK, SK: source.SK },
    );
    await this.repo.transactWrite(this.closeWrites(source, updated));
    return as<Waitlist>(updated);
  }

  async leave(ctx: CustomerScope, waitlistId: string) {
    const source = await this.repo.get<RecordItem>(
      phase2Keys.waitlist(waitlistId),
    );
    if (
      !source ||
      source.entity !== 'waitlist' ||
      source.organizationId !== ctx.organizationId ||
      source.customerId !== ctx.customerId
    )
      throw new AppError('NOT_FOUND', 'Waitlist was not found.');
    if (source.status !== 'ACTIVE') return as<Waitlist>(source);
    const timestamp = now();
    const updated = stored(
      {
        ...as<Record<string, unknown>>(source),
        status: 'CANCELLED',
        cancelledAt: timestamp,
        cancelledBy: ctx.customerAccountId,
      },
      phase2Keys.waitlist(waitlistId),
    );
    const resource = this.resourceIndex(source);
    await this.repo.transactWrite([
      {
        type: 'put',
        item: updated,
        expected: { status: 'ACTIVE', customerId: ctx.customerId },
      },
      {
        type: 'put',
        item: this.index(updated, resource),
        expected: { status: 'ACTIVE' },
      },
      {
        type: 'put',
        item: this.index(updated, this.organizationIndex(source)),
        expected: { status: 'ACTIVE' },
      },
      {
        type: 'delete',
        key: this.customerIndex(source),
        condition: 'attribute_exists(PK)',
      },
      {
        type: 'delete',
        key: this.identity(source),
        condition: 'attribute_exists(PK)',
      },
    ]);
    return as<Waitlist>(updated);
  }
}
