import { ensureTable, dynamo, type RecordItem } from '../db.js';
import {
  addLocalMinutes,
  recurrenceDates,
  zonedDateTimeToIso,
} from '../domain.js';

await ensureTable();
const repo = dynamo();
const timestamp = new Date().toISOString();
let reservations = 0,
  sessions = 0,
  charges = 0;
for (const item of await repo.scan<RecordItem>()) {
  if (item.entity === 'reservation' && item.status === 'CONFIRMED') {
    await repo.put({ ...item, status: 'BOOKED', updatedAt: timestamp });
    reservations += 1;
  }
  if (item.entity === 'reservation') {
    const chargeId = `reservation-${item.reservationId}`;
    if (!(await repo.get({ PK: `CHARGE#${chargeId}`, SK: 'META' }))) {
      await repo.put({
        PK: `CHARGE#${chargeId}`,
        SK: 'META',
        entity: 'charge',
        chargeId,
        organizationId: item.organizationId,
        customerId: item.customerId,
        sourceType: 'RESERVATION',
        sourceId: item.reservationId,
        reservationId: item.reservationId,
        description: 'Court reservation',
        amount: Number(item.expectedAmount ?? 0),
        serviceAt: item.startAt,
        status: item.status === 'CANCELLED' ? 'VOID' : 'ACTIVE',
        createdBy: item.createdBy,
        createdAt: timestamp,
        ...(item.status === 'CANCELLED'
          ? {
              voidedAt: timestamp,
              voidReason: 'Reservation was already cancelled',
            }
          : {}),
      });
      charges += 1;
    }
  }
}
for (const cls of (await repo.scan<RecordItem>()).filter(
  (x) => x.entity === 'class',
)) {
  const organization = await repo.get<RecordItem>({
    PK: `ORG#${cls.organizationId}`,
    SK: 'META',
  });
  const timezone = String(organization?.timezone ?? 'UTC');
  const first = String(cls.startDate),
    last = String(cls.endDate ?? first);
  const weekday = Number(
    cls.weekday ?? new Date(`${first}T12:00:00Z`).getUTCDay(),
  );
  const dates =
    String(cls.scheduleType ?? 'WEEKLY') === 'SINGLE'
      ? [first]
      : recurrenceDates(first, last, weekday, Number(cls.intervalWeeks ?? 1));
  for (const date of dates) {
    const sessionId = `${cls.classId}-${date}`;
    const key = { PK: `CLASS_SESSION#${sessionId}`, SK: 'META' };
    if (await repo.get(key)) continue;
    const startAt = zonedDateTimeToIso(date, String(cls.startTime), timezone);
    await repo.put({
      ...key,
      entity: 'classSession',
      sessionId,
      organizationId: cls.organizationId,
      classId: cls.classId,
      courtId: cls.courtId,
      coachId: cls.coachId,
      startAt,
      endAt: addLocalMinutes(
        date,
        String(cls.startTime),
        Number(cls.durationMinutes),
        timezone,
      ),
      status: 'SCHEDULED',
      capacity: Number(cls.capacity),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    sessions += 1;
  }
}
for (const attendance of (await repo.scan<RecordItem>()).filter(
  (x) => x.entity === 'attendance' && !x.sessionId,
)) {
  const sessionId = `${attendance.classId}-${attendance.date}`;
  const session = await repo.get<RecordItem>({
    PK: `CLASS_SESSION#${sessionId}`,
    SK: 'META',
  });
  if (!session) continue;
  const status = attendance.status === 'PRESENT' ? 'COMPLETED' : 'NO_SHOW';
  await repo.put({
    ...attendance,
    sessionId,
    status,
    ...(attendance.status === 'EXCUSED' ? { excused: true } : {}),
  });
}
console.log(
  `Phase 1 migration complete: ${reservations} reservations normalized, ${sessions} class sessions created, ${charges} reservation charges created.`,
);
