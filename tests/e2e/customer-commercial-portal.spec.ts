import { expect, test } from '@playwright/test';
import {
  customerSignIn,
  customerToken,
  seedVenue,
  useEnglish,
} from './support/venue.js';

test('customer can review membership usage, package credits, and entitlement history', async ({
  page,
}) => {
  const venue = await seedVenue('AUTO_CONFIRM');
  const customer = await venue.registerCustomer('Commercial customer');
  const otherCustomer = await venue.registerCustomer('Other customer');
  const plan = await venue.services.plans.create(venue.owner, {
    name: 'Eight classes / month',
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
  });
  const membership = await venue.services.memberships.create(venue.owner, {
    customerId: customer.customerId,
    planId: plan.planId,
    startDate: new Date().toISOString().slice(0, 10),
  });
  const definition = await venue.services.packages.createDefinition(
    venue.owner,
    {
      name: 'Ten court hours',
      price: 240,
      validityDays: 90,
      benefits: [
        {
          type: 'COURT_TIME',
          period: 'PACKAGE_LIFETIME',
          quantityType: 'FINITE',
          quantity: 600,
          unit: 'COURT_MINUTES',
        },
      ],
    },
  );
  const customerPackage = await venue.services.packages.issue(
    venue.owner,
    customer.customerId,
    { packageDefinitionId: definition.packageDefinitionId },
  );
  await venue.services.entitlements.consume({
    customer: {
      organizationId: venue.organizationId,
      customerId: customer.customerId,
    },
    activity: {
      activityType: 'RESERVATION',
      activityId: 'portal-reservation-1',
      quantity: 60,
      unit: 'COURT_MINUTES',
      occurredAt: new Date().toISOString(),
    },
    entitlement: (
      await venue.services.entitlements.getAvailableEntitlements(
        {
          organizationId: venue.organizationId,
          customerId: customer.customerId,
        },
        {
          activityType: 'RESERVATION',
          activityId: 'portal-reservation-1',
          quantity: 60,
          unit: 'COURT_MINUTES',
          occurredAt: new Date().toISOString(),
        },
      )
    )[0]!,
    coveredAmount: 80,
    currency: 'BRL',
    createdBy: venue.owner.userId,
  });
  const otherPackage = await venue.services.packages.issue(
    venue.owner,
    otherCustomer.customerId,
    { packageDefinitionId: definition.packageDefinitionId },
  );

  await customerSignIn(page, venue.slug, customer.email);
  await page.goto(`/portal/${venue.slug}/memberships`);
  await expect(
    page.getByRole('heading', { name: 'Memberships' }),
  ).toBeVisible();
  await expect(page.getByText('Eight classes / month')).toBeVisible();
  await expect(page.getByText('0 / 8')).toBeVisible();
  await page.getByRole('link', { name: 'View details' }).first().click();
  await expect(
    page.getByRole('heading', { name: 'Membership periods' }),
  ).toBeVisible();

  await page.goto(`/portal/${venue.slug}/credits`);
  await expect(page.getByRole('heading', { name: 'Credits' })).toBeVisible();
  await expect(page.getByText('Ten court hours')).toBeVisible();
  await expect(page.getByText('60 court minutes')).toBeVisible();
  await page.getByRole('link', { name: 'View details' }).first().click();
  await expect(
    page.getByRole('heading', { name: 'Credit history' }),
  ).toBeVisible();

  const token = await customerToken(venue.slug, customer.email);
  const forbiddenPackage = await fetch(
    `http://localhost:8787/customer/packages/${otherPackage.customerPackageId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(forbiddenPackage.status).toBe(404);
  await useEnglish(page);
  expect(membership.membershipId).toBeTruthy();
});
