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

test('paid reservation can be rescheduled after confirmation', async ({
  page,
}) => {
  await login(page);
  const courts = await api(page, '/courts');
  const unique = `PW Paid ${Date.now()}`;
  const customer = await api(page, '/customers', {
    method: 'POST',
    body: JSON.stringify({ name: unique, phone: '41999997777' }),
  });
  const court = courts.body.data[0] as { courtId: string };
  const base = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
  const nextDate = new Date(`${base}T00:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const movedDate = nextDate.toISOString().slice(0, 10);
  const created = await api(page, '/reservations', {
    method: 'POST',
    body: JSON.stringify({
      courtId: court.courtId,
      customerId: customer.body.data.customerId,
      startAt: `${base}T18:00:00.000Z`,
      endAt: `${base}T19:00:00.000Z`,
      expectedAmount: 80,
      source: 'STAFF',
    }),
  });
  expect(created.status).toBe(201);
  const reservation = created.body.data as {
    reservationId: string;
    customerId: string;
  };
  await api(page, '/payments', {
    method: 'POST',
    body: JSON.stringify({
      reservationId: reservation.reservationId,
      customerId: reservation.customerId,
      amount: 80,
      method: 'PIX',
      paidAt: `${base}T17:00:00.000Z`,
    }),
  });

  try {
    await page.goto('/reservations');
    const row = page.getByRole('row').filter({ hasText: unique });
    await row.getByRole('button', { name: 'Abrir' }).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('button', { name: 'Salvar horário' }),
    ).toBeVisible();
    await dialog.locator('[name="date"]').fill(movedDate);
    page.once('dialog', (browserDialog) => browserDialog.dismiss());
    await dialog.getByRole('button', { name: 'Salvar horário' }).click();
    await expect(dialog).toBeVisible();
  } finally {
    await api(page, `/reservations/${reservation.reservationId}/cancel`, {
      method: 'POST',
    });
    await api(page, `/customers/${reservation.customerId}/archive`, {
      method: 'POST',
    });
  }
});
