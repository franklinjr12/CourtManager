import { describe, expect, it, vi } from 'vitest';
import { MemoryRepository } from '../db.js';
import { classFixture } from '../testing/class-fixture.js';
import { loadOperationalDay } from './operational-day.js';

const day = '2099-01-05';
async function setup() {
  const repo = new MemoryRepository();
  const fixture = await classFixture(repo, 5);
  const { services, owner, ctx, ctx2 } = fixture;
  const [court] = await services.courts.list(owner);
  const courtId = String(court?.courtId);
  const customer = await services.customers.create(owner, {
    name: 'Walk In',
    phone: '41999990077',
  });
  const book = (hour: number) =>
    services.reservations.create(owner, {
      courtId,
      customerId: customer.customerId,
      startAt: `${day}T${String(hour).padStart(2, '0')}:00:00-03:00`,
      endAt: `${day}T${String(hour + 1).padStart(2, '0')}:00:00-03:00`,
      source: 'STAFF',
    });
  return { repo, ...fixture, courtId, customer, book, ctx, ctx2 };
}

describe('loadOperationalDay', () => {
  it('returns the day with enrolled and checked-in counts and never scans', async () => {
    const { repo, services, owner, ctx, ctx2, classId, courtId, book } =
      await setup();
    const reservation = await book(14);
    const block = await services.blocks.create(owner, {
      courtId,
      startAt: `${day}T16:00:00-03:00`,
      endAt: `${day}T17:00:00-03:00`,
      reason: 'Maintenance',
    });
    await services.classes.enrollSelf(ctx, classId);
    await services.classes.enrollSelf(ctx2, classId);
    const sessionId = `${classId}-${day}`;
    await services.classes.participantTransition(
      owner,
      sessionId,
      ctx.customerId,
      'CHECKED_IN',
    );
    const scan = vi.spyOn(repo, 'scan');
    const loaded = await loadOperationalDay(repo, owner, day);
    expect(loaded.reservations.map((r) => r.reservationId)).toEqual([
      reservation.reservationId,
    ]);
    expect(loaded.blocks.map((b) => b.blockId)).toEqual([block.blockId]);
    expect(loaded.sessions.map((s) => s.sessionId)).toEqual([sessionId]);
    expect(loaded.customers.size).toBe(1);
    expect(await services.classes.occurrences(owner, day)).toMatchObject([
      { name: 'Customer Tennis', enrolled: 2, checkedIn: 1 },
    ]);
    expect(await services.blocks.list(owner, day)).toHaveLength(1);
    const schedule = await services.scheduleDay.get(owner, day);
    expect(schedule.items).toHaveLength(3);
    expect(schedule.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ customerName: 'Walk In' }),
      ]),
    );
    expect(scan).not.toHaveBeenCalled();
  });

  it('excludes cancelled reservations, blocks and sessions', async () => {
    const { repo, services, owner, classId, courtId, book } = await setup();
    const reservation = await book(14);
    const block = await services.blocks.create(owner, {
      courtId,
      startAt: `${day}T16:00:00-03:00`,
      endAt: `${day}T17:00:00-03:00`,
      reason: 'Maintenance',
    });
    await services.reservations.transition(
      owner,
      String(reservation.reservationId),
      'CANCELLED',
    );
    await services.blocks.cancel(owner, String(block.blockId));
    await services.classes.cancelSession(owner, `${classId}-${day}`);
    const loaded = await loadOperationalDay(repo, owner, day);
    expect(loaded.reservations).toEqual([]);
    expect(loaded.blocks).toEqual([]);
    expect(loaded.sessions).toEqual([]);
  });

  it('excludes another organization and hides non-coach items from coaches', async () => {
    const { repo, owner, services, book } = await setup();
    await book(14);
    const other = await setup();
    await other.book(14);
    const loaded = await loadOperationalDay(repo, owner, day);
    expect(loaded.reservations).toHaveLength(1);
    expect(loaded.reservations[0]?.organizationId).toBe(owner.organizationId);
    const coach = { ...owner, userId: 'coach', role: 'COACH' as const };
    const own = await loadOperationalDay(repo, coach, day);
    expect(own.reservations).toEqual([]);
    expect(own.sessions).toHaveLength(1);
    const stranger = { ...coach, userId: 'someone-else' };
    expect((await loadOperationalDay(repo, stranger, day)).sessions).toEqual(
      [],
    );
    expect(await services.classes.occurrences(stranger, day)).toEqual([]);
  });

  it('keys late-evening class sessions by the venue-local date', async () => {
    const { repo, services, owner, courtId } = await setup();
    await services.classes.create(owner, {
      name: 'Late class',
      sport: 'Tennis',
      coachId: 'coach',
      courtId,
      capacity: 4,
      scheduleType: 'SINGLE',
      startDate: '2099-01-06',
      startTime: '21:30',
      durationMinutes: 60,
    });
    // 21:30 in Sao Paulo is 00:30Z on the next UTC date.
    expect(
      (await loadOperationalDay(repo, owner, '2099-01-06')).sessions,
    ).toMatchObject([{ startAt: '2099-01-07T00:30:00.000Z' }]);
    expect(
      await services.classes.occurrences(owner, '2099-01-06'),
    ).toHaveLength(1);
    expect(await services.classes.occurrences(owner, '2099-01-07')).toEqual([]);
  });
});
