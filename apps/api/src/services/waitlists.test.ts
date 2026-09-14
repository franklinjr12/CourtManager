import type { Court } from '@court-manager/contracts';
import { expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { MemoryRepository } from '../db.js';
import { classFixture } from '../testing/class-fixture.js';

it('joins, lists, and leaves court/class waitlists without scans or fulfillment', async () => {
  const repo = new MemoryRepository();
  const { services, owner, ctx, ctx2, classId } = await classFixture(repo);
  const cls = await repo.get({ PK: `CLASS#${classId}`, SK: 'META' });
  const court = (await services.courts.update(owner, String(cls?.courtId), {
    publiclyRequestable: true,
  })) as Court;
  const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const startAt = `${date}T10:00:00-03:00`;
  const endAt = `${date}T11:00:00-03:00`;
  await services.schedule.occupy(
    owner,
    court,
    startAt,
    endAt,
    'RESERVATION',
    'existing-booking',
  );
  await services.classes.enroll(owner, classId, ctx.customerId);
  const scan = vi
    .spyOn(repo, 'scan')
    .mockRejectedValue(new Error('Waitlist reads must use indexes.'));

  const courtWaitlist = await services.waitlists.joinCourt(ctx2, {
    courtId: court.courtId,
    desiredDate: date,
    desiredStartTime: '10:00',
    durationMinutes: 60,
  });
  const classWaitlist = await services.waitlists.joinClass(ctx2, { classId });
  expect(courtWaitlist).toMatchObject({
    type: 'COURT_SLOT',
    status: 'ACTIVE',
    customerId: ctx2.customerId,
    desiredDate: date,
  });
  expect(classWaitlist).toMatchObject({
    type: 'CLASS',
    status: 'ACTIVE',
    classId,
    customerId: ctx2.customerId,
  });
  expect(await services.waitlists.list(ctx)).toEqual([]);
  expect(await services.waitlists.list(ctx2)).toHaveLength(2);
  await expect(
    services.waitlists.joinClass(ctx2, { classId }),
  ).rejects.toMatchObject({ code: 'DUPLICATE' });
  await expect(
    services.waitlists.joinCourt(ctx2, {
      courtId: court.courtId,
      desiredDate: date,
      desiredStartTime: '10:00',
      durationMinutes: 60,
    }),
  ).rejects.toMatchObject({ code: 'DUPLICATE' });

  await services.waitlists.leave(ctx2, classWaitlist.waitlistId);
  await services.waitlists.leave(ctx2, courtWaitlist.waitlistId);
  expect(await services.waitlists.list(ctx2)).toEqual([]);
  expect(
    await repo.get({ PK: `WAITLIST#${classWaitlist.waitlistId}`, SK: 'META' }),
  ).toMatchObject({ status: 'CANCELLED' });
  expect(
    (await services.classes.customerClasses(ctx2)).data[0]?.enrollment,
  ).toBeNull();
  expect(scan).not.toHaveBeenCalled();
});

it('rejects court waitlist requests for available or private slots', async () => {
  const repo = new MemoryRepository();
  const { services, owner, ctx, classId } = await classFixture(repo);
  const cls = await repo.get({ PK: `CLASS#${classId}`, SK: 'META' });
  const court = (await services.courts.update(owner, String(cls?.courtId), {
    publiclyRequestable: true,
  })) as Court;
  const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  await expect(
    services.waitlists.joinCourt(ctx, {
      courtId: court.courtId,
      desiredDate: date,
      desiredStartTime: '12:00',
      durationMinutes: 60,
    }),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  await services.courts.update(owner, court.courtId, {
    publiclyRequestable: false,
  });
  await expect(
    services.waitlists.joinCourt(ctx, {
      courtId: court.courtId,
      desiredDate: date,
      desiredStartTime: '12:00',
      durationMinutes: 60,
    }),
  ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
});

it('lists actionable court demand and atomically fulfills it into a reservation', async () => {
  const repo = new MemoryRepository();
  const { services, owner, ctx2, classId } = await classFixture(repo);
  const cls = await repo.get({ PK: `CLASS#${classId}`, SK: 'META' });
  const court = await services.courts.update(owner, String(cls?.courtId), {
    publiclyRequestable: true,
  });
  const date = new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10);
  const reservation = await services.reservations.create(owner, {
    courtId: String(court.courtId),
    customerId: ctx2.customerId,
    startAt: `${date}T10:00:00-03:00`,
    endAt: `${date}T11:00:00-03:00`,
  });
  const waitlist = await services.waitlists.joinCourt(ctx2, {
    courtId: String(court.courtId),
    desiredDate: date,
    desiredStartTime: '10:00',
    durationMinutes: 60,
  });
  await services.reservations.transition(
    owner,
    String(reservation.reservationId),
    'CANCELLED',
  );
  const listed = await services.waitlists.staffList(owner);
  expect(listed).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        waitlistId: waitlist.waitlistId,
        customerName: 'Bea',
        actionable: true,
        currentAvailability: { available: true },
      }),
    ]),
  );
  const fulfilled = await services.waitlists.fulfill(
    owner,
    waitlist.waitlistId,
  );
  expect(fulfilled.waitlist).toMatchObject({
    status: 'FULFILLED',
    linkedReservationId: expect.any(String),
    fulfilledBy: owner.userId,
  });
  const linked = await repo.get({
    PK: `RESERVATION#${fulfilled.waitlist.linkedReservationId}`,
    SK: 'META',
  });
  expect(linked).toMatchObject({
    customerId: ctx2.customerId,
    courtId: court.courtId,
    status: 'BOOKED',
  });
  expect(
    await repo.get({
      PK: `WAITLIST#${waitlist.waitlistId}`,
      SK: 'META',
    }),
  ).toMatchObject({ status: 'FULFILLED' });
});

