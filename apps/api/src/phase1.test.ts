import type { AuthContext } from '@court-manager/contracts';
import { describe, expect, it } from 'vitest';
import { MemoryRepository } from './db.js';
import { buildServices } from './services/index.js';

const owner: AuthContext = { organizationId: 'phase1-org', userId: 'owner', role: 'OWNER' };
const coach: AuthContext = { organizationId: 'phase1-org', userId: 'coach', role: 'COACH' };
const openingHours = Object.fromEntries(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'].map((day) => [day, { open: '07:00', close: '23:00' }]));
async function setup() {
  const repo = new MemoryRepository();
  await repo.put({ PK: 'ORG#phase1-org', SK: 'META', entity: 'organization', organizationId: 'phase1-org', name: 'Phase 1', slug: 'phase-1', timezone: 'UTC', currency: 'BRL', active: true, features: { classes: true, finance: true }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const services = buildServices(repo);
  const coachRecord = await services.staff.create(owner, { name: 'Coach', email: 'coach@phase1.test', role: 'COACH', password: 'password' });
  const court = await services.courts.create(owner, { name: 'Court', sport: 'Tennis', slotMinutes: 30, defaultHourlyPrice: 100, publiclyRequestable: true, active: true, openingHours });
  const customer = await services.customers.create(owner, { name: 'Ana', phone: '5551' });
  return { repo, services, court, customer, coachContext: { ...coach, userId: String(coachRecord.userId) } };
}
describe('Phase 1 operations', () => {
  it('enforces reservation attendance lifecycle and releases no-shows', async () => {
    const { services, court, customer } = await setup();
    const reservation = await services.reservations.create(owner, { courtId: court.courtId, customerId: customer.customerId, startAt: '2027-03-01T18:00:00Z', endAt: '2027-03-01T19:00:00Z', source: 'STAFF' });
    expect(reservation.status).toBe('BOOKED');
    await services.reservations.transition(owner, String(reservation.reservationId), 'CHECKED_IN');
    await services.reservations.transition(owner, String(reservation.reservationId), 'COMPLETED');
    await expect(services.reservations.transition(owner, String(reservation.reservationId), 'NO_SHOW')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    const noShow = await services.reservations.create(owner, { courtId: court.courtId, customerId: customer.customerId, startAt: '2027-03-01T19:00:00Z', endAt: '2027-03-01T20:00:00Z', source: 'STAFF' });
    await services.reservations.transition(owner, String(noShow.reservationId), 'NO_SHOW');
    await expect(services.reservations.create(owner, { courtId: court.courtId, customerId: customer.customerId, startAt: '2027-03-01T19:00:00Z', endAt: '2027-03-01T20:00:00Z', source: 'STAFF' })).resolves.toBeTruthy();
  });
  it('materializes class sessions, charges enrollment and records roster attendance', async () => {
    const { services, court, customer, coachContext } = await setup();
    const cls = await services.classes.create(owner, { name: 'Tennis group', sport: 'Tennis', type: 'GROUP', coachId: String(coachContext.userId), courtId: String(court.courtId), capacity: 8, pricePerParticipant: 40, scheduleType: 'SINGLE', startDate: '2027-03-02', startTime: '18:00', durationMinutes: 60 });
    const enrollment = await services.classes.enroll(owner, String(cls.classId), String(customer.customerId));
    expect(enrollment.status).toBe('ACTIVE');
    const roster = await services.classes.roster(coachContext, `${String(cls.classId)}-2027-03-02`);
    expect(roster.participants[0]?.status).toBe('BOOKED');
    await services.classes.participantTransition(coachContext, `${String(cls.classId)}-2027-03-02`, String(customer.customerId), 'CHECKED_IN');
    await services.classes.completeSession(coachContext, `${String(cls.classId)}-2027-03-02`);
    expect((await services.classes.roster(coachContext, `${String(cls.classId)}-2027-03-02`)).participants[0]?.status).toBe('COMPLETED');
    expect((await services.charges.list(owner)).some((charge) => (charge as Record<string, unknown>)['classSessionId'] === `${String(cls.classId)}-2027-03-02`)).toBe(true);
  });
  it('provides tenant-safe balances and Today aggregation', async () => {
    const { services, court, customer } = await setup();
    const reservation = await services.reservations.create(owner, { courtId: String(court.courtId), customerId: String(customer.customerId), startAt: '2027-03-03T18:00:00Z', endAt: '2027-03-03T19:00:00Z', expectedAmount: 100, source: 'STAFF' });
    await services.payments.create(owner, { reservationId: String(reservation.reservationId), customerId: String(customer.customerId), amount: 25, method: 'PIX', paidAt: '2027-03-03T18:00:00Z' });
    expect((await services.finance.balances(owner))[0]).toMatchObject({ outstanding: 75 });
    const today = await services.today.get(owner, new Date('2027-03-03T18:30:00Z'));
    expect(today.summary.reservations).toBe(1);
  });
});
