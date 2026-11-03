import { describe, expect, it, vi } from 'vitest';
import { MemoryRepository } from '../db.js';
import { operationalKeys } from '../persistence/operational-keys.js';
import { classFixture } from '../testing/class-fixture.js';

const day = '2099-01-05';
// 10:30 in Sao Paulo (UTC-3).
const instant = new Date(`${day}T13:30:00.000Z`);
const local = (date: string, hour: number) =>
  `${date}T${String(hour).padStart(2, '0')}:00:00-03:00`;

async function setup(repo = new MemoryRepository()) {
  const fixture = await classFixture(repo, 5);
  const { services, owner, slug } = fixture;
  const [court] = await services.courts.list(owner);
  const courtId = String(court?.courtId);
  await services.courts.update(owner, courtId, { publiclyRequestable: true });
  const walkIn = await services.customers.create(owner, {
    name: 'Walk In',
    phone: '41999990077',
  });
  const book = (date: string, hour: number) =>
    services.reservations.create(owner, {
      courtId,
      customerId: walkIn.customerId,
      startAt: local(date, hour),
      endAt: local(date, hour + 1),
      source: 'STAFF',
    });
  const request = (hour: number) =>
    services.requests.createPublic(slug, {
      courtId,
      requestedStartAt: local('2099-01-06', hour),
      requestedEndAt: local('2099-01-06', hour + 1),
      customerName: 'Public player',
      phone: '41999990000',
    });
  return { ...fixture, repo, courtId, book, request };
}

/**
 * Mixed front-desk day: an overdue, a checked-in, an arriving and a later
 * reservation; a block; one class session with one checked-in and one late
 * participant; partial/full/no payments; requests in every review state.
 */
