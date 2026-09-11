import { expect, test } from '@playwright/test';

import { api } from './support/api.js';
import { login } from './support/auth.js';

const futureDate = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
};

test('staff and public booking keep start time when selecting duration intervals', async ({
  page,
}) => {
  const staffCustomerName = `PW Duration Staff ${Date.now()}`;
  await login(page);
  await page.goto('/schedule');
  await page.locator('#new-booking').click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#quick-customer').click();
  await dialog.locator('[name="quickName"]').fill(staffCustomerName);
  await dialog.locator('[name="quickPhone"]').fill('41999991111');
  await dialog.locator('#create-quick-customer').click();
  await dialog.locator('[name="date"]').fill(futureDate(70));
  const staffStart = dialog.locator('select[name="startTime"]');
  const staffStartOption = staffStart
    .locator('option[value]:not([value=""])')
    .first();
  await expect(staffStartOption).toBeAttached();
  await staffStart.selectOption(
    String(await staffStartOption.getAttribute('value')),
  );
  const selectedStaffStart = await staffStart.inputValue();
  const staffDuration = dialog.locator('select[name="durationMinutes"]');
  await expect(staffDuration.locator('option')).toHaveCount(9);
  await staffDuration.selectOption('90');
  await expect(staffStart).toHaveValue(selectedStaffStart);
  const reservationResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/reservations') &&
      response.request().method() === 'POST',
  );
  await dialog.locator('button.primary').click();
  await expect(dialog).toBeHidden();
  const createdReservation = (await (await reservationResponse).json())
    .data as {
    reservationId: string;
    startAt: string;
    endAt: string;
  };
  expect(
    (Date.parse(createdReservation.endAt) -
      Date.parse(createdReservation.startAt)) /
      60000,
  ).toBe(90);

  const staffCustomers = await api(
    page,
    `/customers?search=${encodeURIComponent(staffCustomerName)}`,
  );
  const staffCustomer = staffCustomers.body.data[0] as { customerId: string };
  const organization = await api(page, '/organization');
  const courts = await api(page, '/courts');
  const court = courts.body.data[0] as { courtId: string };
  const publicCustomerName = `PW Duration Public ${Date.now()}`;
  await page.goto(`/book/${organization.body.data.slug}`);
  await page.locator('select[name="courtId"]').selectOption(court.courtId);
  await page.locator('input[name="date"]').fill(futureDate(71));
  const publicStart = page.locator('select[name="time"]');
  const publicStartOption = publicStart
    .locator('option[value]:not([value=""])')
    .first();
  await expect(publicStartOption).toBeAttached();
  await publicStart.selectOption(
    String(await publicStartOption.getAttribute('value')),
  );
  const selectedPublicStart = await publicStart.inputValue();
  const publicDuration = page.locator('select[name="durationMinutes"]');
  await expect(publicDuration.locator('option')).toHaveCount(8);
  await publicDuration.selectOption('120');
  await expect(publicStart).toHaveValue(selectedPublicStart);
  await page.locator('input[name="customerName"]').fill(publicCustomerName);
  await page.locator('input[name="phone"]').fill('41999992222');
  const publicRequestResponse = page.waitForResponse(
    (response) =>
      /\/public\/venues\/[^/]+\/requests$/.test(response.url()) &&
      response.request().method() === 'POST',
  );
  await page.locator('#public-form button.primary').click();
  await expect(page.locator('#public-result')).not.toBeEmpty();
  const publicRequest = (await (await publicRequestResponse).json()).data as {
    requestId: string;
    requestedStartAt: string;
    requestedEndAt: string;
  };
  expect(
    (Date.parse(publicRequest.requestedEndAt) -
      Date.parse(publicRequest.requestedStartAt)) /
      60000,
  ).toBe(120);

  await api(page, `/requests/${publicRequest.requestId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Playwright cleanup' }),
  });
  await api(page, `/reservations/${createdReservation.reservationId}/cancel`, {
    method: 'POST',
  });
  await api(page, `/customers/${staffCustomer.customerId}/archive`, {
    method: 'POST',
  });
});
