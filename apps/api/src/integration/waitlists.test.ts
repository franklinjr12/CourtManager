import type { Court } from '@court-manager/contracts';
import { expect, it } from 'vitest';
import { dynamo } from '../db.js';
import { classFixture } from '../testing/class-fixture.js';

it('uses DynamoDB customer/resource partitions for durable waitlists', async () => {
  const repo = dynamo();
  const { services, owner, ctx, ctx2, classId } = await classFixture(repo);
  const cls = await repo.get({ PK: `CLASS#${classId}`, SK: 'META' });
  const court = (await services.courts.update(owner, String(cls?.courtId), {
    publiclyRequestable: true,
  })) as Court;
  const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  await services.schedule.occupy(
    owner,
    court,
    `${date}T10:00:00-03:00`,
    `${date}T11:00:00-03:00`,
    'RESERVATION',
    'dynamo-waitlist-booking',
  );
  await services.classes.enroll(owner, classId, ctx.customerId);
  const courtWaitlist = await services.waitlists.joinCourt(ctx2, {
    courtId: court.courtId,
    desiredDate: date,
    desiredStartTime: '10:00',
    durationMinutes: 60,
  });
  const classWaitlist = await services.waitlists.joinClass(ctx2, { classId });
  expect(await services.waitlists.list(ctx2)).toHaveLength(2);
  await services.waitlists.leave(ctx2, courtWaitlist.waitlistId);
  await services.waitlists.leave(ctx2, classWaitlist.waitlistId);
  expect(
    await repo.get({ PK: `WAITLIST#${courtWaitlist.waitlistId}`, SK: 'META' }),
  ).toMatchObject({ status: 'CANCELLED' });
  expect(await services.waitlists.list(ctx2)).toEqual([]);
});
