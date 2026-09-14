import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

import { dynamo } from '../../apps/api/src/db.js';
import { buildServices } from '../../apps/api/src/services/index.js';
import { api } from './support/api.js';
import { login } from './support/auth.js';

async function useEnglish(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.evaluate(() =>
    localStorage.setItem('court-manager-locale', 'en-US'),
  );
}

test('new customer registers through venue portal', async ({ page }) => {
  await useEnglish(page);
  await login(page);
  const organization = await api(page, '/organization');
  const slug = organization.body.data.slug as string;
  const name = `Portal Customer ${Date.now()}`;
  await page.goto(`/portal/${slug}/register`);
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(`portal-${Date.now()}@example.test`);
  await page.getByLabel('Phone').fill('9' + Date.now().toString().slice(-10));
  await page.getByLabel('Password').fill('portal-password');
  await page.getByRole('button', { name: 'Register' }).click();
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
  const email = `portal-nav-${Date.now()}@example.test`;
  const password = 'portal-password';
  await page.goto(`/portal/${slug}/register`);
  await page.getByLabel('Name').fill(`Portal Nav ${Date.now()}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Phone').fill('9' + Date.now().toString().slice(-10));
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.locator('#portal-result')).toHaveText(/Account created/);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
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
  await login(page);
  const organization = await api(page, '/organization');
  const organizationId = randomUUID();
  const slug = `participants-${organizationId}`;
  const policy = {
    reservationMode: 'AUTO_CONFIRM',
    bookAheadDays: 365,
    cancellationCutoffHours: 6,
    minimumReservationMinutes: 60,
    maximumReservationMinutes: 60,
    maximumActiveBookings: 3,
  };
  // Isolate policy changes from concurrent anonymous-booking tests.
  const repo = dynamo();
  await repo.put({
    ...organization.body.data,
    PK: `ORG#${organizationId}`,
    SK: 'META',
    entity: 'organization',
    organizationId,
    slug,
    bookingPolicy: policy,
  });
  await buildServices(repo).courts.create(
    { organizationId, userId: 'test-owner', role: 'OWNER' },
    {
      name: `Portal court ${Date.now()}`,
      sport: 'Tennis',
      slotMinutes: 30,
      defaultHourlyPrice: 80,
      publiclyRequestable: true,
      active: true,
      openingHours: Object.fromEntries(
        [
          'MONDAY',
          'TUESDAY',
          'WEDNESDAY',
          'THURSDAY',
          'FRIDAY',
          'SATURDAY',
          'SUNDAY',
        ].map((day) => [day, { open: '07:00', close: '23:00' }]),
      ),
    },
  );
  const email = `portal-book-${Date.now()}@example.test`;
  await page.goto(`/portal/${slug}/register`);
  await page.getByLabel('Name').fill(`Portal Book ${Date.now()}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Phone').fill('9' + Date.now().toString().slice(-10));
  await page.getByLabel('Password').fill('portal-password');
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.locator('#portal-result')).toHaveText(/Account created/);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('portal-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Book', exact: true }).click();
  // Wait for initial policy/availability loading before changing the date.
  await expect(page.locator('input[name="slot"]').first()).toBeVisible();
  const future = new Date();
  future.setDate(future.getDate() + 7);
  await page
    .locator('input[name="date"]')
    .fill(future.toISOString().slice(0, 10));
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response
          .url()
          .includes(
            `/customer/availability?date=${future.toISOString().slice(0, 10)}`,
          ) && response.ok(),
    ),
    page.getByRole('button', { name: 'Find availability' }).click(),
  ]);
  const slot = page.locator('input[name="slot"]').first();
  await expect(slot).toBeVisible();
  await slot.check();
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
  await login(page);
  const organization = await api(page, '/organization');
  const organizationId = randomUUID();
  const slug = `approval-${organizationId}`;
  const policy = {
    reservationMode: 'REQUEST_APPROVAL',
    bookAheadDays: 365,
    cancellationCutoffHours: 6,
    minimumReservationMinutes: 60,
    maximumReservationMinutes: 60,
    maximumActiveBookings: 3,
  };
  const repo = dynamo();
  await repo.put({
    ...organization.body.data,
    PK: `ORG#${organizationId}`,
    SK: 'META',
    entity: 'organization',
    organizationId,
    slug,
    timezone: 'UTC',
    bookingPolicy: policy,
  });
  await buildServices(repo).courts.create(
    { organizationId, userId: 'test-owner', role: 'OWNER' },
    {
      name: `Approval court ${Date.now()}`,
      sport: 'Tennis',
      slotMinutes: 30,
      defaultHourlyPrice: 80,
      publiclyRequestable: true,
      active: true,
      openingHours: Object.fromEntries(
        [
          'MONDAY',
          'TUESDAY',
          'WEDNESDAY',
          'THURSDAY',
          'FRIDAY',
          'SATURDAY',
          'SUNDAY',
        ].map((day) => [day, { open: '07:00', close: '23:00' }]),
      ),
    },
  );
  const email = `approval-${Date.now()}@example.test`;
  await page.goto(`/portal/${slug}/register`);
  await page.getByLabel('Name').fill(`Approval Customer ${Date.now()}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Phone').fill('9' + Date.now().toString().slice(-10));
  await page.getByLabel('Password').fill('portal-password');
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.locator('#portal-result')).toHaveText(/Account created/);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('portal-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Book', exact: true }).click();
  await expect(page.locator('input[name="slot"]').first()).toBeVisible();
  const future = new Date();
  future.setDate(future.getDate() + 7);
  const date = future.toISOString().slice(0, 10);
  await page.locator('input[name="date"]').fill(date);
  await page.getByRole('button', { name: 'Find availability' }).click();
  const slot = page.locator('input[name="slot"]').first();
  await expect(slot).toBeVisible();
  await slot.check();
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
  await login(page);
  const organization = await api(page, '/organization');
  const organizationId = randomUUID();
  const slug = `rebook-${organizationId}`;
  const policy = {
    reservationMode: 'AUTO_CONFIRM',
    bookAheadDays: 365,
    cancellationCutoffHours: 6,
    minimumReservationMinutes: 60,
    maximumReservationMinutes: 60,
    maximumActiveBookings: 3,
  };
  const repo = dynamo();
  await repo.put({
    ...organization.body.data,
    PK: `ORG#${organizationId}`,
    SK: 'META',
    entity: 'organization',
    organizationId,
    slug,
    timezone: 'UTC',
    bookingPolicy: policy,
  });
  const services = buildServices(repo);
  const owner = {
    organizationId,
    userId: 'test-owner',
    role: 'OWNER' as const,
  };
  const court = await services.courts.create(owner, {
    name: `Rebook court ${Date.now()}`,
    sport: 'Tennis',
    slotMinutes: 30,
    defaultHourlyPrice: 80,
    publiclyRequestable: true,
    active: true,
    openingHours: Object.fromEntries(
      [
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
        'SATURDAY',
        'SUNDAY',
      ].map((day) => [day, { open: '07:00', close: '23:00' }]),
    ),
  });
  const email = `rebook-${Date.now()}@example.test`;
  const account = await services.customerAccounts.register(slug, {
    name: `Rebook Customer ${Date.now()}`,
    email,
    phone: '9' + Date.now().toString().slice(-10),
    password: 'portal-password',
  });
  const previous = new Date(Date.now() - 8 * 86400000);
  previous.setUTCHours(10, 0, 0, 0);
  const reservation = await services.reservations.create(owner, {
    courtId: court.courtId,
    customerId: account.customer.customerId,
    startAt: previous.toISOString(),
    endAt: new Date(previous.getTime() + 3600000).toISOString(),
    source: 'STAFF',
  });
  await services.reservations.transition(
    owner,
    reservation.reservationId,
    'CHECKED_IN',
  );
  await services.reservations.transition(
    owner,
    reservation.reservationId,
    'COMPLETED',
  );

  await useEnglish(page);
  await page.goto(`/portal/${slug}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('portal-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Activities' }).click();
  const bookAgain = page.getByRole('link', { name: 'Book again' });
  await expect(bookAgain).toBeVisible();
  await expect(bookAgain).toHaveAttribute(
    'href',
    `/portal/${slug}/book?rebook=${reservation.reservationId}`,
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
    new RegExp(`/portal/${slug}/book\\?rebook=${reservation.reservationId}`),
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
