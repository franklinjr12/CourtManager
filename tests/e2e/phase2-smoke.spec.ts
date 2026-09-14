import { expect, test } from '@playwright/test';
import { dynamo } from '../../apps/api/src/db.js';
import { classFixture } from '../../apps/api/src/testing/class-fixture.js';
import { api, customerApi } from './support/api.js';
import { login, loginCustomer, registerCustomer } from './support/auth.js';
import { findAvailability, selectFirstSlot } from './support/booking.js';
import {
  PORTAL_PASSWORD,
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
  REQUEST_APPROVAL_POLICY,
} from './support/venue.js';

test('register and login open the customer portal', async ({ page }) => {
  await useEnglish(page);
  const venue = await createIsolatedVenue({
    bookingPolicy: AUTO_CONFIRM_POLICY,
  });
  const email = uniqueEmail('smoke-register');
  await registerCustomer(page, venue.slug, {
    name: uniqueName('Smoke Register'),
    email,
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  await expect(page.locator('#portal-result')).toHaveText(/Account created/);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PORTAL_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('navigation', { name: 'Customer navigation' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Next activity' }),
  ).toBeVisible();
});

test('AUTO_CONFIRM booking appears for customer, staff, and finance', async ({
  page,
}) => {
  await useEnglish(page);
  const venue = await createIsolatedVenue({
    prefix: 'smoke-auto',
    bookingPolicy: AUTO_CONFIRM_POLICY,
  });
  const email = uniqueEmail('smoke-auto');
  const name = uniqueName('Smoke Auto');
  const account = await venue.services.customerAccounts.register(venue.slug, {
    name,
    email,
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  await loginCustomer(page, venue.slug, email, PORTAL_PASSWORD);
  await page.getByRole('link', { name: 'Book', exact: true }).click();
  const date = futureDate(7);
  await findAvailability(page, date);
  await selectFirstSlot(page);
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.locator('#portal-booking-result')).toHaveText(
    'Reservation confirmed.',
  );
  await page.getByRole('link', { name: 'Activities' }).click();
  await expect(
    page.getByRole('button', { name: 'Cancel reservation' }),
  ).toBeVisible();
  await login(page, {
    email: venue.ownerEmail,
    password: venue.ownerPassword,
  });
  const reservations = await api(page, `/reservations?date=${date}`);
  expect(
    (
      reservations.body.data as Array<{ customerId: string; status: string }>
    ).some(
      (item) =>
        item.customerId === account.customer.customerId &&
        item.status === 'BOOKED',
    ),
  ).toBe(true);
  const charges = await venue.repo.scan(
    (item) =>
      item.entity === 'charge' &&
      item.customerId === account.customer.customerId,
  );
  expect(charges.length).toBeGreaterThan(0);
  await page.goto('/schedule');
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
});

test('only one of two customers can AUTO_CONFIRM the same slot', async ({
  page,
  browser,
}) => {
  await useEnglish(page);
  const venue = await createIsolatedVenue({
    prefix: 'smoke-race',
    bookingPolicy: AUTO_CONFIRM_POLICY,
  });
  const emailA = uniqueEmail('smoke-a');
  const emailB = uniqueEmail('smoke-b');
  await venue.services.customerAccounts.register(venue.slug, {
    name: uniqueName('Smoke A'),
    email: emailA,
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  await venue.services.customerAccounts.register(venue.slug, {
    name: uniqueName('Smoke B'),
    email: emailB,
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  try {
    await useEnglish(pageB);
    await loginCustomer(page, venue.slug, emailA, PORTAL_PASSWORD);
    await loginCustomer(pageB, venue.slug, emailB, PORTAL_PASSWORD);
    const date = futureDate(8);
    for (const current of [page, pageB]) {
      await current.getByRole('link', { name: 'Book', exact: true }).click();
      await findAvailability(current, date);
    }
    const slotValue = await page
      .locator('input[name="slot"]')
      .first()
      .getAttribute('value');
    expect(slotValue).toBeTruthy();
    await page.locator(`input[name="slot"][value="${slotValue}"]`).check();
    await pageB.locator(`input[name="slot"][value="${slotValue}"]`).check();
    await Promise.all([
      page.getByRole('button', { name: 'Confirm booking' }).click(),
      pageB.getByRole('button', { name: 'Confirm booking' }).click(),
    ]);
    await Promise.all([
      expect(page.locator('#portal-booking-result')).toHaveText(
        /Reservation confirmed|no longer available|conflicts/,
      ),
      expect(pageB.locator('#portal-booking-result')).toHaveText(
        /Reservation confirmed|no longer available|conflicts/,
      ),
    ]);
    const texts = [
      (await page.locator('#portal-booking-result').textContent()) ?? '',
      (await pageB.locator('#portal-booking-result').textContent()) ?? '',
    ];
    expect(
      texts.filter((text) => text.includes('Reservation confirmed.')),
    ).toHaveLength(1);
    expect(
      texts.some(
        (text) =>
          text.includes('no longer available') || text.includes('conflicts'),
      ),
    ).toBe(true);
  } finally {
    await contextB.close();
  }
});

test('eligible cancellation returns the slot and keeps history', async ({
  page,
}) => {
  await useEnglish(page);
  const venue = await createIsolatedVenue({
    prefix: 'smoke-cancel',
    bookingPolicy: AUTO_CONFIRM_POLICY,
  });
  const email = uniqueEmail('smoke-cancel');
  await venue.services.customerAccounts.register(venue.slug, {
    name: uniqueName('Smoke Cancel'),
    email,
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  await loginCustomer(page, venue.slug, email, PORTAL_PASSWORD);
  await page.getByRole('link', { name: 'Book', exact: true }).click();
  const date = futureDate(9);
  await findAvailability(page, date);
  const slotValue = await page
    .locator('input[name="slot"]')
    .first()
    .getAttribute('value');
  await selectFirstSlot(page);
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.locator('#portal-booking-result')).toHaveText(
    'Reservation confirmed.',
  );
  await page.getByRole('link', { name: 'Activities' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Cancel reservation' }).click();
  await expect(page.getByText('No upcoming reservations.')).toBeVisible();
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Book', exact: true }).click();
  await findAvailability(page, date);
  await expect(
    page.locator(`input[name="slot"][value="${slotValue}"]`),
  ).toBeVisible();
});

test('REQUEST_APPROVAL stays available until staff confirms', async ({
  page,
}) => {
  await useEnglish(page);
  const venue = await createIsolatedVenue({
    prefix: 'smoke-request',
    bookingPolicy: REQUEST_APPROVAL_POLICY,
  });
  const email = uniqueEmail('smoke-request');
  const name = uniqueName('Smoke Request');
  await venue.services.customerAccounts.register(venue.slug, {
    name,
    email,
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  await loginCustomer(page, venue.slug, email, PORTAL_PASSWORD);
  await page.getByRole('link', { name: 'Book', exact: true }).click();
  const date = futureDate(10);
  await findAvailability(page, date);
  const slotValue = await page
    .locator('input[name="slot"]')
    .first()
    .getAttribute('value');
  await selectFirstSlot(page);
  await page.getByRole('button', { name: 'Send booking request' }).click();
  await expect(page.locator('#portal-booking-result')).toHaveText(
    /Request sent\./,
  );
  await findAvailability(page, date);
  await expect(
    page.locator(`input[name="slot"][value="${slotValue}"]`),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Activities' }).click();
  await expect(page.getByText('Requested · not confirmed')).toBeVisible();
  await login(page, {
    email: venue.ownerEmail,
    password: venue.ownerPassword,
  });
  await page.goto('/requests');
  const row = page.locator('tr').filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Confirm' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm request' })
    .click();
  await expect(page.getByText('Request confirmed.')).toBeVisible();
  await loginCustomer(page, venue.slug, email, PORTAL_PASSWORD);
  await page.getByRole('link', { name: 'Activities' }).click();
  await expect(
    page.getByRole('button', { name: 'Cancel reservation' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Book', exact: true }).click();
  await findAvailability(page, date);
  await expect(
    page.locator(`input[name="slot"][value="${slotValue}"]`),
  ).toHaveCount(0);
});

test('class waitlist can be fulfilled by staff and stays visible', async ({
  page,
}) => {
  await useEnglish(page);
  const { services, owner, ctx, ctx2, classId, slug } =
    await classFixture(dynamo());
  await services.classes.enroll(owner, classId, ctx.customerId);
  await services.waitlists.joinClass(ctx2, { classId });
  await services.classes.leaveSelf(ctx, classId);
  const ownerLogin = await addOwnerLogin(
    owner.organizationId,
    owner.userId,
    `owner-${owner.organizationId}@phase2.test`,
  );
  await login(page, ownerLogin);
  await page.goto('/waitlists');
  await expect(page.getByRole('heading', { name: 'Waitlists' })).toBeVisible();
  await page.getByRole('button', { name: 'Enroll customer' }).click();
  await expect(page.getByText('Customer enrolled.')).toBeVisible();
  await expect(page.getByText('Fulfilled').first()).toBeVisible();
  await loginCustomer(page, slug, 'bea@example.test', 'class-password');
  await page.getByRole('link', { name: 'Classes', exact: true }).click();
  await expect(page.getByText('Enrolled', { exact: true })).toBeVisible();
});

test('customer cannot read another customer reservation over the API', async ({
  page,
}) => {
  await useEnglish(page);
  const venue = await createIsolatedVenue({
    prefix: 'smoke-idor',
    bookingPolicy: AUTO_CONFIRM_POLICY,
  });
  const emailA = uniqueEmail('idor-a');
  const emailB = uniqueEmail('idor-b');
  const accountA = await venue.services.customerAccounts.register(venue.slug, {
    name: uniqueName('Idor A'),
    email: emailA,
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  await venue.services.customerAccounts.register(venue.slug, {
    name: uniqueName('Idor B'),
    email: emailB,
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  const start = new Date(Date.now() + 5 * 86400000);
  start.setUTCHours(18, 0, 0, 0);
  const reservation = await venue.services.reservations.create(venue.owner, {
    courtId: venue.court.courtId,
    customerId: accountA.customer.customerId,
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + 3600000).toISOString(),
    source: 'STAFF',
  });
  await loginCustomer(page, venue.slug, emailB, PORTAL_PASSWORD);
  const foreign = await customerApi(
    page,
    `/customer/reservations/${reservation.reservationId}`,
  );
  expect(foreign.status).toBe(404);
  await page.goto(
    `/portal/${venue.slug}/reservations/${reservation.reservationId}`,
  );
  await expect(page.getByText(accountA.customer.name)).toHaveCount(0);
});
