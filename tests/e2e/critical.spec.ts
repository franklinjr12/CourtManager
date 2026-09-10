import { expect, test, type Page } from '@playwright/test';

const apiBase = 'http://localhost:8787';
const credentials = { email: 'owner@arena.test', password: 'dev-password' };

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(credentials.email);
  await page.getByLabel('Password').fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/dashboard/);
}

async function api(page: Page, path: string, init: RequestInit = {}) {
  return page.evaluate(
    async ({ apiBase, path, init }) => {
      const current = JSON.parse(
        localStorage.getItem('court-manager-session') ?? 'null',
      );
      const response = await fetch(`${apiBase}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${current.token}`,
          ...(init.headers ?? {}),
        },
      });
      return {
        status: response.status,
        body: await response.json().catch(() => ({})),
      };
    },
    { apiBase, path, init },
  );
}

test('login screen is keyboard accessible', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await page.getByLabel('Email').fill('owner@example.test');
  await page.getByLabel('Password').fill('wrong');
});

test('owner can manage courts from Settings', async ({ page }) => {
  const unique = `PW Court ${Date.now()}`;
  const edited = `${unique} Edited`;
  const sport = `PW Sport ${Date.now()}`;
  await login(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Add sport' }).click();
  const sportDialog = page.getByRole('dialog');
  await sportDialog.getByLabel('Name').fill(sport);
  await sportDialog.getByRole('button', { name: 'Add sport' }).click();
  await expect(page.locator('.list-row').filter({ hasText: sport })).toBeVisible();
  await page.getByRole('button', { name: 'Add court' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(unique);
  await dialog.getByLabel('Sport').fill('Tennis');
  await dialog.getByRole('button', { name: 'Add court' }).click();
  const row = page.locator('.list-row').filter({ hasText: unique });
  await expect(row).toBeVisible();
  const courts = await api(page, '/courts?includeArchived=true');
  const court = courts.body.data.find(
    (item: { name: string }) => item.name === unique,
  );
  expect(court).toBeTruthy();
  await row.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill(edited);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Save changes' })
    .click();
  await expect(
    page.locator('.list-row').filter({ hasText: edited }),
  ).toBeVisible();
  page.once('dialog', (dialogEvent) => dialogEvent.accept());
  await page
    .locator('.list-row')
    .filter({ hasText: edited })
    .getByRole('button', { name: 'Archive' })
    .click();
  await expect(
    page.locator('.list-row').filter({ hasText: edited }).getByText('Archived'),
  ).toBeVisible();
  await page
    .locator('.list-row')
    .filter({ hasText: edited })
    .getByRole('button', { name: 'Restore' })
    .click();
  await expect(
    page.locator('.list-row').filter({ hasText: edited }).getByText('Active'),
  ).toBeVisible();
  page.once('dialog', (dialogEvent) => dialogEvent.accept());
  await page
    .locator('.list-row')
    .filter({ hasText: edited })
    .getByRole('button', { name: 'Archive' })
    .click();
  await expect(
    page.locator('.list-row').filter({ hasText: edited }).getByText('Archived'),
  ).toBeVisible();
  if (court)
    expect((await api(page, `/courts/${court.courtId}`)).status).toBe(404);
});

test('public request flows through confirmation, payment, completion, and history', async ({
  page,
}) => {
  const unique = `PW Public Customer ${Date.now()}`;
  await login(page);
  const organization = await api(page, '/organization');
  const courts = await api(page, '/courts');
  const court = courts.body.data[0] as { courtId: string };
  const future = new Date();
  future.setDate(future.getDate() + 14);
  const date = future.toISOString().slice(0, 10);
  await page.goto(`/book/${organization.body.data.slug}`);
  await page.locator('select[name="courtId"]').selectOption(court.courtId);
  await page.locator('input[name="date"]').fill(date);
  await expect(page.locator('select[name="time"] option').first()).not.toHaveText('Loadingâ€¦');
  await page.locator('input[name="customerName"]').fill(unique);
  await page.locator('input[name="phone"]').fill('41999997777');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.locator('#public-result')).toHaveText(/Request sent/);

  await page.goto('/requests');
  const requestRow = page.locator('tr').filter({ hasText: unique });
  await expect(requestRow).toBeVisible();
  await requestRow.getByRole('button', { name: 'Confirm' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm request' }).click();
  await expect(requestRow).toContainText('CONFIRMED');
  const requestData = await api(page, '/requests');
  const confirmed = requestData.body.data.find(
    (item: { customerName: string; linkedCustomerId?: string; linkedReservationId?: string }) =>
      item.customerName === unique,
  );
  expect(confirmed?.linkedCustomerId).toBeTruthy();
  expect(confirmed?.linkedReservationId).toBeTruthy();
  if (!confirmed?.linkedCustomerId || !confirmed.linkedReservationId)
    throw new Error('Confirmed request did not return linked records.');

  const pending = await api(page, `/reservations/${confirmed.linkedReservationId}`);
  const payment = await api(page, '/payments', {
    method: 'POST',
    body: JSON.stringify({
      reservationId: confirmed.linkedReservationId,
      customerId: confirmed.linkedCustomerId,
      amount: Number(pending.body.data.expectedAmount),
      method: 'PIX',
      paidAt: new Date().toISOString(),
    }),
  });
  expect(payment.status).toBe(201);
  const paid = await api(page, `/reservations/${confirmed.linkedReservationId}`);
  expect(paid.body.data.paymentStatus).toBe('PAID');
  expect(
    (await api(page, `/reservations/${confirmed.linkedReservationId}/complete`, { method: 'POST' })).status,
  ).toBe(200);
  const scheduleData = await api(page, `/schedule?date=${date}`);
  expect(
    scheduleData.body.data.items.some(
      (item: { reservationId?: string; status?: string }) =>
        item.reservationId === confirmed.linkedReservationId && item.status === 'COMPLETED',
    ),
  ).toBe(true);
  const rejectedName = `PW Rejected Customer ${Date.now()}`;
  const rejectedDateValue = new Date(`${date}T00:00:00Z`);
  rejectedDateValue.setUTCDate(rejectedDateValue.getUTCDate() + 1);
  const rejectedDate = rejectedDateValue.toISOString().slice(0, 10);
  await page.evaluate(
    async ({ apiBase, slug, courtId, rejectedDate, rejectedName }) => {
      await fetch(`${apiBase}/public/venues/${slug}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courtId,
          requestedStartAt: `${rejectedDate}T15:00:00-03:00`,
          requestedEndAt: `${rejectedDate}T16:00:00-03:00`,
          customerName: rejectedName,
          phone: '41999996666',
        }),
      });
    },
    {
      apiBase,
      slug: organization.body.data.slug,
      courtId: court.courtId,
      rejectedDate,
      rejectedName,
    },
  );
  await page.goto('/requests');
  const rejectedRow = page.locator('tr').filter({ hasText: rejectedName });
  await expect(rejectedRow).toBeVisible();
  await rejectedRow.getByRole('button', { name: 'Reject' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('No availability after review.');
  page.once('dialog', (dialogEvent) => dialogEvent.accept());
  await page.getByRole('dialog').getByRole('button', { name: 'Reject request' }).click();
  await expect(rejectedRow).toContainText('REJECTED');
  await page.goto(`/customers?search=${encodeURIComponent(unique)}`);
  await expect(page.locator('tr').filter({ hasText: unique })).toBeVisible();
  await page.locator('tr').filter({ hasText: unique }).getByRole('button', { name: 'History' }).click();
  await expect(page.getByRole('dialog')).toContainText('COMPLETED');
});

test('browser API workflow covers conflicts, recurring reservations, and court blocks', async ({
  page,
}) => {
  await login(page);
  const courts = await api(page, '/courts');
  const customers = await api(page, '/customers?limit=1');
  const courtId = courts.body.data[0].courtId as string;
  const customerId = customers.body.data[0].customerId as string;
  const candidate = new Date(Date.now() + 30 * 86400000);
  let base = '';
  for (let offset = 0; offset < 30 && !base; offset += 1) {
    const date = new Date(candidate);
    date.setUTCDate(candidate.getUTCDate() + offset);
    const value = date.toISOString().slice(0, 10);
    const availability = await api(
      page,
      `/availability?courtId=${courtId}&date=${value}&durationMinutes=60`,
    );
    if (availability.body.data.available.includes('18:00')) base = value;
  }
  if (!base) throw new Error('Could not find an available test date.');
  const reservationInput = {
    courtId,
    customerId,
    startAt: `${base}T21:00:00Z`,
    endAt: `${base}T22:00:00Z`,
    source: 'STAFF',
  };
  const created = await api(page, '/reservations', { method: 'POST', body: JSON.stringify(reservationInput) });
  expect(created.status).toBe(201);
  expect((await api(page, '/reservations', { method: 'POST', body: JSON.stringify(reservationInput) })).status).toBe(409);
  const createdReservationId = created.body.data.reservationId as string;
  expect(
    (await api(page, `/reservations/${createdReservationId}/no-show`, { method: 'POST' })).status,
  ).toBe(200);
  const historicalSchedule = await api(page, `/schedule?date=${base}`);
  expect(
    historicalSchedule.body.data.items.some(
      (item: { reservationId?: string; status?: string }) =>
        item.reservationId === createdReservationId && item.status === 'NO_SHOW',
    ),
  ).toBe(true);
  const recurring = await api(page, '/reservations/recurring', {
    method: 'POST',
    body: JSON.stringify({
      ...reservationInput,
      startAt: `${new Date(new Date(`${base}T00:00:00Z`).getTime() + 14 * 86400000).toISOString().slice(0, 10)}T21:00:00Z`,
      endAt: `${new Date(new Date(`${base}T00:00:00Z`).getTime() + 14 * 86400000).toISOString().slice(0, 10)}T22:00:00Z`,
      untilDate: new Date(new Date(`${base}T00:00:00Z`).getTime() + 63 * 86400000).toISOString().slice(0, 10),
      frequency: 'WEEKLY',
      intervalWeeks: 1,
    }),
  });
  expect(recurring.status).toBe(201);
  expect(recurring.body.data.created).toHaveLength(8);
  const block = await api(page, '/blocks', {
    method: 'POST',
    body: JSON.stringify({
      courtId,
      startAt: `${new Date(new Date(`${base}T00:00:00Z`).getTime() + 70 * 86400000).toISOString().slice(0, 10)}T21:00:00Z`,
      endAt: `${new Date(new Date(`${base}T00:00:00Z`).getTime() + 70 * 86400000).toISOString().slice(0, 10)}T22:00:00Z`,
      reason: 'MAINTENANCE',
    }),
  });
  expect(block.status).toBe(201);
  const availability = await api(
    page,
    `/availability?courtId=${courtId}&date=${new Date(new Date(`${base}T00:00:00Z`).getTime() + 70 * 86400000).toISOString().slice(0, 10)}&durationMinutes=60`,
  );
  expect(availability.body.data.available).not.toContain('18:00');
});

test('new reservation opens, supports quick customer creation, and creates a booking', async ({
  page,
}) => {
  const unique = `PW Customer ${Date.now()}`;
  await login(page);
  await page.goto('/schedule');
  await page.getByRole('button', { name: 'New reservation' }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', { name: 'New reservation' }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: '+ New customer' }).click();
  await dialog.locator('[name="quickName"]').fill(unique);
  await dialog.locator('[name="quickPhone"]').fill('41999998888');
  await dialog.getByRole('button', { name: 'Create customer' }).click();
  await expect(
    dialog
      .locator('select[name="customerId"] option')
      .filter({ hasText: unique }),
  ).toHaveCount(1);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const date = tomorrow.toISOString().slice(0, 10);
  await dialog.getByLabel('Date').fill(date);
  await expect(
    dialog.locator('select[name="startTime"] option').first(),
  ).not.toHaveText('Loading…');
  await dialog.locator('select[name="startTime"]').selectOption({ index: 0 });
  await dialog.getByRole('button', { name: 'Save reservation' }).click();
  await expect(page.getByRole('status')).toHaveText('Reservation created.');
  const customers = await api(
    page,
    `/customers?search=${encodeURIComponent(unique)}`,
  );
  const customer = customers.body.data[0];
  const reservations = await api(page, '/reservations');
  const reservation = reservations.body.data.find(
    (item: { customerId: string }) => item.customerId === customer.customerId,
  );
  expect(reservation).toBeTruthy();
  if (reservation)
    await api(page, `/reservations/${reservation.reservationId}/cancel`, {
      method: 'POST',
    });
  await api(page, `/customers/${customer.customerId}/archive`, {
    method: 'POST',
  });
});

test('mobile schedule keeps actions usable and modal closes with Escape', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto('/schedule');
  await expect(
    page.getByRole('button', { name: 'New reservation' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'New reservation' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('owner operational screens expose workflows instead of placeholders', async ({
  page,
}) => {
  await login(page);
  await page.goto('/settings');
  await expect(
    page.getByText('Use the API or add courts through the settings workflow.'),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add court' })).toBeVisible();
  await page.goto('/customers');
  await expect(
    page.getByRole('button', { name: 'Add customer' }),
  ).toBeVisible();
  await page.goto('/reservations');
  await expect(
    page.getByRole('button', { name: 'New reservation' }),
  ).toBeVisible();
  await page.goto('/requests');
  await expect(
    page.getByRole('heading', { name: 'Reservation requests' }),
  ).toBeVisible();
  await page.goto('/finance');
  await expect(
    page.getByRole('button', { name: 'Record payment' }),
  ).toBeVisible();
  await page.goto('/classes');
  await expect(page.getByText(/Classes disabled|No classes yet/)).toBeVisible();
});
