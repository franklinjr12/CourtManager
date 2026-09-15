import { expect, test } from '@playwright/test';
import { login } from './support/auth.js';
import {
  apiAs,
  apiBase,
  createIsolatedVenue,
  useEnglish,
} from './support/venue.js';

test('staff can assign and pause a customer membership', async ({ page }) => {
  const venue = await createIsolatedVenue({ prefix: 'membership' });
  const loginResponse = await page.request.post(`${apiBase}/auth/login`, {
    data: { email: venue.ownerEmail, password: venue.ownerPassword },
  });
  const loginBody = (await loginResponse.json()) as { data: { token: string } };
  const token = loginBody.data.token;
  const customer = await apiAs(token, '/customers', {
    method: 'POST',
    body: JSON.stringify({ name: 'Membership Customer', phone: '41999990000' }),
  });
  const plan = await apiAs(token, '/plans', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Monthly classes',
      basePrice: 280,
      benefits: [
        {
          type: 'CLASS_ATTENDANCE',
          period: 'MONTH',
          quantityType: 'FINITE',
          quantity: 8,
          unit: 'SESSION',
        },
      ],
    }),
  });
  const customerId = customer.body.data.customerId as string;
  const planId = plan.body.data.planId as string;

  await useEnglish(page);
  await login(page, {
    email: venue.ownerEmail,
    password: venue.ownerPassword,
  });
  await page.goto('/commercial/memberships');
  await expect(
    page.getByRole('heading', { name: 'Memberships' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add membership' }).click();
  await page.getByLabel('Customer').selectOption(customerId);
  await page.getByLabel('Plan').selectOption(planId);
  await page.getByLabel('Price').fill('270');
  await page.getByRole('button', { name: 'Create membership' }).click();
  await expect(page.getByText('Membership Customer')).toBeVisible();
  await expect(page.getByText('Monthly classes')).toBeVisible();
  const initialCharges = await apiAs(token, '/charges?sourceType=MEMBERSHIP');
  expect(initialCharges.status).toBe(200);
  expect(initialCharges.body.data).toHaveLength(1);
  expect(initialCharges.body.data[0]).toMatchObject({
    sourceType: 'MEMBERSHIP',
    amount: 270,
    outstanding: 270,
  });
  const renewResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/memberships/') &&
      response.url().endsWith('/renew'),
  );
  await page.getByRole('button', { name: 'Renew' }).click();
  const renewResult = await renewResponse;
  expect(renewResult.status(), await renewResult.text()).toBe(200);
  const chargesAfterRenewal = await apiAs(
    token,
    '/charges?sourceType=MEMBERSHIP',
  );
  expect(chargesAfterRenewal.body.data).toHaveLength(2);
  expect(
    chargesAfterRenewal.body.data.map((charge: { amount: number }) =>
      Number(charge.amount),
    ),
  ).toEqual(expect.arrayContaining([270, 270]));
  const pauseResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/memberships/') &&
      response.url().endsWith('/pause'),
  );
  await page.getByRole('button', { name: 'Pause' }).click();
  const pauseResult = await pauseResponse;
  expect(pauseResult.status(), await pauseResult.text()).toBe(200);
  await page.reload();
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
});
