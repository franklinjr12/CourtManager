import { expect, test } from '@playwright/test';

import { api } from './support/api.js';
import { login } from './support/auth.js';

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
  const created = await api(page, '/reservations', {
    method: 'POST',
    body: JSON.stringify(reservationInput),
  });
  expect(created.status).toBe(201);
  expect(
    (
      await api(page, '/reservations', {
        method: 'POST',
        body: JSON.stringify(reservationInput),
      })
    ).status,
  ).toBe(409);
  const createdReservationId = created.body.data.reservationId as string;
  expect(
    (
      await api(page, `/reservations/${createdReservationId}/no-show`, {
        method: 'POST',
      })
    ).status,
  ).toBe(200);
  const historicalSchedule = await api(page, `/schedule?date=${base}`);
  expect(
    historicalSchedule.body.data.items.some(
      (item: { reservationId?: string; status?: string }) =>
        item.reservationId === createdReservationId &&
        item.status === 'NO_SHOW',
    ),
  ).toBe(true);
  const recurring = await api(page, '/reservations/recurring', {
    method: 'POST',
    body: JSON.stringify({
      ...reservationInput,
      startAt: `${new Date(new Date(`${base}T00:00:00Z`).getTime() + 14 * 86400000).toISOString().slice(0, 10)}T21:00:00Z`,
      endAt: `${new Date(new Date(`${base}T00:00:00Z`).getTime() + 14 * 86400000).toISOString().slice(0, 10)}T22:00:00Z`,
      untilDate: new Date(
        new Date(`${base}T00:00:00Z`).getTime() + 63 * 86400000,
      )
        .toISOString()
        .slice(0, 10),
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
