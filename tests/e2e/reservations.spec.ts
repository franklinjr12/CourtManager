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
  // Scope to this test's customer: the shared seed org accumulates
  // reservations from other specs and the list is paginated.
  const reservations = await api(
    page,
    `/reservations?customerId=${encodeURIComponent(customer.customerId)}`,
  );
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

test('staff moves a booked reservation and sees a conflict on an occupied slot', async ({
  page,
}) => {
  await login(page);
  const courts = await api(page, '/courts');
  const court = courts.body.data[0] as { courtId: string };
  const unique = `PW Move ${Date.now()}`;
  const customer = await api(page, '/customers', {
    method: 'POST',
    body: JSON.stringify({ name: unique, phone: '41999996666' }),
  });
  const customerId = customer.body.data.customerId as string;
  const day = new Date(Date.now() + 50 * 86400000).toISOString().slice(0, 10);
  const book = (from: string, to: string) =>
    api(page, '/reservations', {
      method: 'POST',
      body: JSON.stringify({
        courtId: court.courtId,
        customerId,
        startAt: `${day}T${from}:00.000Z`,
        endAt: `${day}T${to}:00.000Z`,
        expectedAmount: 80,
        source: 'STAFF',
      }),
    });
  const first = await book('14:00', '15:00');
  const second = await book('16:00', '17:00');
  expect(first.status).toBe(201);
  expect(second.status).toBe(201);
  const shift = (value: string, hours: number) => {
    const [h = 0, m = 0] = value.split(':').map(Number);
    return `${String(h + hours).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  try {
    await page.goto('/reservations');
    await page
      .getByRole('row')
      .filter({ hasText: unique })
      .first()
      .getByRole('button', { name: 'Abrir' })
      .click();
    const dialog = page.getByRole('dialog');
    const start = dialog.getByLabel('Início');
    const end = dialog.getByLabel('Fim');
    const originalStart = await start.inputValue();
    const originalEnd = await end.inputValue();

    // Free later slot (one hour later, ending where the second booking starts).
    await start.fill(shift(originalStart, 1));
    await end.fill(shift(originalEnd, 1));
    await dialog.getByRole('button', { name: 'Salvar horário' }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('row').filter({ hasText: unique }).first(),
    ).toContainText(`${shift(originalStart, 1)}–${shift(originalEnd, 1)}`);

    // Move onto the slot occupied by the second booking.
    await page
      .getByRole('row')
      .filter({ hasText: unique })
      .first()
      .getByRole('button', { name: 'Abrir' })
      .click();
    await start.fill(shift(originalStart, 2));
    await end.fill(shift(originalEnd, 2));
    await dialog.getByRole('button', { name: 'Salvar horário' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(
      'Este horário não está mais disponível. Escolha outro horário.',
    );
  } finally {
    for (const created of [first, second])
      await api(
        page,
        `/reservations/${created.body.data.reservationId}/cancel`,
        {
          method: 'POST',
        },
      );
    await api(page, `/customers/${customerId}/archive`, { method: 'POST' });
  }
});
