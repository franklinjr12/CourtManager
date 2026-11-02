import type { AuthContext } from '@court-manager/contracts';
import type { Key, RecordItem, Repository } from '../db.js';
import { classEnrollmentKey } from '../persistence/class-keys.js';

/**
 * Bounded read model of one venue-local day for the daily front-desk screens.
 *
 * Every court occupancy writes a `SCHEDULE#<org>#<court>#<date>` / `ITEM#...`
 * meta item, so the day is found with one Query per court, followed by batched
 * reads of the owning records. No table scan and no per-item reads.
 */
export type OperationalDay = {
  date: string;
  courts: RecordItem[];
  reservations: RecordItem[];
  blocks: RecordItem[];
  sessions: RecordItem[];
  classes: Map<string, RecordItem>;
  customers: Map<string, RecordItem>;
  /** classId -> enrollment lookup rows (active and cancelled). */
  enrollments: Map<string, RecordItem[]>;
  /** sessionId -> attendance rows for that session's known participants. */
  attendance: Map<string, RecordItem[]>;
};

const unique = (keys: Key[]) => [
  ...new Map(keys.map((key) => [`${key.PK}|${key.SK}`, key])).values(),
];
const batchGetChunked = async (repo: Repository, keys: Key[]) => {
  const distinct = unique(keys);
  const chunks: Key[][] = [];
  for (let offset = 0; offset < distinct.length; offset += 100)
    chunks.push(distinct.slice(offset, offset + 100));
  return (
    await Promise.all(chunks.map((chunk) => repo.batchGet<RecordItem>(chunk)))
  ).flat();
};
const idsOf = (refs: RecordItem[], type: string) =>
  refs
    .map((ref) => String(ref.SK))
    .filter((sk) => sk.startsWith(`ITEM#${type}#`))
    .map((sk) => sk.slice(`ITEM#${type}#`.length));
const own = (ctx: AuthContext, rows: RecordItem[]) =>
  rows.filter((row) => row.organizationId === ctx.organizationId);

export const isActiveEnrollment = (row: RecordItem) => row.status === 'ACTIVE';
export const isAttended = (row: RecordItem) =>
  ['CHECKED_IN', 'COMPLETED'].includes(String(row.status));

