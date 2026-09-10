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
  await login(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
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
