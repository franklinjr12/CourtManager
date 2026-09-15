import { expect, test } from '@playwright/test';
import { login } from './support/auth.js';
import {
  apiAs,
  apiBase,
  createIsolatedVenue,
  useEnglish,
} from './support/venue.js';

test('invalid commercial forms show validation feedback', async ({ page }) => {
  const venue = await createIsolatedVenue({ prefix: 'validation' });
  const loginResponse = await page.request.post(`${apiBase}/auth/login`, {
    data: { email: venue.ownerEmail, password: venue.ownerPassword },
  });
  const token = ((await loginResponse.json()) as { data: { token: string } })
    .data.token;

  await useEnglish(page);
  await login(page, {
    email: venue.ownerEmail,
    password: venue.ownerPassword,
  });
  await page.goto('/commercial/plans');
  await page.getByRole('button', { name: 'Add plan' }).click();
  await page.getByLabel('Price').fill('-10');
  await page.getByRole('button', { name: 'Create plan' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  const invalidMembership = await apiAs(token, '/memberships', {
    method: 'POST',
    body: JSON.stringify({
      customerId: 'missing-customer',
      planId: 'missing-plan',
      startDate: '2099-01-01',
    }),
  });
  expect(invalidMembership.status).toBeGreaterThanOrEqual(400);
});

test('rapid duplicate renew clicks do not create extra membership periods', async ({
  page,
}) => {
  const venue = await createIsolatedVenue({ prefix: 'duplicate-renew' });
  const loginResponse = await page.request.post(`${apiBase}/auth/login`, {
    data: { email: venue.ownerEmail, password: venue.ownerPassword },
  });
  const token = ((await loginResponse.json()) as { data: { token: string } })
    .data.token;
  const customer = await apiAs(token, '/customers', {
    method: 'POST',
    body: JSON.stringify({ name: 'Renew Customer', phone: '41999992222' }),
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
  const membership = await apiAs(token, '/memberships', {
    method: 'POST',
    body: JSON.stringify({
      customerId: customer.body.data.customerId,
      planId: plan.body.data.planId,
      startDate: '2020-01-01',
    }),
  });
  const membershipId = membership.body.data.membershipId as string;
  const idempotencyKey = `renew-${membershipId}`;
  await fetch(`${apiBase}/memberships/${membershipId}/renew`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ idempotencyKey }),
  });
  await Promise.all([
    fetch(`${apiBase}/memberships/${membershipId}/renew`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ idempotencyKey }),
    }),
    fetch(`${apiBase}/memberships/${membershipId}/renew`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ idempotencyKey }),
    }),
  ]);
  const charges = await apiAs(token, '/charges?sourceType=MEMBERSHIP');
  expect(charges.body.data.length).toBeGreaterThanOrEqual(2);
  expect(charges.body.data.length).toBeLessThanOrEqual(2);
});
