import { expect, test } from '@playwright/test';
import { dynamo } from '../../apps/api/src/db.js';
import { classFixture } from '../../apps/api/src/testing/class-fixture.js';
import { api, customerApi } from './support/api.js';
import { login, loginCustomer } from './support/auth.js';
import { findAvailability } from './support/booking.js';
import {
  PORTAL_PASSWORD,
  tokenFromLink,
  uniqueEmail,
  uniqueName,
  uniquePhone,
} from './support/identity.js';
import { useEnglish } from './support/locale.js';
import {
  addOwnerLogin,
  AUTO_CONFIRM_POLICY,
  createIsolatedVenue,
  futureDate,
  openingHours,
  REQUEST_APPROVAL_POLICY,
} from './support/venue.js';

test('staff-created reservation appears in the customer portal', async ({
  page,
}) => {
  await useEnglish(page);
  const venue = await createIsolatedVenue({
    prefix: 'handoff',
    bookingPolicy: AUTO_CONFIRM_POLICY,
  });
  await login(page, {
    email: venue.ownerEmail,
    password: venue.ownerPassword,
  });
  const name = uniqueName('Handoff Customer');
  const email = uniqueEmail('handoff');
  const created = await api(page, '/customers', {
    method: 'POST',
    body: JSON.stringify({
      name,
      email,
      phone: uniquePhone(),
    }),
  });
  const customerId = created.body.data.customerId as string;
  const start = new Date(Date.now() + 6 * 86400000);
  start.setUTCHours(18, 0, 0, 0);
  const reservation = await api(page, '/reservations', {
    method: 'POST',
    body: JSON.stringify({
      courtId: venue.court.courtId,
      customerId,
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 3600000).toISOString(),
    }),
  });
  expect(reservation.status).toBe(201);
  const enabled = await api(page, `/customers/${customerId}/portal-access`, {
    method: 'POST',
  });
  expect(enabled.status).toBe(200);
  const token = tokenFromLink(String(enabled.body.data.link));
  expect(token).toBeTruthy();
  await page.goto(`/portal/${venue.slug}/activate?token=${token}`);
  await page.getByLabel('Password').fill(PORTAL_PASSWORD);
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(page.locator('#portal-result')).toHaveText(/Password set/);
  await loginCustomer(page, venue.slug, email, PORTAL_PASSWORD);
  await page.getByRole('link', { name: 'Activities' }).click();
  await expect(page.getByText(venue.court.name)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Cancel reservation' }),
  ).toBeVisible();
});

