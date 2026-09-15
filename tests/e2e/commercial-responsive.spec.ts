import { expect, test } from '@playwright/test';
import { login } from './support/auth.js';
import { createMonthlyClassPlan } from './support/commercial.js';
import {
  createIsolatedVenue,
  customerSignIn,
  seedVenue,
  useEnglish,
} from './support/venue.js';
test('mobile customer commercial portal remains usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const venue = await seedVenue('AUTO_CONFIRM');
  const customer = await venue.registerCustomer('Mobile Customer');
  const plan = await createMonthlyClassPlan(venue);
  await venue.services.memberships.create(venue.owner, {
    customerId: customer.customerId,
    planId: plan.planId,
    startDate: '2099-01-01',
  });
  await customerSignIn(page, venue.slug, customer.email);
  await page.goto(`/portal/${venue.slug}/memberships`);
  await expect(page.getByText('8 Classes / Month')).toBeVisible();
  const fitsViewport = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  expect(fitsViewport).toBe(true);
});

test('mobile staff commercial summary remains usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const venue = await createIsolatedVenue({ prefix: 'mobile-staff' });
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
  await expect(page.getByLabel('Customer')).toBeVisible();
});
