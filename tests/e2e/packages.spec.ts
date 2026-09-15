import { expect, test } from '@playwright/test';
import { login } from './support/auth.js';
import { createIsolatedVenue, useEnglish } from './support/venue.js';

test('staff can define and issue a prepaid package', async ({ page }) => {
  test.setTimeout(60000);
  const venue = await createIsolatedVenue({ prefix: 'packages' });
  const customer = await venue.services.customers.create(venue.owner, {
    name: 'Maria Package',
    phone: `9${Date.now().toString().slice(-9)}`,
  });

  await useEnglish(page);
  const todayResponse = page.waitForResponse(
    (response) => response.url().endsWith('/today') && response.ok(),
    { timeout: 50000 },
  );
  await login(page, {
    email: venue.ownerEmail,
    password: venue.ownerPassword,
  });
  await todayResponse;
  await page.goto('/commercial/packages');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Packages & credits' }),
  ).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Add package' }).click();
  await page
    .getByRole('textbox', { name: 'Name', exact: true })
    .fill('10 Court Hours');
  await page
    .getByRole('spinbutton', { name: 'Price', exact: true })
    .fill('700');
  await page.getByRole('spinbutton', { name: 'Validity (days)' }).fill('90');
  await page
    .locator('[data-package-benefit] [data-field="quantity"]')
    .fill('600');
  await page.getByRole('button', { name: 'Create package' }).click();
  await expect(page.getByText('10 Court Hours')).toBeVisible({
    timeout: 15000,
  });
  await page.locator('#issue-package').click();
  const issueForm = page.locator('#issue-package-form');
  await expect(issueForm).toBeVisible();
  await issueForm
    .locator('select[name="customerId"]')
    .selectOption(customer.customerId);
  await issueForm
    .locator('input[name="idempotencyKey"]')
    .fill(`package-sale-${Date.now()}`);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes(`/customers/${customer.customerId}/packages`) &&
        response.request().method() === 'POST' &&
        response.ok(),
    ),
    issueForm.locator('button.primary').click(),
  ]);
  await expect(page.locator('#customer-packages')).toContainText(
    '10 Court Hours',
    { timeout: 15000 },
  );
});
