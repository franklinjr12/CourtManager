import { describe, expect, it } from 'vitest';
import { call, dateAhead, journey, slot } from '../testing/journey-fixture.js';

async function classJourney(capacity = 1) {
  const fixture = await journey({ reservationMode: 'AUTO_CONFIRM' });
  const staff = await fixture.staffLogin();
  const date = dateAhead(5);
  const cls = await call(fixture.app, 'POST', '/classes', staff, {
    name: 'Beginner Tennis',
    sport: 'Tennis',
    coachId: 'coach',
    courtId: fixture.venue.courts.tennis,
    capacity,
    pricePerParticipant: 40,
    scheduleType: 'SINGLE',
    startDate: date,
    startTime: '08:00',
    durationMinutes: 60,
    notes: 'Private management note',
  });
  expect(cls.status).toBe(201);
  return { ...fixture, staff, date, classId: cls.body.data.classId as string };
}

describe('journey: classes', () => {
  it('browses, enrolls with a charge, refuses duplicates and full classes, then leaves', async () => {
    const { app, repo, staff, classId, customer } = await classJourney(1);
    const ana = await customer();
    const bea = await customer();

    const browse = await call(app, 'GET', '/customer/classes', ana.token);
    expect(browse.status).toBe(200);
    const listed = (browse.body.data.data as Record<string, unknown>[]).find(
      (item) => item.classId === classId,
    );
    expect(listed).toMatchObject({
      name: 'Beginner Tennis',
      coachName: 'Coach Maria',
      capacity: 1,
      enrolledCount: 0,
      pricePerParticipant: 40,
      full: false,
    });
    expect(JSON.stringify(listed)).not.toMatch(
      /Private management|passwordHash|coach-.*@journey\.test/,
    );

    const enrolled = await call(
      app,
      'POST',
      `/customer/classes/${classId}/enroll`,
      ana.token,
    );
    expect(enrolled.status).toBe(201);
    expect(enrolled.body.data.customerId).toBe(ana.customerId);
    const activities = await call(app, 'GET', '/customer/activities', ana.token);
    expect(activities.body.data).toEqual([
      expect.objectContaining({ activityType: 'CLASS', title: 'Beginner Tennis' }),
    ]);
    const classCharges = () =>
      repo.scan(
        (item) =>
          item.entity === 'charge' &&
          item.customerId === ana.customerId &&
          String(item.chargeId).startsWith(`class-${classId}`),
      );
    expect(await classCharges()).toEqual([
      expect.objectContaining({ status: 'ACTIVE', amount: 40 }),
    ]);

    expect(
      (await call(app, 'POST', `/customer/classes/${classId}/enroll`, ana.token))
        .status,
    ).toBe(409);
    const full = await call(
      app,
      'POST',
      `/customer/classes/${classId}/enroll`,
      bea.token,
    );
    expect(full.status).not.toBe(201);
    expect(full.body.error.details).toMatchObject({ action: 'JOIN_WAITLIST' });

    expect(
      (await call(app, 'POST', `/customer/classes/${classId}/leave`, ana.token))
        .status,
    ).toBe(200);
    expect(await classCharges()).toEqual([
      expect.objectContaining({ status: 'VOID' }),
    ]);
    expect(
      (await call(app, 'GET', '/customer/activities', ana.token)).body.data,
    ).toEqual([]);
    const roster = await call(app, 'GET', `/classes/${classId}/enrollments`, staff);
    expect(roster.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ customerId: ana.customerId, status: 'CANCELLED' }),
      ]),
    );
    // The seat is free again.
    expect(
      (await call(app, 'POST', `/customer/classes/${classId}/enroll`, bea.token))
        .status,
    ).toBe(201);
  });
});

