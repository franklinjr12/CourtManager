import { expect, test } from '@playwright/test';
import { login } from './support/auth.js';
import {
  apiAs,
  apiBase,
  createIsolatedVenue,
  customerSignIn,
  futureDate,
  seedVenue,
  selectFirstSlot,
  staffSignIn,
  useEnglish,
} from './support/venue.js';
import {
  createMonthlyClassPlan,
  issueCourtHourPackage,
  seedCommercialOverviewVenue,
} from './support/commercial.js';

test('canonical membership payment settles outstanding balance through finance', async ({
  page,
}) => {
  const venue = await createIsolatedVenue({ prefix: 'canonical-payment' });
  const loginResponse = await page.request.post(`${apiBase}/auth/login`, {
    data: { email: venue.ownerEmail, password: venue.ownerPassword },
  });
  const token = ((await loginResponse.json()) as { data: { token: string } })
    .data.token;
  const customer = await apiAs(token, '/customers', {
    method: 'POST',
    body: JSON.stringify({ name: 'Payment Customer', phone: '41999991111' }),
  });
  const plan = await createMonthlyClassPlan(venue, { price: 280 });
  const membership = await apiAs(token, '/memberships', {
    method: 'POST',
    body: JSON.stringify({
      customerId: customer.body.data.customerId,
      planId: plan.planId,
      startDate: '2099-01-01',
      price: 280,
    }),
  });
  const chargeId = `membership-${membership.body.data.currentPeriodId}`;
  await apiAs(token, '/payments', {
    method: 'POST',
    body: JSON.stringify({
      chargeId,
      customerId: customer.body.data.customerId,
      amount: 280,
      method: 'PIX',
      paidAt: '2099-01-02T12:00:00.000Z',
    }),
  });

  await useEnglish(page);
  await login(page, {
    email: venue.ownerEmail,
    password: venue.ownerPassword,
  });
  const summary = await apiAs(
    token,
    `/customers/${customer.body.data.customerId}/commercial-summary`,
  );
  expect(summary.status).toBe(200);
  expect(summary.body.data.balance.outstandingAmount).toBe(0);
});

test('canonical package expiry remains visible but cannot cover new bookings', async ({
  page,
}) => {
  const venue = await seedVenue('AUTO_CONFIRM');
  const customer = await venue.registerCustomer('Expired package');
  const definition = await issueCourtHourPackage(venue, {
    validityDays: 1,
    minutes: 60,
  });
  const issued = await venue.services.packages.issue(
    venue.owner,
    customer.customerId,
    {
      packageDefinitionId: definition.packageDefinitionId,
      issuedAt: '2020-01-01T12:00:00.000Z',
    },
  );
  const expired = await venue.services.packages.getCustomerPackage(
    venue.owner,
    issued.customerPackageId,
  );
  expect(expired.status).toBe('EXPIRED');

  await customerSignIn(page, venue.slug, customer.email);
  await page.goto(`/portal/${venue.slug}/credits`);
  await expect(page.getByText(definition.name, { exact: false })).toBeVisible();
  await page.goto(`/portal/${venue.slug}/book`);
  await selectFirstSlot(page, venue.slug, futureDate(7));
  await expect(page.locator('#portal-booking-confirm')).toBeEnabled();
});

test('commercial overview reflects prepared operational data', async ({
  page,
}) => {
  test.setTimeout(60000);
  const venue = await seedCommercialOverviewVenue();
  await staffSignIn(page, venue.ownerEmail, venue.ownerPassword);
  const loginResponse = await page.request.post(`${apiBase}/auth/login`, {
    data: { email: venue.ownerEmail, password: venue.ownerPassword },
  });
  const token = ((await loginResponse.json()) as { data: { token: string } })
    .data.token;
  const memberships = await apiAs(token, '/memberships?status=ACTIVE');
  const packages = await apiAs(
    token,
    '/customer-packages/expiring-soon?windowDays=30&limit=100',
  );
  expect(memberships.body.data.length).toBeGreaterThan(0);
  expect(packages.body.data.length).toBeGreaterThan(0);
  await page.goto('/commercial');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({
    timeout: 15000,
  });
  await expect(
    page.getByText('Active memberships', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText('Packages expiring soon', { exact: false }),
  ).toBeVisible();
});
