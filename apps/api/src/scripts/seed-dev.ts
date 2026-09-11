import type { AuthContext } from '@court-manager/contracts';
import { ensureTable, dynamo } from '../db.js';
import {
  addLocalMinutes,
  dayKeyInTimezone,
  zonedDateTimeToIso,
  zonedParts,
} from '../domain.js';
import { hashPassword } from '../security.js';
import { buildServices } from '../services/index.js';
await ensureTable();
if ((process.env.NODE_ENV ?? 'development') === 'production')
  throw new Error('seed:dev refuses NODE_ENV=production.');
const repo = dynamo(),
  found = (await repo.scan((x) => x.entity === 'organization'))[0];
if (found) {
  console.log('Development seed already exists.');
  process.exit(0);
}
const organizationId = 'seed-org',
  userId = 'seed-owner',
  timestamp = new Date().toISOString();
await repo.put({
  PK: `ORG#${organizationId}`,
  SK: 'META',
  entity: 'organization',
  organizationId,
  name: 'Arena Central',
  slug: 'arena-central',
  timezone: 'America/Sao_Paulo',
  currency: 'BRL',
  phone: '(41) 3333-0000',
  email: 'contato@arena.test',
  active: true,
  features: { classes: true, finance: true },
  createdAt: timestamp,
  updatedAt: timestamp,
});
await repo.put({
  PK: `ORG#${organizationId}`,
  SK: `USER#${userId}`,
  entity: 'user',
  userId,
  organizationId,
  name: 'Owner',
  email: 'owner@arena.test',
  role: 'OWNER',
  passwordHash: await hashPassword('dev-password'),
  active: true,
  createdAt: timestamp,
  updatedAt: timestamp,
});
const days = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
];
for (const [sportId, name] of [
  ['seed-sport-tennis', 'Tennis'],
  ['seed-sport-beach-volleyball', 'Beach volleyball'],
] as const) {
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: `SPORT#${sportId}`,
    entity: 'sport',
    sportId,
    organizationId,
    name,
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}
for (let i = 1; i <= 4; i++) {
  const courtId = `seed-court-${i}`;
  const sportId = i % 2 ? 'seed-sport-beach-volleyball' : 'seed-sport-tennis';
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: `COURT#${courtId}`,
    entity: 'court',
    courtId,
    organizationId,
    name: `Court ${i}`,
    sport: i % 2 ? 'Beach volleyball' : 'Tennis',
    sportId,
    active: true,
    publiclyRequestable: true,
    slotMinutes: 30,
    defaultHourlyPrice: 80,
    openingHours: Object.fromEntries(
      days.map((day) => [day, { open: '07:00', close: '23:00' }]),
    ),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}
for (let i = 1; i <= 20; i++) {
  const customerId = `seed-customer-${i}`;
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: `CUSTOMER#${customerId}`,
    entity: 'customer',
    customerId,
    organizationId,
    name: `Customer ${i}`,
    phone: `4199999${String(i).padStart(4, '0')}`,
    normalizedPhone: `4199999${String(i).padStart(4, '0')}`,
    normalizedEmail: `customer${i}@arena.test`,
    tags: [],
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}
console.log(
  'Seeded Arena Central with owner, courts, and customers. Login: owner@arena.test / dev-password',
);

