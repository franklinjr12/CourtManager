import { randomUUID } from 'node:crypto';
import type {
  CustomerAuthContext,
  CustomerClass,
  CustomerClassPage,
} from '@court-manager/contracts';
import type { Key, RecordItem, Repository, Write } from '../db.js';
import { AppError } from '../errors.js';
import {
  classCatalogKey,
  classEnrollmentKey,
} from '../persistence/class-keys.js';
import { phase2Keys } from '../persistence/phase2-keys.js';
import { phase3Keys } from '../persistence/phase3-keys.js';
import { classActivity } from './customer-activities.js';

type Scope = { organizationId: string };
type EnrollmentOptions = {
  enrollmentId?: string;
  additionalWrites?: Write[];
};
const primary = (kind: string, id: string) => ({
  PK: `${kind}#${id}`,
  SK: 'META',
});
const customerChargeIndex = (charge: RecordItem) => {
  const value = Object.fromEntries(
    Object.entries(charge).filter(
      ([name]) => !['PK', 'SK', 'entity'].includes(name),
    ),
  );
  const index = phase3Keys.customerCharge(
    String(charge.organizationId),
    String(charge.customerId),
    String(charge.serviceAt),
    String(charge.chargeId),
  );
  return { ...value, ...index } as RecordItem;
};
const publicEnrollment = (row: RecordItem) => ({
  enrollmentId: String(row.enrollmentId),
  status: String(row.status),
});

/** Shared enrollment domain; callers authorize the actor before selecting a customer. */
export class ClassEnrollmentService {
  constructor(private readonly repo: Repository) {}
  private async getClass(ctx: Scope, classId: string) {
    const cls = await this.repo.get(primary('CLASS', classId));
    if (!cls || cls.organizationId !== ctx.organizationId)
      throw new AppError('NOT_FOUND', 'Class was not found.');
    if (typeof cls.enrolledCount !== 'number')
      throw new AppError(
        'INVALID_STATE',
        'Class data requires the class discovery migration.',
      );
    return cls;
  }
  private async sessions(ctx: Scope, classId: string) {
    const cls = await this.getClass(ctx, classId);
    const ids = cls.sessionIds as string[] | undefined;
    if (!ids || ids.length > 500)
      throw new AppError(
        'INVALID_STATE',
        'Class session data requires migration.',
      );
    return (
      await this.batchGet(ids.map((id) => primary('CLASS_SESSION', id)))
    ).filter(
      (row) =>
        row.organizationId === ctx.organizationId &&
        row.classId === classId &&
        Date.parse(String(row.startAt)) >= Date.now(),
    );
  }
  private async batchGet(keys: Key[]) {
    const unique = [
      ...new Map(keys.map((key) => [`${key.PK}|${key.SK}`, key])).values(),
    ];
    const rows: RecordItem[] = [];
    for (let offset = 0; offset < unique.length; offset += 100)
      rows.push(
        ...(await this.repo.batchGet(unique.slice(offset, offset + 100))),
      );
    return rows;
  }

