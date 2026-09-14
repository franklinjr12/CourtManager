import { expect, test } from '@playwright/test';

import {
  apiAs,
  customerSignIn,
  customerToken,
  dateAhead,
  newPage,
  PASSWORD,
  seedVenue,
  selectFirstSlot,
  staffSignIn,
  useEnglish,
} from './support/venue.js';

/**
 * Phase 2 smoke pass: the eight priority customer journeys plus the checks
 * that only a browser can make (routing, rendering, mobile layout).
 */

test('1. register, sign in, refresh nested URLs, and navigate the portal', async ({
  page,
}) => {
  const venue = await seedVenue('AUTO_CONFIRM');
  const email = `register-${venue.organizationId}@smoke.test`;
  await useEnglish(page);
  await page.goto(`/portal/${venue.slug}/register`);
  await page.getByLabel('Name').fill('Smoke Registrant');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Phone').fill('9' + Date.now().toString().slice(-10));
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.locator('#portal-result')).toHaveText(/Account created/);
  await customerSignIn(page, venue.slug, email);

  for (const [link, path] of [
    ['Book', 'book'],
    ['Activities', 'reservations'],
    ['Classes', 'classes'],
    ['Profile', 'profile'],
    ['Home', ''],
  ] as const) {
    await page.getByRole('link', { name: link, exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`/portal/${venue.slug}${path ? `/${path}` : ''}$`),
    );
  }
  await page.goto(`/portal/${venue.slug}/reservations`);
  await page.reload();
  await expect(
    page.getByRole('navigation', { name: 'Customer navigation' }),
  ).toBeVisible();
  await page.goto(`/portal/${venue.slug}/profile`);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  await expect(
    page.locator('[name="tags"], [name="notes"], [name="archived"]'),
  ).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Schedule' })).toHaveCount(0);
});

test('2-4. AUTO_CONFIRM booking, concurrent same-slot attempt, and cancellation', async ({
  page,
  browser,
}) => {
  const venue = await seedVenue('AUTO_CONFIRM');
  const ana = await venue.registerCustomer('Ana');
  const bea = await venue.registerCustomer('Bea');
  const date = dateAhead(7);

  const other = await newPage(browser);
  await customerSignIn(page, venue.slug, ana.email);
  await customerSignIn(other, venue.slug, bea.email);
  const first = await selectFirstSlot(page, venue.slug, date);
  const second = await selectFirstSlot(other, venue.slug, date);
  expect(second).toBe(first);

  // Both customers submit the same slot at once.
  await Promise.all([
    page.getByRole('button', { name: 'Confirm booking' }).click(),
    other.getByRole('button', { name: 'Confirm booking' }).click(),
  ]);
  const results = [
    page.locator('#portal-booking-result'),
    other.locator('#portal-booking-result'),
  ];
  for (const result of results) await expect(result).not.toBeEmpty();
  const texts = await Promise.all(results.map((result) => result.innerText()));
  expect(texts.filter((text) => text === 'Reservation confirmed.')).toHaveLength(
    1,
  );
  const winner = texts[0] === 'Reservation confirmed.' ? page : other;
  const winnerEmail = winner === page ? ana.email : bea.email;
  await other.context().close();
  if (winner !== page) await customerSignIn(page, venue.slug, winnerEmail);

  // The reservation shows for the customer and on the staff schedule.
  await page.getByRole('link', { name: 'Activities' }).click();
  await expect(
    page.getByRole('button', { name: 'Cancel reservation' }),
  ).toBeVisible();
  const token = await customerToken(venue.slug, winnerEmail);
  const upcoming = await apiAs(token, '/customer/reservations/upcoming');
  expect(upcoming.body.data.reservations).toHaveLength(1);
  const reservationId = upcoming.body.data.reservations[0].reservationId;
  const staffPage = await newPage(browser);
  await staffSignIn(staffPage, venue.ownerEmail);
  await staffPage.goto(`/schedule?date=${date}`);
  await expect(staffPage.getByText(/Ana 1|Bea 2/).first()).toBeVisible();
  await staffPage.context().close();

  // Cancel: the slot returns to availability and the booking is history.
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Cancel reservation' }).click();
  await expect(page.getByText('No upcoming reservations.')).toBeVisible();
  expect(
    (await apiAs(token, `/customer/reservations/${reservationId}`)).body.data
      .status,
  ).toBe('CANCELLED');
  expect(await selectFirstSlot(page, venue.slug, date)).toBe(first);
});

test('5. REQUEST_APPROVAL request is approved by staff and becomes confirmed', async ({
  page,
  browser,
}) => {
  const venue = await seedVenue('REQUEST_APPROVAL');
  const ana = await venue.registerCustomer('Approval Ana');
  await customerSignIn(page, venue.slug, ana.email);
  await selectFirstSlot(page, venue.slug, dateAhead(8));
  await page.getByRole('button', { name: 'Send booking request' }).click();
  await expect(page.locator('#portal-booking-result')).toHaveText(
    /Request sent\./,
  );
  await page.getByRole('link', { name: 'Activities' }).click();
  await expect(page.getByText('Requested · not confirmed')).toBeVisible();

  const staff = await newPage(browser);
  await staffSignIn(staff, venue.ownerEmail);
  await staff.goto('/requests');
  const row = staff.locator('tr').filter({ hasText: ana.name });
  await row.getByRole('button', { name: 'Confirm', exact: true }).click();
  await staff.getByRole('button', { name: 'Confirm request' }).click();
  await expect(staff.getByText('Request confirmed.')).toBeVisible();
  await staff.context().close();

  await page.reload();
  await expect(page.getByText('Requested · not confirmed')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Cancel reservation' }),
  ).toBeVisible();
});

