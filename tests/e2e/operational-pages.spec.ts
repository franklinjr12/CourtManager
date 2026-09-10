import { expect, test } from '@playwright/test';

import { login } from './support/auth.js';

test('owner operational screens expose workflows instead of placeholders', async ({
  page,
}) => {
  await login(page);
  await page.goto('/settings');
  await expect(
    page.getByText('Use the API or add courts through the settings workflow.'),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add court' })).toBeVisible();
  await page.goto('/customers');
  await expect(
    page.getByRole('button', { name: 'Add customer' }),
  ).toBeVisible();
  await page.goto('/reservations');
  await expect(
    page.getByRole('button', { name: 'New reservation' }),
  ).toBeVisible();
  await page.goto('/requests');
  await expect(
    page.getByRole('heading', { name: 'Reservation requests' }),
  ).toBeVisible();
  await page.goto('/finance');
  await expect(
    page.getByRole('button', { name: 'Record payment' }),
  ).toBeVisible();
  await page.goto('/classes');
  await expect(page.getByText(/Classes disabled|No classes yet/)).toBeVisible();
});