async function mixedDay(repo = new MemoryRepository()) {
  const base = await setup(repo);
  const { services, owner, ctx, ctx2, classId, courtId, request } = base;
  const book = (hour: number) => base.book(day, hour);
  const overdue = await book(8);
  const checkedIn = await book(9);
  const arriving = await book(11);
  const later = await book(16);
  await services.reservations.transition(
    owner,
    String(checkedIn.reservationId),
    'CHECKED_IN',
  );
  await services.blocks.create(owner, {
    courtId,
    startAt: local(day, 18),
    endAt: local(day, 19),
    reason: 'Maintenance',
  });
  await services.payments.create(owner, {
    reservationId: overdue.reservationId,
    customerId: overdue.customerId,
    amount: 80,
    method: 'PIX',
    paidAt: instant.toISOString(),
  });
  await services.payments.create(owner, {
    reservationId: arriving.reservationId,
    customerId: arriving.customerId,
    amount: 30,
    method: 'PIX',
    paidAt: instant.toISOString(),
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
  await services.payments.create(owner, {
    chargeId: `class-${sessionId}-${ctx.customerId}`,
    amount: 40,
    method: 'PIX',
    paidAt: instant.toISOString(),
  });
  const open = await request(10);
  const rejected = await request(12);
  const confirmed = await request(14);
  await services.requests.reject(owner, String(rejected.requestId), 'Full');
  await services.requests.confirm(owner, String(confirmed.requestId));
  return {
    ...base,
    sessionId,
    open,
    reservations: { overdue, checkedIn, arriving, later },
  };
}

describe('TodayService', () => {
  it('summarizes the venue-local day from bounded lookups without scans', async () => {
    const { repo, services, owner, ctx, ctx2, sessionId, open, reservations } =
      await mixedDay();
    const scan = vi.spyOn(repo, 'scan');
    const today = await services.today.get(owner, instant);
    expect(scan).not.toHaveBeenCalled();

    expect(today.date).toBe(day);
    expect(today.summary).toEqual({
      reservations: 4,
      classSessions: 1,
      pendingRequests: 1,
      uncheckedIn: 2,
      outstandingActions: 7,
    });
    expect(today.courts).toMatchObject([
      {
        status: 'CLASS',
        current: { sessionId, className: 'Customer Tennis' },
        next: {
          reservationId: reservations.arriving.reservationId,
          customerName: 'Walk In',
        },
      },
    ]);
    expect(today.arrivalsNextHour).toMatchObject([
      {
        reservationId: reservations.arriving.reservationId,
        customerName: 'Walk In',
      },
    ]);
    expect(today.overdueCheckIns).toEqual([
      {
        type: 'LATE_RESERVATION_CHECKIN',
        label: 'Walk In has not checked in',
        reservationId: reservations.overdue.reservationId,
        startAt: reservations.overdue.startAt,
      },
    ]);
    expect(today.pendingRequests).toMatchObject([
      { requestId: open.requestId, status: 'REQUESTED' },
    ]);
    expect(today.pendingRequests[0]).not.toHaveProperty('PK');
    const attention = today.attention as Record<string, unknown>[];
    expect(attention.filter((x) => x.type === 'LATE_CLASS_CHECKIN')).toEqual([
      {
        type: 'LATE_CLASS_CHECKIN',
        label: 'Bea has not checked in',
        sessionId,
        customerId: ctx2.customerId,
      },
    ]);
    const outstanding = attention.filter(
      (x) => x.type === 'OUTSTANDING_TODAY_PAYMENT',
    );
    expect(outstanding.map((x) => x.chargeId).sort()).toEqual(
      [
        `class-${sessionId}-${ctx2.customerId}`,
        `reservation-${String(reservations.arriving.reservationId)}`,
        `reservation-${String(reservations.checkedIn.reservationId)}`,
        `reservation-${String(reservations.later.reservationId)}`,
      ].sort(),
    );
    expect(outstanding).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          customerId: ctx2.customerId,
          label: 'Bea has an outstanding balance',
        }),
      ]),
    );
    expect(
      outstanding.some(
        (x) => x.chargeId === `class-${sessionId}-${ctx.customerId}`,
      ),
    ).toBe(false);
  });

  it('shows coaches only their own classes', async () => {
    const { services, owner, ctx2, sessionId } = await mixedDay();
    const coach = { ...owner, userId: 'coach', role: 'COACH' as const };
    const today = await services.today.get(coach, instant);
    expect(today.summary).toEqual({
      reservations: 0,
      classSessions: 1,
      pendingRequests: 0,
      uncheckedIn: 1,
      outstandingActions: 1,
    });
    expect(today.pendingRequests).toEqual([]);
    expect(today.attention).toEqual([
      expect.objectContaining({ sessionId, customerId: ctx2.customerId }),
    ]);
    const stranger = { ...coach, userId: 'someone-else' };
    expect((await services.today.get(stranger, instant)).summary).toEqual({
      reservations: 0,
      classSessions: 0,
      pendingRequests: 0,
      uncheckedIn: 0,
      outstandingActions: 0,
    });
  });

  it("excludes another organization's day, requests and charges", async () => {
    const repo = new MemoryRepository();
    const mine = await mixedDay(repo);
    const before = await mine.services.today.get(mine.owner, instant);
    const other = await mixedDay(repo);
    await other.book(day, 20);
    const after = await mine.services.today.get(mine.owner, instant);
    expect(after.summary).toEqual(before.summary);
    expect(after.attention).toEqual(before.attention);
    expect(after.pendingRequests).toEqual(before.pendingRequests);
    expect(
      (await other.services.today.get(other.owner, instant)).summary
        .reservations,
    ).toBe(5);
  });

  it('removes an open request from the lookup once it is reviewed', async () => {
    const { repo, services, owner, open } = await mixedDay();
    const lookup = () =>
      repo.query(
        operationalKeys.organizationOpenRequests(owner.organizationId).PK,
        { beginsWith: 'REQUEST#' },
      );
    expect(await lookup()).toHaveLength(1);
    await services.requests.reject(owner, String(open.requestId));
    expect(await lookup()).toEqual([]);
    expect(
      (await services.today.get(owner, instant)).summary.pendingRequests,
    ).toBe(0);
  });

  it('uses the venue-local date at the UTC day boundary', async () => {
    const { services, owner, book } = await setup();
    // 22:00 local on Jan 4 is 01:00Z on Jan 5; 22:00 local on Jan 5 is Jan 6Z.
    await book('2099-01-04', 22);
    const lateTonight = await book(day, 22);
    // 23:30 local on Jan 5 is already 02:30Z on Jan 6.
    const today = await services.today.get(
      owner,
      new Date('2099-01-06T02:30:00.000Z'),
    );
    expect(today.date).toBe(day);
    expect(today.summary.reservations).toBe(1);
    expect(today.overdueCheckIns).toMatchObject([
      { reservationId: lateTonight.reservationId },
    ]);
  });
});