test('6-7. full class waitlist is fulfilled by staff', async ({
  page,
  browser,
}) => {
  const venue = await seedVenue('AUTO_CONFIRM');
  const ana = await venue.registerCustomer('Class Ana');
  const bea = await venue.registerCustomer('Class Bea');
  const cls = await venue.services.classes.create(venue.owner, {
    name: `Smoke Clinic ${venue.organizationId.slice(0, 6)}`,
    sport: 'Tennis',
    coachId: 'coach',
    courtId: venue.courtId,
    capacity: 1,
    pricePerParticipant: 40,
    scheduleType: 'SINGLE',
    startDate: dateAhead(9),
    startTime: '09:00',
    durationMinutes: 60,
  });

  await customerSignIn(page, venue.slug, ana.email);
  await page.getByRole('link', { name: 'Classes', exact: true }).click();
  await page.getByRole('button', { name: 'Enroll', exact: true }).click();
  await expect(page.getByText('Enrollment confirmed.', { exact: true })).toBeVisible();

  const beaPage = await newPage(browser);
  await customerSignIn(beaPage, venue.slug, bea.email);
  await beaPage.getByRole('link', { name: 'Classes', exact: true }).click();
  await expect(beaPage.getByText('1 / 1 enrolled', { exact: false })).toBeVisible();
  await expect(beaPage.getByRole('button', { name: 'Enroll', exact: true })).toHaveCount(0);
  await beaPage.getByRole('button', { name: 'Join waitlist' }).click();
  await expect(beaPage.getByText('Joined waitlist.', { exact: true })).toBeVisible();

  // Ana leaves, so staff can act on the opportunity.
  await page.getByRole('button', { name: 'Leave class' }).click();
  await expect(page.getByText('Enrollment cancelled.', { exact: true })).toBeVisible();

  const staff = await newPage(browser);
  await staffSignIn(staff, venue.ownerEmail);
  await staff.goto('/waitlists');
  await staff
    .locator('tr')
    .filter({ hasText: bea.name })
    .getByRole('button', { name: 'Enroll customer' })
    .click();
  await expect(staff.getByText('Customer enrolled.')).toBeVisible();
  await staff.context().close();

  const token = await customerToken(venue.slug, bea.email);
  const waitlists = await venue.services.waitlists.staffList(venue.owner);
  expect(waitlists).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ classId: cls.classId, status: 'FULFILLED' }),
    ]),
  );
  const classes = await apiAs(token, '/customer/classes');
  expect(
    classes.body.data.data.find(
      (item: { classId: string }) => item.classId === cls.classId,
    ).enrollment,
  ).toMatchObject({ status: 'ACTIVE' });
  await beaPage.reload();
  await expect(beaPage.getByRole('button', { name: 'Leave class' })).toBeVisible();
  await beaPage.context().close();
});

test("8. a customer cannot see or act on another customer's reservation", async ({
  page,
}) => {
  const venue = await seedVenue('AUTO_CONFIRM');
  const ana = await venue.registerCustomer('Owner Ana');
  const bea = await venue.registerCustomer('Intruder Bea');
  const reservation = await venue.services.reservations.create(venue.owner, {
    courtId: venue.courtId,
    customerId: ana.customerId,
    startAt: `${dateAhead(5)}T18:00:00.000Z`,
    endAt: `${dateAhead(5)}T19:00:00.000Z`,
    source: 'STAFF',
  });
  const intruder = await customerToken(venue.slug, bea.email);
  for (const [path, method] of [
    [`/customer/reservations/${reservation.reservationId}`, 'GET'],
    [`/customer/reservations/${reservation.reservationId}/cancel`, 'POST'],
    [`/customer/reservations/${reservation.reservationId}/participants`, 'GET'],
    ['/customers', 'GET'],
  ] as const)
    expect((await apiAs(intruder, path, { method })).status).toBeGreaterThanOrEqual(
      401,
    );

  await customerSignIn(page, venue.slug, bea.email);
  await page.goto(`/portal/${venue.slug}/reservations/${reservation.reservationId}`);
  await expect(
    page.getByRole('navigation', { name: 'Customer navigation' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Cancel reservation' }),
  ).toHaveCount(0);
  const owner = await customerToken(venue.slug, ana.email);
  expect(
    (await apiAs(owner, `/customer/reservations/${reservation.reservationId}`))
      .body.data.status,
  ).toBe('BOOKED');
});

test('STAFF_ONLY public booking page explains online booking is disabled', async ({
  page,
}) => {
  const venue = await seedVenue('STAFF_ONLY');
  await useEnglish(page);
  await page.goto(`/book/${venue.slug}`);
  await expect(
    page.getByText('Online booking is unavailable. Please contact venue staff.'),
  ).toBeVisible();
  await expect(page.getByLabel('Phone')).toHaveCount(0);
  const ana = await venue.registerCustomer('Staff Only Ana');
  const token = await customerToken(venue.slug, ana.email);
  expect(
    (
      await apiAs(token, '/customer/reservations', {
        method: 'POST',
        body: JSON.stringify({
          courtId: venue.courtId,
          startAt: `${dateAhead(3)}T18:00:00.000Z`,
          endAt: `${dateAhead(3)}T19:00:00.000Z`,
        }),
      })
    ).status,
  ).toBe(403);
});

test('mobile portal keeps navigation, booking, and activities usable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const venue = await seedVenue('AUTO_CONFIRM');
  const ana = await venue.registerCustomer('Mobile Ana');
  await customerSignIn(page, venue.slug, ana.email);
  for (const link of ['Book', 'Activities', 'Classes', 'Profile']) {
    await page.getByRole('link', { name: link, exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await selectFirstSlot(page, venue.slug, dateAhead(6));
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.locator('#portal-booking-result')).toHaveText(
    'Reservation confirmed.',
  );
});
