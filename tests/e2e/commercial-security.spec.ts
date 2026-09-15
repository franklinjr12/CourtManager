import { expect, test } from '@playwright/test';
import { createMonthlyClassPlan } from './support/commercial.js';
import {
  customerSignIn,
  customerToken,
  seedVenue,
  useEnglish,
} from './support/venue.js';

test('customer A cannot read customer B commercial records in the portal', async ({
  page,
  browser,
}) => {
  const venue = await seedVenue('AUTO_CONFIRM');
  const customerA = await venue.registerCustomer('Customer A');
  const customerB = await venue.registerCustomer('Customer B');
  const plan = await createMonthlyClassPlan(venue);
  const membershipA = await venue.services.memberships.create(venue.owner, {
    customerId: customerA.customerId,
    planId: plan.planId,
    startDate: '2099-01-01',
  });
  const membershipB = await venue.services.memberships.create(venue.owner, {
    customerId: customerB.customerId,
    planId: plan.planId,
    startDate: '2099-01-01',
  });
  const definition = await venue.services.packages.createDefinition(
    venue.owner,
    {
      name: 'Package B',
      price: 100,
      validityDays: 30,
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
  const packageB = await venue.services.packages.issue(
    venue.owner,
    customerB.customerId,
    { packageDefinitionId: definition.packageDefinitionId },
  );

  const tokenA = await customerToken(venue.slug, customerA.email);
  const forbiddenMembership = await fetch(
    `http://localhost:8787/customer/memberships/${membershipB.membershipId}`,
    { headers: { Authorization: `Bearer ${tokenA}` } },
  );
  expect(forbiddenMembership.status).toBe(404);
  const forbiddenPackage = await fetch(
    `http://localhost:8787/customer/packages/${packageB.customerPackageId}`,
    { headers: { Authorization: `Bearer ${tokenA}` } },
  );
  expect(forbiddenPackage.status).toBe(404);

  await customerSignIn(page, venue.slug, customerA.email);
  await page.goto(
    `/portal/${venue.slug}/memberships/${membershipB.membershipId}`,
  );
  await expect(page.locator('#portal-membership-detail')).not.toContainText(
    'Customer B',
  );

  const contextB = await browser.newContext({
    baseURL: 'http://localhost:5173',
  });
  const pageB = await contextB.newPage();
  await customerSignIn(pageB, venue.slug, customerB.email);
  await pageB.goto(`/portal/${venue.slug}/memberships`);
  await expect(pageB.getByText('8 Classes / Month')).toBeVisible();
  await contextB.close();
  expect(membershipA.membershipId).toBeTruthy();
});
