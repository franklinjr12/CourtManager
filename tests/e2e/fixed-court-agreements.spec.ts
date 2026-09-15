import { expect, test } from '@playwright/test';
import { login } from './support/auth.js';
import { createIsolatedVenue, useEnglish } from './support/venue.js';

test('staff can create and inspect a fixed recurring court agreement', async ({
  page,
}) => {
  const venue = await createIsolatedVenue({ prefix: 'fixed-court' });
  const customer = await venue.services.customers.create(venue.owner, {
    name: 'João Fixed',
    phone: `9${Date.now().toString().slice(-9)}`,
  });
  await useEnglish(page);
  await login(page, {
    email: venue.ownerEmail,
    password: venue.ownerPassword,
  });
  await page.goto('/commercial/fixed-courts');
  await expect(
    page.getByRole('heading', { name: 'Fixed court agreements' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add fixed court agreement' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Customer').selectOption(customer.customerId);
  await dialog.getByLabel('Court').selectOption({ index: 0 });
  await dialog.getByLabel('Weekday').selectOption('WEDNESDAY');
  await dialog.getByLabel('Start time').fill('19:00');
  await dialog.locator('input[name="startDate"]').fill('2027-01-06');
  await dialog.locator('input[name="endDate"]').fill('2027-01-20');
  await dialog.getByLabel('Price').fill('600');
  await dialog.getByRole('button', { name: 'Create agreement' }).click();
  await expect(page.getByText('Fixed court agreement created.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Details' })).toBeVisible();
  await page.getByRole('button', { name: 'Details' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText(/2027/)).toBeVisible();
});
