import { expect, test } from '@playwright/test';
import { dynamo } from '../../apps/api/src/db.js';
import { classFixture } from '../../apps/api/src/testing/class-fixture.js';
import { loginCustomer } from './support/auth.js';
import { useEnglish } from './support/locale.js';

test('customer discovers paid class, enrolls, leaves, and sees full-class waitlist action', async ({
  page,
}) => {
  const { services, owner, ctx2, classId, slug } = await classFixture(dynamo());
  await useEnglish(page);
  await loginCustomer(page, slug, 'ana@example.test', 'class-password');
  await page.getByRole('link', { name: 'Classes', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Customer Tennis' }),
  ).toBeVisible();
  await expect(
    page.getByText('0 / 1 enrolled', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText('Tennis · Coach Maria · Discovery Court'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deactivate' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Enroll', exact: true }).click();
  await expect(
    page.getByText('Enrollment confirmed.', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('1 / 1 enrolled', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Leave class' }).click();
  await expect(
    page.getByText('Enrollment cancelled.', { exact: true }),
  ).toBeVisible();
  await services.classes.enroll(owner, classId, ctx2.customerId);
  await page.reload();
  await page.getByRole('button', { name: 'Join waitlist' }).click();
  await expect(
    page.getByText('Joined waitlist.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Waitlists', exact: true }).click();
  await expect(page.getByText(`Class ${classId}`)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Enroll', exact: true }),
  ).toHaveCount(0);
});
