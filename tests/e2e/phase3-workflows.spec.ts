import { expect, test } from '@playwright/test';
import {
  customerSignIn,
  futureDate,
  seedVenue,
  selectFirstSlot,
} from './support/venue.js';

async function consumeClassCredit(
  venue: Awaited<ReturnType<typeof seedVenue>>,
  customerId: string,
  activityId: string,
  day: number,
) {
  const occurredAt = `2099-01-${String(day).padStart(2, '0')}T10:00:00.000Z`;
  const activity = {
    activityType: 'CLASS_ATTENDANCE' as const,
    activityId,
    quantity: 1,
    unit: 'SESSION' as const,
    occurredAt,
    venueDate: occurredAt.slice(0, 10),
    classId: 'phase3-membership-class',
    classType: 'GROUP' as const,
    coveredAmount: 35,
    currency: 'BRL',
  };
  const entitlements =
    await venue.services.entitlements.getAvailableEntitlements(
      { organizationId: venue.organizationId, customerId },
      activity,
    );
  expect(entitlements).toHaveLength(1);
  await venue.services.entitlements.consume({
    customer: { organizationId: venue.organizationId, customerId },
    activity,
    entitlement: entitlements[0],
    coveredAmount: 35,
    currency: 'BRL',
    createdBy: venue.owner.userId,
  });
}

test('customer portal shows class membership usage, renewal reset, and prior-period history', async ({
  page,
}) => {
  const venue = await seedVenue('AUTO_CONFIRM');
  const customer = await venue.registerCustomer('Carlos Membership');
  const plan = await venue.services.plans.create(venue.owner, {
    name: '8 Classes / Month',
    basePrice: 280,
    benefits: [
      {
        benefitId: 'portal-monthly-classes',
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
    startDate: '2099-01-01',
  });
  for (let day = 5; day <= 11; day += 1)
    await consumeClassCredit(
      venue,
      customer.customerId,
      `portal-attendance-${day}`,
      day,
    );

  await customerSignIn(page, venue.slug, customer.email);
  await page.goto(`/portal/${venue.slug}/memberships`);
  await expect(page.getByText('7 / 8', { exact: false })).toBeVisible();

  await consumeClassCredit(
    venue,
    customer.customerId,
    'portal-attendance-12',
    12,
  );
  await page.reload();
  await expect(page.getByText('8 / 8', { exact: false })).toBeVisible();

  await venue.services.memberships.renew(venue.owner, membership.membershipId, {
    idempotencyKey: 'portal-renewal-1',
  });
  await page.reload();
  await expect(page.getByText('0 / 8', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'View details' }).click();
  await expect(
    page.getByRole('heading', { name: 'Membership periods' }),
  ).toBeVisible();
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
});

test('customer booking consumes package time and cancellation restores it in the portal', async ({
  page,
}) => {
  const venue = await seedVenue('AUTO_CONFIRM');
  const customer = await venue.registerCustomer('Maria Court Hours');
  const definition = await venue.services.packages.createDefinition(
    venue.owner,
    {
      name: 'Two Court Hours',
      price: 160,
      validityDays: 90,
      benefits: [
        {
          benefitId: 'portal-court-minutes',
          type: 'COURT_TIME',
          period: 'PACKAGE_LIFETIME',
          quantityType: 'FINITE',
          quantity: 120,
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

  await customerSignIn(page, venue.slug, customer.email);
  const date = futureDate(7);
  await selectFirstSlot(page, venue.slug, date);
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(
    page.getByText('Reservation confirmed.', { exact: true }),
  ).toBeVisible();

  await page.goto(`/portal/${venue.slug}/credits`);
  await expect(
    page.getByText('60 court minutes', { exact: false }).first(),
  ).toBeVisible();
  await page.goto(`/portal/${venue.slug}/reservations`);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Cancel reservation' }).click();
  await expect(
    page.getByText('No upcoming reservations.', { exact: true }),
  ).toBeVisible();

  await page.goto(`/portal/${venue.slug}/credits`);
  await expect(
    page.getByText('120 court minutes', { exact: false }).first(),
  ).toBeVisible();
  const balance = await venue.services.entitlements.getRemainingBalance({
    organizationId: venue.organizationId,
    customerId: customer.customerId,
    sourceType: 'PACKAGE',
    sourceId: customerPackage.customerPackageId,
    benefitId: 'portal-court-minutes',
  });
  expect(balance).toMatchObject({
    remainingQuantity: 120,
    restoredQuantity: 60,
  });
});
