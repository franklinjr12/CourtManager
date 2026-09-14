import { expect, test } from '@playwright/test';

import { api } from './support/api.js';
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
  AUTO_CONFIRM_POLICY,
  createIsolatedVenue,
  REQUEST_APPROVAL_POLICY,
} from './support/venue.js';

test('new customer registers through venue portal', async ({ page }) => {
  await useEnglish(page);
  await login(page);
  const organization = await api(page, '/organization');
  const slug = organization.body.data.slug as string;
  const name = uniqueName('Portal Customer');
  await registerCustomer(page, slug, {
    name,
    email: uniqueEmail('portal'),
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  await expect(page.locator('#portal-result')).toHaveText(/Account created/);
  await page.goto(`/customers?search=${encodeURIComponent(name)}`);
  await expect(page.locator('tr').filter({ hasText: name })).toBeVisible();
});

test('customer portal has separate navigation after sign in', async ({
  page,
}) => {
  await useEnglish(page);
  await login(page);
  const organization = await api(page, '/organization');
  const slug = organization.body.data.slug as string;
  const email = uniqueEmail('portal-nav');
  const name = uniqueName('Portal Nav');
  await registerCustomer(page, slug, {
    name,
    email,
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  await expect(page.locator('#portal-result')).toHaveText(/Account created/);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PORTAL_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByRole('navigation', { name: 'Customer navigation' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Book', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Activities' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Classes' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Profile' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Schedule' })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Next activity' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Upcoming activities' }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: /Portal Nav/ })).toBeVisible();
});

test('customer searches all-court availability and confirms an instant booking', async ({
  page,
}) => {
  await useEnglish(page);
  const venue = await createIsolatedVenue({
    prefix: 'participants',
    bookingPolicy: AUTO_CONFIRM_POLICY,
  });
  const email = uniqueEmail('portal-book');
  await registerCustomer(page, venue.slug, {
    name: uniqueName('Portal Book'),
    email,
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  await expect(page.locator('#portal-result')).toHaveText(/Account created/);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PORTAL_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Book', exact: true }).click();
  await expect(page.locator('input[name="slot"]').first()).toBeVisible();
  const future = new Date();
  future.setDate(future.getDate() + 7);
  const date = future.toISOString().slice(0, 10);
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
  await page.getByRole('button', { name: 'Participants', exact: true }).click();
  const participants = page.getByRole('region', {
    name: 'Reservation participants',
  });
  await expect(
    participants.getByText(
      'You are the reservation owner; no need to add yourself.',
    ),
  ).toBeVisible();
  await participants
    .getByLabel('Participant name', { exact: true })
    .fill('Maria');
  await participants
    .getByLabel('Participant email (optional)')
    .fill('maria-player@example.test');
  await participants
    .getByRole('button', { name: 'Add participant', exact: true })
    .click();
  await participants
    .getByRole('button', { name: 'Edit Maria', exact: true })
    .click();
  await participants
    .getByLabel('Participant name', { exact: true })
    .fill('Maria Silva');
  await participants
    .getByRole('button', { name: 'Save participant', exact: true })
    .click();
  await expect(
    participants.getByText('Maria Silva', { exact: true }),
  ).toBeVisible();
  await participants
    .getByLabel('Participant name', { exact: true })
    .fill('Temporary guest');
  await participants
    .getByRole('button', { name: 'Add participant', exact: true })
    .click();
  await participants
    .getByRole('button', { name: 'Remove Temporary guest', exact: true })
    .click();
  await expect(
    participants.getByText('Temporary guest', { exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Participants', exact: true }).click();
  await expect(
    participants.getByText('Maria Silva', { exact: true }),
  ).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Cancel reservation' }).click();
  await expect(page.getByText('No upcoming reservations.')).toBeVisible();
  await page.getByRole('button', { name: 'Participants', exact: true }).click();
  await expect(
    participants.getByText('Maria Silva', { exact: true }),
  ).toBeVisible();
  await expect(
    participants.getByRole('button', { name: 'Add participant', exact: true }),
  ).toHaveCount(0);
});

test('customer sends REQUEST_APPROVAL booking and sees pending request', async ({
  page,
}) => {
  await useEnglish(page);
  const venue = await createIsolatedVenue({
    prefix: 'approval',
    bookingPolicy: REQUEST_APPROVAL_POLICY,
  });
  const email = uniqueEmail('approval');
  await registerCustomer(page, venue.slug, {
    name: uniqueName('Approval Customer'),
    email,
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  await expect(page.locator('#portal-result')).toHaveText(/Account created/);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PORTAL_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Book', exact: true }).click();
  await expect(page.locator('input[name="slot"]').first()).toBeVisible();
  const future = new Date();
  future.setDate(future.getDate() + 7);
  const date = future.toISOString().slice(0, 10);
  await findAvailability(page, date);
  await selectFirstSlot(page);
  await page.getByRole('button', { name: 'Send booking request' }).click();
  await expect(page.locator('#portal-booking-result')).toHaveText(
    /Request sent\./,
  );
  await page.getByRole('link', { name: 'Activities' }).click();
  await expect(
    page.getByRole('heading', { name: 'Pending booking requests' }),
  ).toBeVisible();
  await expect(page.getByText('Requested · not confirmed')).toBeVisible();
});

test('customer books again from reservation history with a fresh availability check', async ({
  page,
}) => {
  const venue = await createIsolatedVenue({
    prefix: 'rebook',
    bookingPolicy: AUTO_CONFIRM_POLICY,
  });
  const email = uniqueEmail('rebook');
  const account = await venue.services.customerAccounts.register(venue.slug, {
    name: uniqueName('Rebook Customer'),
    email,
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  const previous = new Date(Date.now() - 8 * 86400000);
  previous.setUTCHours(10, 0, 0, 0);
  const reservation = await venue.services.reservations.create(venue.owner, {
    courtId: venue.court.courtId,
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

  await useEnglish(page);
  await loginCustomer(page, venue.slug, email, PORTAL_PASSWORD);
  await page.getByRole('link', { name: 'Activities' }).click();
  const bookAgain = page.getByRole('link', { name: 'Book again' });
  await expect(bookAgain).toBeVisible();
  await expect(bookAgain).toHaveAttribute(
    'href',
    `/portal/${venue.slug}/book?rebook=${reservation.reservationId}`,
  );
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response
          .url()
          .includes(
            `/customer/reservations/${reservation.reservationId}/rebook`,
          ) && response.ok(),
    ),
    bookAgain.click(),
  ]);
  await expect(page).toHaveURL(
    new RegExp(
      `/portal/${venue.slug}/book\\?rebook=${reservation.reservationId}`,
    ),
  );
  await expect(page.locator('select[name="durationMinutes"]')).toHaveValue(
    '60',
  );
  await expect(page.locator('input[name="slot"]:checked')).toHaveCount(1);
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.locator('#portal-booking-result')).toHaveText(
    'Reservation confirmed.',
  );
});
