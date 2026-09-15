import { expect, test } from '@playwright/test';
import { login } from './support/auth.js';
import {
  apiAs,
  apiBase,
  createIsolatedVenue,
  useEnglish,
} from './support/venue.js';

test('staff customer profile separates commercial entitlements from financial balance', async ({
  page,
}) => {
  const venue = await createIsolatedVenue({ prefix: 'customer-balance' });
  const loginResponse = await page.request.post(`${apiBase}/auth/login`, {
    data: { email: venue.ownerEmail, password: venue.ownerPassword },
  });
  const loginBody = (await loginResponse.json()) as { data: { token: string } };
  const token = loginBody.data.token;
  const customer = await apiAs(token, '/customers', {
    method: 'POST',
    body: JSON.stringify({ name: 'Balance Customer', phone: '41999990000' }),
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
  await apiAs(token, '/memberships', {
    method: 'POST',
    body: JSON.stringify({
      customerId,
      planId: plan.body.data.planId,
      startDate: '2026-09-01',
    }),
  });

  await useEnglish(page);
  await login(page, {
    email: venue.ownerEmail,
    password: venue.ownerPassword,
  });
  await page.goto(`/customers/${customerId}`);
  await expect(
    page.getByRole('heading', { name: 'Commercial', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Entitlements' }),
  ).toBeVisible();
  await expect(page.getByText('Class credits', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Financial' })).toBeVisible();
  await expect(page.getByText('Charges', { exact: true })).toBeVisible();
  await expect(page.getByText('Payments', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Outstanding', { exact: true }).last(),
  ).toBeVisible();

  await page.goto('/customers');
  const customerRow = page.getByRole('row').filter({
    hasText: 'Balance Customer',
  });
  await customerRow.getByRole('button', { name: 'History' }).click();
  await expect(
    page.getByRole('heading', { name: 'Commercial history' }),
  ).toBeVisible();
  await expect(
    page.getByText('Membership started', { exact: true }),
  ).toBeVisible();
});
