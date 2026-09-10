import { expect, test } from '@playwright/test';

import { api } from './support/api.js';
import { login } from './support/auth.js';

test('new reservation opens, supports quick customer creation, and creates a booking', async ({
  page,
}) => {
  const unique = `PW Customer ${Date.now()}`;
  await login(page);
  await page.goto('/schedule');
  await page.getByRole('button', { name: 'Nova reserva' }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', { name: 'Nova reserva' }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: '+ Novo cliente' }).click();
  await dialog.locator('[name="quickName"]').fill(unique);
  await dialog.locator('[name="quickPhone"]').fill('41999998888');
  await dialog.getByRole('button', { name: 'Criar cliente' }).click();
  await expect(
    dialog
      .locator('select[name="customerId"] option')
      .filter({ hasText: unique }),
  ).toHaveCount(1);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const date = tomorrow.toISOString().slice(0, 10);
  await dialog.getByLabel('Data').fill(date);
  await expect(
    dialog.locator('select[name="startTime"] option').first(),
  ).not.toHaveText('Carregando…');
  await dialog.locator('select[name="startTime"]').selectOption({ index: 0 });
  await dialog.getByRole('button', { name: 'Salvar reserva' }).click();
  await expect(page.getByRole('status')).toHaveText('Reserva criada.');
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