it('fulfills class demand through shared enrollment and keeps capacity race safe', async () => {
  const repo = new MemoryRepository();
  const { services, owner, ctx, ctx2, classId } = await classFixture(repo);
  const existing = await services.classes.enroll(
    owner,
    classId,
    ctx.customerId,
  );
  const waitlist = await services.waitlists.joinClass(ctx2, { classId });
  await services.classes.cancelEnrollment(
    owner,
    classId,
    existing.enrollmentId,
  );
  const listed = await services.waitlists.staffList(owner);
  expect(listed).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        waitlistId: waitlist.waitlistId,
        actionable: true,
        currentAvailability: { enrolledCount: 0, capacity: 1 },
      }),
    ]),
  );
  const fulfilled = await services.waitlists.fulfill(
    owner,
    waitlist.waitlistId,
  );
  const enrollment = (fulfilled as { enrollment: { enrollmentId: string } })
    .enrollment;
  expect(fulfilled.waitlist).toMatchObject({
    status: 'FULFILLED',
    linkedEnrollmentId: enrollment.enrollmentId,
  });
  expect(enrollment).toMatchObject({
    customerId: ctx2.customerId,
    classId,
  });
  await expect(
    services.waitlists.fulfill(owner, waitlist.waitlistId),
  ).resolves.toMatchObject({ waitlist: { status: 'FULFILLED' } });
});

it('returns conflict when a court opportunity is taken before fulfillment and expires without deleting history', async () => {
  const repo = new MemoryRepository();
  const { services, owner, ctx, ctx2, classId } = await classFixture(repo);
  const cls = await repo.get({ PK: `CLASS#${classId}`, SK: 'META' });
  const court = await services.courts.update(owner, String(cls?.courtId), {
    publiclyRequestable: true,
  });
  const date = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
  const existing = await services.reservations.create(owner, {
    courtId: String(court.courtId),
    customerId: ctx.customerId,
    startAt: `${date}T10:00:00-03:00`,
    endAt: `${date}T11:00:00-03:00`,
  });
  const waitlist = await services.waitlists.joinCourt(ctx2, {
    courtId: String(court.courtId),
    desiredDate: date,
    desiredStartTime: '10:00',
    durationMinutes: 60,
  });
  await services.reservations.transition(
    owner,
    String(existing.reservationId),
    'CANCELLED',
  );
  await services.reservations.create(owner, {
    courtId: String(court.courtId),
    customerId: ctx.customerId,
    startAt: `${date}T10:00:00-03:00`,
    endAt: `${date}T11:00:00-03:00`,
  });
  await expect(
    services.waitlists.fulfill(owner, waitlist.waitlistId),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  const expired = await services.waitlists.expire(owner, waitlist.waitlistId);
  expect(expired).toMatchObject({ status: 'EXPIRED' });
  expect(
    await repo.get({ PK: `WAITLIST#${waitlist.waitlistId}`, SK: 'META' }),
  ).toMatchObject({ status: 'EXPIRED' });
});

it('hides another customer waitlist from HTTP leave and list', async () => {
  const repo = new MemoryRepository();
  const { services, owner, ctx, ctx2, classId, slug } =
    await classFixture(repo);
  await services.classes.enroll(owner, classId, ctx.customerId);
  const waitlist = await services.waitlists.joinClass(ctx2, { classId });
  const app = createApp(repo);
  const login = await app.request('/customer-auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug,
      email: 'ana@example.test',
      password: 'class-password',
    }),
  });
  const token = ((await login.json()) as { data: { token: string } }).data
    .token;
  const headers = { Authorization: `Bearer ${token}` };
  expect(
    (
      await app.request(`/customer/waitlists/${waitlist.waitlistId}`, {
        method: 'DELETE',
        headers,
      })
    ).status,
  ).toBe(404);
  const listed = await app.request('/customer/waitlists', { headers });
  expect(listed.status).toBe(200);
  expect(
    ((await listed.json()) as { data: Array<{ waitlistId: string }> }).data,
  ).toEqual([]);
});
