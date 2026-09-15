import type {
  Court,
  CustomerCommercialActivityEvent,
  CustomerActivityItem,
  CustomerAuthContext,
  Reservation,
} from '@court-manager/contracts';
import type { RecordItem, Repository } from '../db.js';
import { AppError } from '../errors.js';
import { phase2Keys } from '../persistence/phase2-keys.js';

const as = <T>(item: RecordItem): T =>
  Object.fromEntries(
    Object.entries(item).filter(
      ([name]) => !['PK', 'SK', 'entity'].includes(name),
    ),
  ) as T;

const item = (value: CustomerActivityItem): RecordItem => {
  const activityKey = phase2Keys.customerActivity(
    value.organizationId,
    value.customerId,
    value.startAt,
    value.activityType,
    value.activityId,
  );
  return { ...value, ...activityKey, entity: 'customerActivity' };
};

export const reservationActivity = (
  reservation: Reservation,
  court: Court,
): RecordItem =>
  item({
    activityId: `reservation-${reservation.reservationId}`,
    organizationId: reservation.organizationId,
    customerId: reservation.customerId,
    activityType: 'RESERVATION',
    sourceId: reservation.reservationId,
    title: 'Court reservation',
    subtitle: court.name,
    startAt: reservation.startAt,
    endAt: reservation.endAt,
    status: reservation.status,
    court: { courtId: court.courtId, name: court.name },
    sport: court.sport,
    actions:
      reservation.status === 'BOOKED'
        ? ['VIEW', 'CANCEL', 'BOOK_AGAIN']
        : ['VIEW', 'BOOK_AGAIN'],
    createdAt: reservation.createdAt,
  });

export const classActivity = (input: {
  organizationId: string;
  customerId: string;
  classId: string;
  sessionId: string;
  name: string;
  sport: string;
  startAt: string;
  endAt: string;
  status: string;
  court: { courtId: string; name: string };
  coachName?: string;
  createdAt: string;
}): RecordItem =>
  item({
    activityId: `class-${input.sessionId}`,
    organizationId: input.organizationId,
    customerId: input.customerId,
    activityType: 'CLASS',
    sourceId: input.sessionId,
    title: input.name,
    ...(input.coachName ? { subtitle: input.coachName } : {}),
    startAt: input.startAt,
    endAt: input.endAt,
    status: input.status,
    court: input.court,
    sport: input.sport,
    actions: ['VIEW'],
    createdAt: input.createdAt,
  });

const commercialTitle = (eventType: string) =>
  eventType
    .toLowerCase()
    .split('_')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');

export const commercialActivity = (
  event: CustomerCommercialActivityEvent,
): CustomerActivityItem => ({
  activityId: event.eventId,
  organizationId: event.organizationId,
  customerId: event.customerId,
  activityType: 'COMMERCIAL',
  sourceId: event.sourceId,
  eventType: event.eventType,
  sourceType: event.sourceType,
  title: commercialTitle(event.eventType),
  subtitle: event.sourceType,
  startAt: event.occurredAt,
  endAt: event.occurredAt,
  status: 'RECORDED',
  actions: ['VIEW'],
  createdAt: event.createdAt,
});

export class CustomerActivityService {
  constructor(private readonly repo: Repository) {}

  private async listByCustomer(
    organizationId: string,
    customerId: string,
    input: { from: string; to: string; limit: number; cursor?: string },
  ) {
    if (Date.parse(input.to) <= Date.parse(input.from))
      throw new AppError(
        'VALIDATION_ERROR',
        'Activity end must be after start.',
      );
    if (Date.parse(input.to) - Date.parse(input.from) > 366 * 86400000)
      throw new AppError(
        'VALIDATION_ERROR',
        'Activity range cannot exceed one year.',
      );
    const prefix = 'ACTIVITY#';
    const cursor = input.cursor ? decodeURIComponent(input.cursor) : undefined;
    if (cursor && !cursor.startsWith(prefix))
      throw new AppError('VALIDATION_ERROR', 'Invalid activity cursor.');
    const rows = await this.repo.query<RecordItem>(
      phase2Keys.customerActivities(organizationId, customerId).PK,
      {
        between: [
          cursor ? `${cursor}\u0000` : `${prefix}${input.from}`,
          `${prefix}${input.to}#~`,
        ],
        limit: input.limit + 1,
      },
    );
    const visible = rows
      .filter(
        (row) =>
          row.entity === 'customerActivity' ||
          row.entity === 'customerActivityEvent',
      )
      .filter(
        (row) =>
          !(
            Date.parse(String(row.startAt)) >= Date.now() &&
            row.status === 'CANCELLED'
          ),
      );
    const page = visible.slice(0, input.limit);
    return {
      data: page.map((row) =>
        row.entity === 'customerActivityEvent'
          ? commercialActivity({
              eventId: String(row.eventId),
              organizationId: String(row.organizationId),
              customerId: String(row.customerId),
              eventType:
                row.eventType as CustomerCommercialActivityEvent['eventType'],
              sourceType:
                row.sourceType as CustomerCommercialActivityEvent['sourceType'],
              sourceId: String(row.sourceId),
              occurredAt: String(row.occurredAt),
              createdAt: String(row.createdAt),
            })
          : as<CustomerActivityItem>(row),
      ),
      nextCursor:
        visible.length > input.limit
          ? encodeURIComponent(String(page.at(-1)?.SK))
          : null,
    };
  }

  async list(
    ctx: CustomerAuthContext,
    input: { from: string; to: string; limit: number; cursor?: string },
  ) {
    return this.listByCustomer(ctx.organizationId, ctx.customerId, input);
  }

  async listForStaff(
    ctx: { organizationId: string },
    customerId: string,
    input: { from: string; to: string; limit: number; cursor?: string },
  ) {
    return this.listByCustomer(ctx.organizationId, customerId, input);
  }
}