  async discover(
    ctx: CustomerAuthContext,
    cursor?: string,
  ): Promise<CustomerClassPage> {
    if (cursor && !/^CLASS#[A-Za-z0-9-]+$/.test(cursor))
      throw new AppError('VALIDATION_ERROR', 'Invalid class cursor.');
    const refs = await this.repo.query(classCatalogKey(ctx.organizationId).PK, {
      between: [cursor ? `${cursor}\u0000` : 'CLASS#', 'CLASS#~'],
      limit: 21,
    });
    const page = refs.slice(0, 20);
    const classes = (
      await this.batchGet(
        page.map((row) => primary('CLASS', String(row.classId))),
      )
    ).filter(
      (row) => row.organizationId === ctx.organizationId && row.active === true,
    );
    const related = await this.batchGet(
      classes.flatMap((cls) => [
        { PK: `ORG#${ctx.organizationId}`, SK: `COURT#${cls.courtId}` },
        { PK: `ORG#${ctx.organizationId}`, SK: `USER#${cls.coachId}` },
        classEnrollmentKey(
          ctx.organizationId,
          String(cls.classId),
          ctx.customerId,
        ),
        phase2Keys.customerWaitlistIdentity(
          ctx.organizationId,
          ctx.customerId,
          `CLASS#${String(cls.classId)}`,
        ),
      ]),
    );
    const lookup = new Map(related.map((row) => [`${row.PK}|${row.SK}`, row]));
    const get = (key: { PK: string; SK: string }) =>
      lookup.get(`${key.PK}|${key.SK}`);
    const org = await this.repo.get({
      PK: `ORG#${ctx.organizationId}`,
      SK: 'META',
    });
    const data: CustomerClass[] = classes.map((cls) => {
      const own = get(
        classEnrollmentKey(
          ctx.organizationId,
          String(cls.classId),
          ctx.customerId,
        ),
      );
      const ownWaitlist = get(
        phase2Keys.customerWaitlistIdentity(
          ctx.organizationId,
          ctx.customerId,
          `CLASS#${String(cls.classId)}`,
        ),
      );
      return {
        classId: String(cls.classId),
        name: String(cls.name),
        sport: String(cls.sport),
        coachName: String(
          get({ PK: `ORG#${ctx.organizationId}`, SK: `USER#${cls.coachId}` })
            ?.name ?? 'Coach',
        ),
        courtName: String(
          get({ PK: `ORG#${ctx.organizationId}`, SK: `COURT#${cls.courtId}` })
            ?.name ?? 'Court',
        ),
        scheduleType: cls.scheduleType === 'SINGLE' ? 'SINGLE' : 'WEEKLY',
        startDate: String(cls.startDate),
        ...(cls.endDate ? { endDate: String(cls.endDate) } : {}),
        startTime: String(cls.startTime),
        durationMinutes: Number(cls.durationMinutes),
        weekday: Number(cls.weekday),
        intervalWeeks: Number(cls.intervalWeeks ?? 1),
        timezone: String(org?.timezone ?? 'UTC'),
        currency: String(org?.currency ?? 'BRL'),
        capacity: Number(cls.capacity),
        enrolledCount: Number(cls.enrolledCount ?? 0),
        pricePerParticipant: Number(cls.pricePerParticipant ?? cls.price ?? 0),
        enrollment: own
          ? {
              enrollmentId: String(own.enrollmentId),
              status: own.status === 'ACTIVE' ? 'ACTIVE' : 'CANCELLED',
            }
          : null,
        waitlist:
          ownWaitlist?.status === 'ACTIVE'
            ? { waitlistId: String(ownWaitlist.waitlistId), status: 'ACTIVE' }
            : null,
        full: Number(cls.enrolledCount ?? 0) >= Number(cls.capacity),
      };
    });
    return { data, nextCursor: refs.length > 20 ? page.at(-1)!.SK : null };
  }
  async enroll(
    ctx: Scope,
    classId: string,
    customerId: string,
    actorId: string,
    options: EnrollmentOptions = {},
  ) {
    const cls = await this.getClass(ctx, classId);
    if (cls.active !== true)
      throw new AppError('INVALID_STATE', 'Class is inactive.');
    const customer = await this.repo.get({
      PK: `ORG#${ctx.organizationId}`,
      SK: `CUSTOMER#${customerId}`,
    });
    if (!customer || customer.archived)
      throw new AppError('NOT_FOUND', 'Customer was not found.');
    const ownKey = classEnrollmentKey(ctx.organizationId, classId, customerId);
    const own = await this.repo.get(ownKey);
    if (own?.status === 'ACTIVE' && own.materializing !== true)
      throw new AppError(
        'CONFLICT',
        'Customer is already enrolled in this class.',
      );
    if (
      own?.status !== 'ACTIVE' &&
      Number(cls.enrolledCount) >= Number(cls.capacity)
    )
      throw new AppError('CONFLICT', 'Class is full. Join the waitlist.', {
        action: 'JOIN_WAITLIST',
      });
    const sessions = (await this.sessions(ctx, classId)).filter(
      (row) => row.status === 'SCHEDULED',
    );
    const resuming = own?.status === 'ACTIVE' && own.materializing === true;
    const enrollmentId = resuming
      ? String(own.enrollmentId)
      : (options.enrollmentId ?? randomUUID());
    const timestamp = new Date().toISOString();
    const value: RecordItem = {
      ...primary('ENROLLMENT', enrollmentId),
      entity: 'enrollment',
      enrollmentId,
      organizationId: ctx.organizationId,
      classId,
      customerId,
      status: 'ACTIVE',
      joinedAt: timestamp,
    };
    const enrollmentWrites: Write[] = resuming
      ? []
      : [
          {
            type: 'put',
            item: { ...cls, enrolledCount: Number(cls.enrolledCount) + 1 },
            expected: {
              enrolledCount: cls.enrolledCount,
              active: true,
              updatedAt: cls.updatedAt,
            },
          },
          { type: 'put', item: value },
          {
            type: 'put',
            item: {
              ...ownKey,
              enrollmentId,
              status: 'ACTIVE',
              materializing: true,
            },
            ...(own
              ? { expected: { status: own.status } }
              : { condition: 'attribute_not_exists(PK)' }),
          },
        ];
    const [court, coach] = await this.batchGet([
      { PK: `ORG#${ctx.organizationId}`, SK: `COURT#${cls.courtId}` },
      { PK: `ORG#${ctx.organizationId}`, SK: `USER#${cls.coachId}` },
    ]).then((rows) => [
      rows.find((row) => row.SK.startsWith('COURT#')),
      rows.find((row) => row.SK.startsWith('USER#')),
    ]);
    const chargeRows = await this.batchGet(
      sessions.map((session) =>
        primary('CHARGE', `class-${session.sessionId}-${customerId}`),
      ),
    );
    const chargeMap = new Map(chargeRows.map((row) => [row.PK, row]));
    const effects: Write[] = [];
    for (const session of sessions) {
      const writes: Write[] = [
        { type: 'check', key: value, expected: { status: 'ACTIVE' } },
      ];
      if (court)
        writes.push({
          type: 'put',
          item: classActivity({
            organizationId: ctx.organizationId,
            customerId,
            classId,
            sessionId: String(session.sessionId),
            name: String(cls.name),
            sport: String(cls.sport),
            startAt: String(session.startAt),
            endAt: String(session.endAt),
            status: String(session.status),
            court: { courtId: String(court.courtId), name: String(court.name) },
            ...(coach ? { coachName: String(coach.name) } : {}),
            createdAt: timestamp,
          }),
        });
      const price = Number(cls.pricePerParticipant ?? cls.price ?? 0);
      if (price > 0) {
        const chargeId = `class-${session.sessionId}-${customerId}`;
        const chargeKey = primary('CHARGE', chargeId);
        const old = chargeMap.get(chargeKey.PK);
        if (!old || old.status === 'VOID') {
          const charge = {
            ...chargeKey,
            entity: 'charge' as const,
            chargeId,
            organizationId: ctx.organizationId,
            customerId,
            sourceType: 'CLASS',
            sourceId: session.sessionId,
            classId,
            classSessionId: session.sessionId,
            description: String(cls.name),
            amount: price,
            serviceAt: session.startAt,
            status: 'ACTIVE' as const,
            createdBy: actorId,
            createdAt: old?.createdAt ?? timestamp,
          } as RecordItem;
          writes.push({
            type: 'put',
            item: charge,
            ...(old
              ? { expected: { status: 'VOID' } }
              : { condition: 'attribute_not_exists(PK)' }),
          });
          writes.push({ type: 'put', item: customerChargeIndex(charge) });
        }
      }
      effects.push(...writes.slice(1));
    }
    // Common classes commit enrollment, charges and activities together. Larger
    // classes retain a durable progress flag so retries finish remaining effects.
    const needsFirstTransaction =
      enrollmentWrites.length > 0 || Boolean(options.additionalWrites?.length);
    const firstEffects = needsFirstTransaction
      ? effects.splice(0, enrollmentWrites.length ? 90 : 89)
      : [];
    if (needsFirstTransaction)
      await this.repo.transactWrite([
        ...enrollmentWrites,
        ...(!enrollmentWrites.length
          ? [
              {
                type: 'check' as const,
                key: value,
                expected: { status: 'ACTIVE' },
              },
            ]
          : []),
        ...(options.additionalWrites ?? []),
        ...firstEffects,
      ]);
    for (let offset = 0; offset < effects.length; offset += 90)
      await this.repo.transactWrite([
        { type: 'check', key: value, expected: { status: 'ACTIVE' } },
        ...effects.slice(offset, offset + 90),
      ]);
    await this.repo.transactWrite([
      {
        type: 'put',
        item: {
          ...ownKey,
          enrollmentId,
          status: 'ACTIVE',
          materializing: false,
        },
        expected: { enrollmentId, status: 'ACTIVE' },
      },
    ]);
    return {
      ...publicEnrollment(value),
      classId,
      customerId,
      organizationId: ctx.organizationId,
      joinedAt: timestamp,
    };
  }
  async leaveSelf(ctx: CustomerAuthContext, classId: string) {
    await this.getClass(ctx, classId);
    const own = await this.repo.get(
      classEnrollmentKey(ctx.organizationId, classId, ctx.customerId),
    );
    if (!own) throw new AppError('NOT_FOUND', 'Enrollment was not found.');
    return this.cancel(
      ctx,
      classId,
      String(own.enrollmentId),
      ctx.customerAccountId,
      ctx.customerId,
    );
  }
  async cancel(
    ctx: Scope,
    classId: string,
    enrollmentId: string,
    actorId: string,
    customerId?: string,
  ) {
    const cls = await this.getClass(ctx, classId);
    const enrollment = await this.repo.get(primary('ENROLLMENT', enrollmentId));
    if (
      !enrollment ||
      enrollment.organizationId !== ctx.organizationId ||
      enrollment.classId !== classId ||
      (customerId && enrollment.customerId !== customerId)
    )
      throw new AppError('NOT_FOUND', 'Enrollment was not found.');
    const timestamp = new Date().toISOString();
    const ownKey = classEnrollmentKey(
      ctx.organizationId,
      classId,
      String(enrollment.customerId),
    );
    const own = await this.repo.get(ownKey);
    if (enrollment.status !== 'ACTIVE' && own?.enrollmentId !== enrollmentId)
      return publicEnrollment(enrollment);
    const value = {
      ...enrollment,
      status: 'CANCELLED',
      leftAt: enrollment.leftAt ?? timestamp,
      cancelledAt: enrollment.cancelledAt ?? timestamp,
    };
    const sessions = await this.sessions(ctx, classId);
    if (enrollment.status === 'ACTIVE')
      await this.repo.transactWrite([
        {
          type: 'put',
          item: {
            ...cls,
            enrolledCount: Math.max(0, Number(cls.enrolledCount) - 1),
          },
          expected: {
            enrolledCount: cls.enrolledCount,
            active: cls.active,
            updatedAt: cls.updatedAt,
          },
        },
        { type: 'put', item: value, expected: { status: 'ACTIVE' } },
        {
          type: 'put',
          item: { ...ownKey, enrollmentId, status: 'CANCELLED' },
          expected: { enrollmentId },
        },
      ]);
    const charges = await this.batchGet(
      sessions.map((session) =>
        primary(
          'CHARGE',
          `class-${session.sessionId}-${enrollment.customerId}`,
        ),
      ),
    );
    const effects: Write[] = [];
    for (const charge of charges.filter(
      (row) =>
        row.status === 'ACTIVE' && row.organizationId === ctx.organizationId,
    )) {
      const voidedCharge = {
        ...charge,
        status: 'VOID',
        voidedAt: timestamp,
        voidedBy: actorId,
        voidReason: 'Enrollment cancelled',
      };
      effects.push({
        type: 'put',
        item: voidedCharge,
        expected: { status: 'ACTIVE' },
      });
      effects.push({ type: 'put', item: customerChargeIndex(voidedCharge) });
    }
    if (enrollment.status === 'ACTIVE' || enrollment.status === 'CANCELLED') {
      const activities = sessions.map((session) =>
        classActivity({
          organizationId: ctx.organizationId,
          customerId: String(enrollment.customerId),
          classId,
          sessionId: String(session.sessionId),
          name: String(cls.name),
          sport: String(cls.sport),
          startAt: String(session.startAt),
          endAt: String(session.endAt),
          status: 'CANCELLED',
          court: { courtId: String(cls.courtId), name: '' },
          createdAt: timestamp,
        }),
      );
      for (const existing of await this.batchGet(
        activities.map(({ PK, SK }) => ({ PK, SK })),
      ))
        effects.push({
          type: 'put',
          item: { ...existing, status: 'CANCELLED', actions: ['VIEW'] },
        });
    }
    for (let offset = 0; offset < effects.length; offset += 90)
      await this.repo.transactWrite([
        {
          type: 'check',
          key: ownKey,
          expected: { enrollmentId, status: 'CANCELLED' },
        },
        ...effects.slice(offset, offset + 90),
      ]);
    return publicEnrollment(value);
  }
}
