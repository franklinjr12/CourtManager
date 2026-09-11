import { expect, test } from '@playwright/test';

import { api, apiBase } from './support/api.js';
import { login } from './support/auth.js';

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
  await expect(
    page.locator('select[name="time"] option').first(),
  ).not.toHaveText('Carregando…');
  await page.locator('input[name="customerName"]').fill(unique);
  await page.locator('input[name="phone"]').fill('41999997777');
  await page.getByRole('button', { name: 'Enviar solicitação' }).click();
  await expect(page.locator('#public-result')).toHaveText(
    /Solicitação enviada/,
  );

  await page.goto('/requests');
  const requestRow = page.locator('tr').filter({ hasText: unique });
  await expect(requestRow).toBeVisible();
  await requestRow.getByRole('button', { name: 'Confirmar' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirmar solicitação' })
    .click();
  await expect(requestRow).toContainText('Confirmada');
  const requestData = await api(page, '/requests');
  const confirmed = requestData.body.data.find(
    (item: {
      customerName: string;
      linkedCustomerId?: string;
      linkedReservationId?: string;
    }) => item.customerName === unique,
  );
  expect(confirmed?.linkedCustomerId).toBeTruthy();
  expect(confirmed?.linkedReservationId).toBeTruthy();
  if (!confirmed?.linkedCustomerId || !confirmed.linkedReservationId)
    throw new Error('Confirmed request did not return linked records.');

  const pending = await api(
    page,
    `/reservations/${confirmed.linkedReservationId}`,
  );
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
  const paid = await api(
    page,
    `/reservations/${confirmed.linkedReservationId}`,
  );
  expect(paid.body.data.paymentStatus).toBe('PAID');
  expect(
    (
      await api(
        page,
        `/reservations/${confirmed.linkedReservationId}/check-in`,
        { method: 'POST' },
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await api(
        page,
        `/reservations/${confirmed.linkedReservationId}/complete`,
        {
          method: 'POST',
        },
      )
    ).status,
  ).toBe(200);
  const scheduleData = await api(page, `/schedule?date=${date}`);
  expect(
    scheduleData.body.data.items.some(
      (item: { reservationId?: string; status?: string }) =>
        item.reservationId === confirmed.linkedReservationId &&
        item.status === 'COMPLETED',
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
  await rejectedRow.getByRole('button', { name: 'Recusar' }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Motivo')
    .fill('No availability after review.');
  page.once('dialog', (dialogEvent) => dialogEvent.accept());
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Recusar solicitação' })
    .click();
  await expect(rejectedRow).toContainText('Recusada');
  await page.goto(`/customers?search=${encodeURIComponent(unique)}`);
  await expect(page.locator('tr').filter({ hasText: unique })).toBeVisible();
  await page
    .locator('tr')
    .filter({ hasText: unique })
    .getByRole('button', { name: 'Histórico' })
    .click();
  await expect(page.getByRole('dialog')).toContainText('Concluída');
});
