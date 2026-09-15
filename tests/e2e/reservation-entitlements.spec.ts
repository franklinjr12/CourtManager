import { expect, test } from '@playwright/test';

import { login } from './support/auth.js';
import { createIsolatedVenue, useEnglish } from './support/venue.js';

test('reservation details show package court-time coverage', async ({
  page,
}) => {
  test.setTimeout(60000);
  const venue = await createIsolatedVenue({
    prefix: 'reservation-entitlements',
  });
  const customer = await venue.services.customers.create(venue.owner, {
    name: 'Covered Customer',
    phone: `9${Date.now().toString().slice(-9)}`,
  });
  const definition = await venue.services.packages.createDefinition(
    venue.owner,
    {
      name: 'Court minutes',
      price: 240,
      validityDays: 90,
      benefits: [
        {
          type: 'COURT_TIME',
          period: 'PACKAGE_LIFETIME',
          quantityType: 'FINITE',
          quantity: 60,
          unit: 'COURT_MINUTES',
        },
      ],
    },
  );
  const customerPackage = await venue.services.packages.issue(
    venue.owner,
    String(customer.customerId),
    {
      packageDefinitionId: definition.packageDefinitionId,
      idempotencyKey: `e2e-${Date.now()}`,
    },
  );
  const date = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const reservation = await venue.services.reservations.create(venue.owner, {
    courtId: venue.court.courtId,
    customerId: customer.customerId,
    startAt: `${date}T18:00:00.000Z`,
    endAt: `${date}T19:00:00.000Z`,
    expectedAmount: 80,
    source: 'STAFF',
  });

  await useEnglish(page);
  await login(page, {
    email: venue.ownerEmail,
    password: venue.ownerPassword,
  });
  await page.goto('/reservations');
  const row = page.getByRole('row').filter({ hasText: 'Covered Customer' });
  await row.getByRole('button', { name: 'Open' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Covered by');
  await expect(dialog).toContainText(customerPackage.customerPackageId);
  await expect(dialog).toContainText('60 minutes');
  expect(reservation.expectedAmount).toBe(0);
});