export async function loadOperationalDay(
  repo: Repository,
  ctx: AuthContext,
  date: string,
): Promise<OperationalDay> {
  const org = ctx.organizationId;
  const coach = ctx.role === 'COACH';
  const courts = await repo.query<RecordItem>(`ORG#${org}`, {
    beginsWith: 'COURT#',
  });
  const refs = (
    await Promise.all(
      courts.map((court) =>
        repo.query<RecordItem>(
          `SCHEDULE#${org}#${String(court.courtId)}#${date}`,
          { beginsWith: 'ITEM#' },
        ),
      ),
    )
  ).flat();
  const sources = await batchGetChunked(repo, [
    ...(coach
      ? []
      : [
          ...idsOf(refs, 'RESERVATION').map((id) => ({
            PK: `RESERVATION#${id}`,
            SK: 'META',
          })),
          ...idsOf(refs, 'BLOCK').map((id) => ({
            PK: `BLOCK#${id}`,
            SK: 'META',
          })),
        ]),
    ...idsOf(refs, 'CLASS').map((id) => ({
      PK: `CLASS_SESSION#${id}`,
      SK: 'META',
    })),
  ]);
  const owned = own(ctx, sources);
  const reservations = owned.filter(
    (row) => row.entity === 'reservation' && row.status !== 'CANCELLED',
  );
  const blocks = owned.filter(
    (row) => row.entity === 'block' && row.active === true,
  );
  const sessions = owned.filter(
    (row) =>
      row.entity === 'classSession' &&
      row.status !== 'CANCELLED' &&
      (!coach || row.coachId === ctx.userId),
  );
  const classIds = [...new Set(sessions.map((row) => String(row.classId)))];
  const [classRows, enrollmentGroups] = await Promise.all([
    batchGetChunked(
      repo,
      classIds.map((classId) => ({ PK: `CLASS#${classId}`, SK: 'META' })),
    ),
    Promise.all(
      classIds.map(async (classId) => [
        classId,
        await repo.query<RecordItem>(classEnrollmentKey(org, classId, '').PK, {
          beginsWith: 'CUSTOMER#',
        }),
      ]),
    ),
  ]);
  const classes = new Map(
    own(ctx, classRows)
      .filter((row) => !coach || row.coachId === ctx.userId)
      .map((row) => [String(row.classId), row]),
  );
  const enrollments = new Map(
    enrollmentGroups.map(([classId, rows]) => [
      classId as string,
      rows as RecordItem[],
    ]),
  );
  const customerIds = new Set(
    reservations.map((row) => String(row.customerId)),
  );
  const attendanceKeys = sessions.flatMap((session) =>
    (enrollments.get(String(session.classId)) ?? []).map((row) => ({
      PK: `ATTENDANCE#${String(session.sessionId)}-${String(row.SK).slice('CUSTOMER#'.length)}`,
      SK: 'META',
    })),
  );
  const [customerRows, attendanceRows] = await Promise.all([
    batchGetChunked(
      repo,
      [...customerIds].map((customerId) => ({
        PK: `ORG#${org}`,
        SK: `CUSTOMER#${customerId}`,
      })),
    ),
    batchGetChunked(repo, attendanceKeys),
  ]);
  const attendance = new Map<string, RecordItem[]>();
  for (const row of own(ctx, attendanceRows)) {
    const list = attendance.get(String(row.sessionId)) ?? [];
    list.push(row);
    attendance.set(String(row.sessionId), list);
  }
  return {
    date,
    courts,
    reservations,
    blocks,
    sessions: sessions.filter((row) => classes.has(String(row.classId))),
    classes,
    customers: new Map(
      own(ctx, customerRows).map((row) => [String(row.customerId), row]),
    ),
    enrollments,
    attendance,
  };
}

/** Class session rows enriched with class name/sport and attendance counts. */
export function classOccurrences(
  day: OperationalDay,
  strip: (row: RecordItem) => Record<string, unknown>,
) {
  return day.sessions.map((session) => {
    const cls = day.classes.get(String(session.classId)) as RecordItem;
    return {
      ...strip(session),
      name: cls.name,
      sport: cls.sport,
      occupancyType: 'CLASS',
      enrolled: (day.enrollments.get(String(session.classId)) ?? []).filter(
        isActiveEnrollment,
      ).length,
      checkedIn: (day.attendance.get(String(session.sessionId)) ?? []).filter(
        isAttended,
      ).length,
    };
  });
}

const stripKeys = (row: RecordItem) =>
  Object.fromEntries(
    Object.entries(row).filter(
      ([name]) => !['PK', 'SK', 'entity'].includes(name),
    ),
  );
export const blockRows = (day: OperationalDay) => day.blocks.map(stripKeys);
export const occurrenceRows = (day: OperationalDay) =>
  classOccurrences(day, stripKeys);

type ReservationLister = {
  fromRecords(
    ctx: AuthContext,
    rows: RecordItem[],
    customers?: RecordItem[],
  ): Promise<unknown[]>;
};

/** One-day Agenda view: reservations, blocks and class sessions per court. */
export class ScheduleDayService {
  constructor(
    private readonly repo: Repository,
    private readonly reservations: ReservationLister,
  ) {}
  async get(ctx: AuthContext, date: string) {
    const day = await loadOperationalDay(this.repo, ctx, date);
    const reservations = await this.reservations.fromRecords(
      ctx,
      day.reservations,
      [...day.customers.values()],
    );
    const items = [
      ...reservations,
      ...blockRows(day),
      ...occurrenceRows(day),
    ] as { courtId?: string }[];
    const courts = day.courts
      .filter(
        (court) =>
          (court.active === true && !court.archivedAt) ||
          items.some((item) => item.courtId === court.courtId),
      )
      .map(stripKeys);
    return { date, courts, items };
  }
}
