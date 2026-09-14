import { expect, test } from '@playwright/test';

import { api } from './support/api.js';
import { login, loginCustomer } from './support/auth.js';
import { findAvailability } from './support/booking.js';
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
  futureDate,
  openingHours,
  STAFF_ONLY_POLICY,
} from './support/venue.js';

test('STAFF_ONLY blocks portal and public booking but not staff', async ({
  page,
}) => {
  await useEnglish(page);
  const venue = await createIsolatedVenue({
    prefix: 'staff-only',
    bookingPolicy: STAFF_ONLY_POLICY,
  });
  const email = uniqueEmail('staff-only');
  const account = await venue.services.customerAccounts.register(venue.slug, {
    name: uniqueName('Staff Only Customer'),
    email,
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  await loginCustomer(page, venue.slug, email, PORTAL_PASSWORD);
  await page.getByRole('link', { name: 'Book', exact: true }).click();
  await expect(
    page.getByText(
      'Online booking is unavailable. Please contact venue staff.',
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Confirm booking' }),
  ).toHaveCount(0);
  await page.goto(`/book/${venue.slug}`);
  await expect(
    page.getByText(
      'Online booking is unavailable. Please contact venue staff.',
    ),
  ).toBeVisible();
  await login(page, {
    email: venue.ownerEmail,
    password: venue.ownerPassword,
  });
  const start = new Date(Date.now() + 4 * 86400000);
  start.setUTCHours(18, 0, 0, 0);
  const created = await api(page, '/reservations', {
    method: 'POST',
    body: JSON.stringify({
      courtId: venue.court.courtId,
      customerId: account.customer.customerId,
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 3600000).toISOString(),
    }),
  });
  expect(created.status).toBe(201);
});

test('settings policy change is visible immediately in the portal', async ({
  page,
}) => {
  await useEnglish(page);
  const venue = await createIsolatedVenue({
    prefix: 'policy-change',
    bookingPolicy: AUTO_CONFIRM_POLICY,
  });
  const email = uniqueEmail('policy-change');
  await venue.services.customerAccounts.register(venue.slug, {
    name: uniqueName('Policy Change'),
    email,
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  await loginCustomer(page, venue.slug, email, PORTAL_PASSWORD);
  await page.getByRole('link', { name: 'Book', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Confirm booking' }),
  ).toBeVisible();
  await login(page, {
    email: venue.ownerEmail,
    password: venue.ownerPassword,
  });
  await page.goto('/settings');
  await page.getByLabel('Reservation mode').selectOption('STAFF_ONLY');
  await page.getByRole('button', { name: 'Save organization' }).click();
  await expect(page.getByText('Organization saved.')).toBeVisible();
  await page.goto(`/portal/${venue.slug}/book`);
  await expect(
    page.getByText(
      'Online booking is unavailable. Please contact venue staff.',
    ),
  ).toBeVisible();
});

test('availability search respects sport, occupancy, hours, past dates, and horizon', async ({
  page,
}) => {
  await useEnglish(page);
  const venue = await createIsolatedVenue({
    prefix: 'availability',
    bookingPolicy: {
      ...AUTO_CONFIRM_POLICY,
      bookAheadDays: 2,
      minimumReservationMinutes: 60,
      maximumReservationMinutes: 90,
    },
    courts: [
      {
        name: 'Tennis Court',
        sport: 'Tennis',
        openingHours: openingHours('09:00', '12:00'),
      },
      {
        name: 'Volleyball Court',
        sport: 'Beach volleyball',
        openingHours: openingHours('09:00', '12:00'),
      },
    ],
  });
  const email = uniqueEmail('availability');
  const account = await venue.services.customerAccounts.register(venue.slug, {
    name: uniqueName('Availability'),
    email,
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  const date = futureDate(1);
  await venue.services.reservations.create(venue.owner, {
    courtId: venue.courts[0]!.courtId,
    customerId: account.customer.customerId,
    startAt: `${date}T10:00:00.000Z`,
    endAt: `${date}T11:00:00.000Z`,
    source: 'STAFF',
  });
  await loginCustomer(page, venue.slug, email, PORTAL_PASSWORD);
  await page.getByRole('link', { name: 'Book', exact: true }).click();
  await expect(
    page.locator('select[name="durationMinutes"] option'),
  ).toHaveCount(2);
  const durations = await page
    .locator('select[name="durationMinutes"] option')
    .evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );
  expect(durations).toEqual(['60', '90']);
  await findAvailability(page, date);
  await expect(
    page.locator(
      `input[name="slot"][value="${venue.courts[0]!.courtId}|10:00"]`,
    ),
  ).toHaveCount(0);
  await expect(page.getByText('Volleyball Court').first()).toBeVisible();
  await page.locator('select[name="sport"]').selectOption('Tennis');
  await expect(page.locator('#portal-booking-slots')).not.toHaveText(
    /Loading availability/,
  );
  await expect(page.getByText('Volleyball Court')).toHaveCount(0);
  const times = await page
    .locator('input[name="slot"]')
    .evaluateAll((inputs) =>
      inputs.map((input) =>
        String((input as HTMLInputElement).value.split('|')[1]),
      ),
    );
  expect(times.every((time) => time >= '09:00' && time <= '11:00')).toBe(true);
  const yesterday = futureDate(-1);
  await page.locator('input[name="date"]').fill(yesterday);
  await page.getByRole('button', { name: 'Find availability' }).click();
  await expect(page.locator('#portal-booking-result')).toHaveText(
    /Check the highlighted fields/,
  );
  await findAvailability(page, futureDate(10));
  await expect(page.locator('input[name="slot"]')).toHaveCount(0);
});