const services = buildServices(repo);
const owner: AuthContext = { organizationId, userId, role: 'OWNER' };
const staff = await services.staff.create(owner, {
  name: 'Front Desk',
  email: 'staff@arena.test',
  role: 'STAFF',
  password: 'dev-password',
});
const coach = await services.staff.create(owner, {
  name: 'Coach Pedro',
  email: 'coach@arena.test',
  role: 'COACH',
  password: 'dev-password',
});
const zone = 'America/Sao_Paulo';
const local = zonedParts(new Date(), zone);
const today = dayKeyInTimezone(new Date().toISOString(), zone);
const hour = Math.max(
  8,
  Math.min(20, local.hour - (local.minute < 30 ? 1 : 0)),
);
const time = `${String(hour).padStart(2, '0')}:00`;
const nextTime = `${String(Math.min(21, hour + 2)).padStart(2, '0')}:00`;
const customer = (n: number) => `seed-customer-${n}`;
const reservation = await services.reservations.create(owner, {
  courtId: 'seed-court-1',
  customerId: customer(1),
  startAt: zonedDateTimeToIso(today, time, zone),
  endAt: addLocalMinutes(today, time, 60, zone),
  expectedAmount: 80,
  source: 'WALK_IN',
});
await services.reservations.transition(
  owner,
  String(reservation.reservationId),
  'CHECKED_IN',
);
const arriving = await services.reservations.create(owner, {
  courtId: 'seed-court-2',
  customerId: customer(2),
  startAt: zonedDateTimeToIso(today, nextTime, zone),
  endAt: addLocalMinutes(today, nextTime, 60, zone),
  expectedAmount: 80,
  source: 'PHONE',
});
const completed = await services.reservations.create(owner, {
  courtId: 'seed-court-3',
  customerId: customer(3),
  startAt: zonedDateTimeToIso(today, '08:00', zone),
  endAt: addLocalMinutes(today, '08:00', 60, zone),
  expectedAmount: 80,
  source: 'STAFF',
});
await services.reservations.transition(
  owner,
  String(completed.reservationId),
  'CHECKED_IN',
);
await services.reservations.transition(
  owner,
  String(completed.reservationId),
  'COMPLETED',
);
const noShow = await services.reservations.create(owner, {
  courtId: 'seed-court-4',
  customerId: customer(4),
  startAt: zonedDateTimeToIso(today, '09:00', zone),
  endAt: addLocalMinutes(today, '09:00', 60, zone),
  expectedAmount: 80,
  source: 'STAFF',
});
await services.reservations.transition(
  owner,
  String(noShow.reservationId),
  'NO_SHOW',
);
const cancelled = await services.reservations.create(owner, {
  courtId: 'seed-court-4',
  customerId: customer(4),
  startAt: zonedDateTimeToIso(today, '10:00', zone),
  endAt: addLocalMinutes(today, '10:00', 60, zone),
  expectedAmount: 80,
  source: 'STAFF',
});
await services.reservations.transition(
  owner,
  String(cancelled.reservationId),
  'CANCELLED',
);
const classStart = `${String(Math.min(21, hour + 1)).padStart(2, '0')}:00`;
const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
const group = await services.classes.create(owner, {
  name: 'Intermediate Beach Volleyball',
  sport: 'Beach volleyball',
  coachId: coach.userId,
  courtId: 'seed-court-3',
  type: 'GROUP',
  capacity: 8,
  pricePerParticipant: 50,
  scheduleType: 'SINGLE',
  weekday,
  startTime: classStart,
  durationMinutes: 60,
  startDate: today,
});
await services.classes.enroll(owner, String(group.classId), customer(5));
await services.classes.enroll(owner, String(group.classId), customer(6));
const sessionId = `${group.classId}-${today}`;
if (Date.parse(zonedDateTimeToIso(today, classStart, zone)) > Date.now())
  await services.classes.participantTransition(
    owner,
    sessionId,
    customer(5),
    'CHECKED_IN',
  );
const privateLesson = await services.classes.create(owner, {
  name: 'Private tennis lesson',
  sport: 'Tennis',
  coachId: coach.userId,
  courtId: 'seed-court-4',
  type: 'PRIVATE',
  capacity: 1,
  pricePerParticipant: 90,
  scheduleType: 'SINGLE',
  weekday,
  startTime: '15:00',
  durationMinutes: 60,
  startDate: today,
});
await services.classes.enroll(
  owner,
  String(privateLesson.classId),
  customer(7),
);
const tomorrow = new Date(`${today}T12:00:00Z`);
tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
const tomorrowKey = tomorrow.toISOString().slice(0, 10);
await services.requests.createPublic('arena-central', {
  courtId: 'seed-court-1',
  requestedStartAt: zonedDateTimeToIso(tomorrowKey, '20:00', zone),
  requestedEndAt: zonedDateTimeToIso(tomorrowKey, '21:00', zone),
  customerName: 'Pending Request',
  phone: '41999990099',
});
await services.payments.create(owner, {
  reservationId: reservation.reservationId,
  customerId: customer(1),
  amount: 40,
  method: 'PIX',
  paidAt: new Date().toISOString(),
});
await services.payments.create(owner, {
  reservationId: completed.reservationId,
  customerId: customer(3),
  amount: 80,
  method: 'CASH',
  paidAt: new Date().toISOString(),
});
await services.expenses.create(owner, {
  date: today,
  description: 'Court cleaning',
  category: 'CLEANING',
  amount: 120,
});
void arriving;
void staff;