describe('journey: waitlists', () => {
  it('joins class and court waitlists once, lists them, and leaves one', async () => {
    const { app, venue, staff, classId, date, customer } = await classJourney(1);
    const ana = await customer();
    const bea = await customer();
    await call(app, 'POST', `/customer/classes/${classId}/enroll`, ana.token);
    const taken = await call(
      app,
      'POST',
      '/customer/reservations',
      ana.token,
      slot(venue.courts.padel, 5, '18:00'),
    );
    expect(taken.status).toBe(201);

    const classWait = await call(
      app,
      'POST',
      `/customer/classes/${classId}/waitlist`,
      bea.token,
    );
    expect(classWait.status).toBe(201);
    expect(classWait.body.data).toMatchObject({ type: 'CLASS', status: 'ACTIVE' });
    const courtInput = {
      courtId: venue.courts.padel,
      desiredDate: date,
      desiredStartTime: '18:00',
      durationMinutes: 60,
    };
    const courtWait = await call(
      app,
      'POST',
      '/customer/waitlists/court',
      bea.token,
      courtInput,
    );
    expect(courtWait.status).toBe(201);
    expect(courtWait.body.data).toMatchObject({
      type: 'COURT_SLOT',
      status: 'ACTIVE',
    });

    expect(
      (await call(app, 'POST', `/customer/classes/${classId}/waitlist`, bea.token))
        .status,
    ).toBe(409);
    expect(
      (
        await call(app, 'POST', '/customer/waitlists/court', bea.token, courtInput)
      ).status,
    ).toBe(409);
    // A free slot has nothing to wait for.
    expect(
      (
        await call(app, 'POST', '/customer/waitlists/court', bea.token, {
          ...courtInput,
          desiredStartTime: '20:00',
        })
      ).status,
    ).toBe(409);

    const mine = await call(app, 'GET', '/customer/waitlists', bea.token);
    expect(mine.body.data).toHaveLength(2);
    expect(
      (await call(app, 'GET', '/customer/waitlists', ana.token)).body.data,
    ).toEqual([]);

    const left = await call(
      app,
      'DELETE',
      `/customer/waitlists/${classWait.body.data.waitlistId}`,
      bea.token,
    );
    expect(left.status).toBe(200);
    expect(
      (await call(app, 'GET', '/customer/waitlists', bea.token)).body.data,
    ).toEqual([
      expect.objectContaining({ waitlistId: courtWait.body.data.waitlistId }),
    ]);
    const staffView = await call(app, 'GET', '/waitlists', staff);
    expect(staffView.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          waitlistId: courtWait.body.data.waitlistId,
          status: 'ACTIVE',
        }),
      ]),
    );
  });

  it('lets staff fulfill class and court waitlists into real bookings', async () => {
    const { app, venue, staff, classId, date, customer } = await classJourney(1);
    const ana = await customer();
    const bea = await customer();
    const enrolled = await call(
      app,
      'POST',
      `/customer/classes/${classId}/enroll`,
      ana.token,
    );
    const taken = await call(
      app,
      'POST',
      '/customer/reservations',
      ana.token,
      slot(venue.courts.padel, 5, '18:00'),
    );
    const classWait = await call(
      app,
      'POST',
      `/customer/classes/${classId}/waitlist`,
      bea.token,
    );
    const courtWait = await call(app, 'POST', '/customer/waitlists/court', bea.token, {
      courtId: venue.courts.padel,
      desiredDate: date,
      desiredStartTime: '18:00',
      durationMinutes: 60,
    });

    // Capacity frees up: Ana leaves the class and cancels her court.
    await call(app, 'POST', `/customer/classes/${classId}/leave`, ana.token);
    await call(
      app,
      'POST',
      `/customer/reservations/${taken.body.data.reservationId}/cancel`,
      ana.token,
    );
    expect(enrolled.status).toBe(201);

    const opportunities = await call(app, 'GET', '/waitlists', staff);
    expect(opportunities.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          waitlistId: classWait.body.data.waitlistId,
          actionable: true,
        }),
        expect.objectContaining({
          waitlistId: courtWait.body.data.waitlistId,
          actionable: true,
        }),
      ]),
    );

    const classFulfilled = await call(
      app,
      'POST',
      `/waitlists/${classWait.body.data.waitlistId}/fulfill`,
      staff,
    );
    expect(classFulfilled.status).toBe(200);
    expect(classFulfilled.body.data.waitlist).toMatchObject({
      status: 'FULFILLED',
      linkedEnrollmentId: expect.any(String),
    });
    const courtFulfilled = await call(
      app,
      'POST',
      `/waitlists/${courtWait.body.data.waitlistId}/fulfill`,
      staff,
    );
    expect(courtFulfilled.status).toBe(200);
    const reservationId = courtFulfilled.body.data.waitlist
      .linkedReservationId as string;
    expect(reservationId).toEqual(expect.any(String));

    // The customer now holds both, and the waitlists are kept as FULFILLED.
    const upcoming = await call(
      app,
      'GET',
      '/customer/reservations/upcoming',
      bea.token,
    );
    expect(upcoming.body.data.reservations).toEqual([
      expect.objectContaining({ reservationId, status: 'BOOKED' }),
    ]);
    const classes = await call(app, 'GET', '/customer/classes', bea.token);
    expect(
      (classes.body.data.data as { classId: string; enrollment: unknown }[]).find(
        (item) => item.classId === classId,
      )?.enrollment,
    ).toMatchObject({ status: 'ACTIVE' });
    const staffView = await call(app, 'GET', '/waitlists', staff);
    const statuses = Object.fromEntries(
      (staffView.body.data as { waitlistId: string; status: string }[]).map(
        (item) => [item.waitlistId, item.status],
      ),
    );
    expect(statuses).toMatchObject({
      [classWait.body.data.waitlistId]: 'FULFILLED',
      [courtWait.body.data.waitlistId]: 'FULFILLED',
    });
  });
});