test('nested portal URLs survive refresh and profile hides staff fields', async ({
  page,
}) => {
  await useEnglish(page);
  const venue = await createIsolatedVenue({
    prefix: 'refresh',
    bookingPolicy: AUTO_CONFIRM_POLICY,
  });
  const email = uniqueEmail('refresh');
  const name = uniqueName('Refresh Customer');
  await venue.services.customerAccounts.register(venue.slug, {
    name,
    email,
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  await loginCustomer(page, venue.slug, email, PORTAL_PASSWORD);
  for (const [path, heading] of [
    ['/book', 'Book a court'],
    ['/reservations', 'My activities'],
    ['/classes', 'Classes'],
    ['/profile', 'Profile'],
  ] as const) {
    await page.goto(`/portal/${venue.slug}${path}`);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }
  await page.goto(`/portal/${venue.slug}/profile`);
  await expect(page.locator('#portal-profile-form')).toBeVisible();
  await expect(page.getByLabel('Name')).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Phone')).toBeVisible();
  await expect(page.getByLabel('Notes')).toHaveCount(0);
  await expect(page.getByLabel('Tags')).toHaveCount(0);
  await page.getByLabel('Name').fill(`${name} Edited`);
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile updated.')).toBeVisible();
});

test('pending requests can be withdrawn and cutoff blocks late cancels', async ({
  page,
}) => {
  await useEnglish(page);
  const venue = await createIsolatedVenue({
    prefix: 'withdraw',
    bookingPolicy: REQUEST_APPROVAL_POLICY,
  });
  const email = uniqueEmail('withdraw');
  await venue.services.customerAccounts.register(venue.slug, {
    name: uniqueName('Withdraw'),
    email,
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  await loginCustomer(page, venue.slug, email, PORTAL_PASSWORD);
  await page.getByRole('link', { name: 'Book', exact: true }).click();
  await findAvailability(page, futureDate(6));
  await page.locator('input[name="slot"]').first().check();
  await page.getByRole('button', { name: 'Send booking request' }).click();
  await expect(page.locator('#portal-booking-result')).toHaveText(
    /Request sent\./,
  );
  await page.getByRole('link', { name: 'Activities' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Withdraw request' }).click();
  await expect(page.getByText('No pending booking requests.')).toBeVisible();

  const cutoffVenue = await createIsolatedVenue({
    prefix: 'cutoff',
    bookingPolicy: {
      ...AUTO_CONFIRM_POLICY,
      cancellationCutoffHours: 168,
    },
  });
  const cutoffEmail = uniqueEmail('cutoff');
  const cutoff = await cutoffVenue.services.customerAccounts.register(
    cutoffVenue.slug,
    {
      name: uniqueName('Cutoff'),
      email: cutoffEmail,
      phone: uniquePhone(),
      password: PORTAL_PASSWORD,
    },
  );
  const start = new Date(Date.now() + 24 * 3600000);
  start.setUTCMinutes(0, 0, 0);
  await cutoffVenue.services.reservations.create(cutoffVenue.owner, {
    courtId: cutoffVenue.court.courtId,
    customerId: cutoff.customer.customerId,
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + 3600000).toISOString(),
    source: 'STAFF',
  });
  await loginCustomer(page, cutoffVenue.slug, cutoffEmail, PORTAL_PASSWORD);
  await page.getByRole('link', { name: 'Activities' }).click();
  await expect(
    page.getByRole('button', { name: 'Cancel reservation' }),
  ).toHaveCount(0);
  await expect(page.getByText('Cancellation period has ended.')).toBeVisible();
});

test('book again skips an archived original court', async ({ page }) => {
  await useEnglish(page);
  const venue = await createIsolatedVenue({
    prefix: 'rebook-archive',
    bookingPolicy: AUTO_CONFIRM_POLICY,
    courts: [
      { name: 'Original Court', sport: 'Tennis' },
      { name: 'Replacement Court', sport: 'Tennis' },
    ],
  });
  const email = uniqueEmail('rebook-archive');
  const account = await venue.services.customerAccounts.register(venue.slug, {
    name: uniqueName('Rebook Archive'),
    email,
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  const previous = new Date(Date.now() - 8 * 86400000);
  previous.setUTCHours(10, 0, 0, 0);
  const reservation = await venue.services.reservations.create(venue.owner, {
    courtId: venue.courts[0]!.courtId,
    customerId: account.customer.customerId,
    startAt: previous.toISOString(),
    endAt: new Date(previous.getTime() + 3600000).toISOString(),
    source: 'STAFF',
  });
  await venue.services.reservations.transition(
    venue.owner,
    reservation.reservationId,
    'CHECKED_IN',
  );
  await venue.services.reservations.transition(
    venue.owner,
    reservation.reservationId,
    'COMPLETED',
  );
  await venue.services.courts.archive(venue.owner, venue.courts[0]!.courtId);
  await loginCustomer(page, venue.slug, email, PORTAL_PASSWORD);
  await page.getByRole('link', { name: 'Activities' }).click();
  await page.getByRole('link', { name: 'Book again' }).click();
  await expect(page.locator('#portal-booking-form')).toBeVisible();
  await expect(page.getByText('Replacement Court').first()).toBeVisible();
  await expect(page.getByText('Original Court')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Confirm booking' }),
  ).toBeVisible();
});

test('customer can join and leave a court waitlist and cannot join twice', async ({
  page,
}) => {
  await useEnglish(page);
  const venue = await createIsolatedVenue({
    prefix: 'court-wait',
    bookingPolicy: AUTO_CONFIRM_POLICY,
    courts: [
      {
        name: 'Wait Court',
        sport: 'Tennis',
        openingHours: openingHours('10:00', '11:00'),
      },
    ],
  });
  const email = uniqueEmail('court-wait');
  const account = await venue.services.customerAccounts.register(venue.slug, {
    name: uniqueName('Court Wait'),
    email,
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  const date = futureDate(5);
  await venue.services.reservations.create(venue.owner, {
    courtId: venue.court.courtId,
    customerId: account.customer.customerId,
    startAt: `${date}T10:00:00.000Z`,
    endAt: `${date}T11:00:00.000Z`,
    source: 'STAFF',
  });
  await loginCustomer(page, venue.slug, email, PORTAL_PASSWORD);
  await page.getByRole('link', { name: 'Book', exact: true }).click();
  await page.locator('input[name="desiredStartTime"]').fill('10:00');
  await findAvailability(page, date);
  await page.getByRole('button', { name: 'Join waitlist' }).click();
  await expect(page.locator('#portal-booking-result')).toHaveText(
    'Joined waitlist.',
  );
  await page.getByRole('button', { name: 'Join waitlist' }).click();
  await expect(page.locator('#portal-booking-result')).toHaveText(
    'This record already exists.',
  );
  await page.getByRole('link', { name: 'Waitlists' }).click();
  await expect(
    page.getByRole('button', { name: 'Leave waitlist' }),
  ).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Leave waitlist' }).click();
  await expect(page.getByText('No active waitlists.')).toBeVisible();
});

test('staff class waitlist fulfillment stays Fulfilled and customer tokens miss staff APIs', async ({
  page,
}) => {
  await useEnglish(page);
  const { services, owner, ctx, ctx2, classId, slug } =
    await classFixture(dynamo());
  await services.classes.enroll(owner, classId, ctx.customerId);
  const waitlist = await services.waitlists.joinClass(ctx2, { classId });
  await services.classes.leaveSelf(ctx, classId);
  const ownerLogin = await addOwnerLogin(
    owner.organizationId,
    owner.userId,
    `owner-${owner.organizationId}@phase2.test`,
  );
  await loginCustomer(page, slug, 'bea@example.test', 'class-password');
  const customers = await customerApi(page, `/customers/${ctx.customerId}`);
  expect(customers.status).toBe(401);
  const fulfill = await customerApi(
    page,
    `/waitlists/${waitlist.waitlistId}/fulfill`,
    { method: 'POST' },
  );
  expect(fulfill.status).toBe(401);
  await login(page, ownerLogin);
  await page.goto('/waitlists');
  await page.getByRole('button', { name: 'Enroll customer' }).click();
  await expect(page.getByText('Customer enrolled.')).toBeVisible();
  await expect(page.getByText('Fulfilled').first()).toBeVisible();
});
