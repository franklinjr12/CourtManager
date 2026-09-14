import { expect, it } from 'vitest';
import { dynamo, ensureTable } from '../db.js';
import { classFixture } from '../testing/class-fixture.js';
process.env.DYNAMODB_ENDPOINT = 'http://localhost:8120';
process.env.DYNAMODB_TABLE = 'court-manager-integration';
process.env.AWS_REGION = 'us-east-1';
it('DynamoDB serializes customer/staff enrollment and preserves financial cancellation', async () => {
  await ensureTable();
  const repo = dynamo();
  const { services, owner, ctx, ctx2, classId } = await classFixture(repo);
  const outcomes = await Promise.allSettled([
    services.classes.enrollSelf(ctx, classId),
    services.classes.enroll(owner, classId, ctx2.customerId),
  ]);
  expect(
    outcomes.filter((outcome) => outcome.status === 'fulfilled'),
  ).toHaveLength(1);
  const winner = outcomes[0]?.status === 'fulfilled' ? ctx : ctx2;
  expect(
    (await services.classes.customerClasses(winner)).data[0],
  ).toMatchObject({ enrolledCount: 1, full: true });
  await services.classes.leaveSelf(winner, classId);
  expect(
    (await services.classes.customerClasses(winner)).data[0],
  ).toMatchObject({ enrolledCount: 0, enrollment: { status: 'CANCELLED' } });
  expect(
    await repo.get({
      PK: `CHARGE#class-${classId}-2099-01-05-${winner.customerId}`,
      SK: 'META',
    }),
  ).toMatchObject({ status: 'VOID' });
});
