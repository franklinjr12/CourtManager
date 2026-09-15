import { expect, test } from '@playwright/test';
import { login } from './support/auth.js';
import { createIsolatedVenue, useEnglish } from './support/venue.js';

test('staff can create and review a commercial plan with multiple benefits', async ({
  page,
}) => {
  const venue = await createIsolatedVenue({ prefix: 'commercial-plans' });
  const planName = `Plano E2E ${Date.now()}`;
  await useEnglish(page);
  await login(page, {
    email: venue.ownerEmail,
    password: venue.ownerPassword,
  });
  await page.goto('/commercial/plans');
  await expect(page.getByRole('heading', { name: 'Plans' })).toBeVisible();
  await page.getByRole('button', { name: 'Add plan' }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(planName);
  await page
    .getByRole('spinbutton', { name: 'Price', exact: true })
    .fill('280');
  await expect(page.getByRole('heading', { name: 'Benefits' })).toBeVisible();
  await page
    .locator('[data-benefit-row]')
    .first()
    .locator('[data-benefit-field="quantity"]')
    .fill('240');
  await page.getByRole('button', { name: 'Add benefit' }).click();
  await expect(page.locator('[data-benefit-row]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Create plan' }).click();
  await expect(page.locator('table tbody').getByText(planName)).toBeVisible();
  await expect(page.getByText('240 court minutes')).toBeVisible();
});
