import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { dynamo } from '../../apps/api/src/db.js';
import { phase2Keys } from '../../apps/api/src/persistence/phase2-keys.js';
import { login } from './support/auth.js';

test('staff can inspect and fulfill an actionable court waitlist', async ({
  page,
}) => {
  const repo = dynamo();
  const waitlistId = randomUUID();
  const joinedAt = new Date().toISOString();
  const seed = Number.parseInt(waitlistId.slice(0, 8), 16);
  const desiredDate = new Date(Date.UTC(2099, 0, 5 + (seed % 300)))
    .toISOString()
    .slice(0, 10);
  const desiredStartTime = `${String(8 + (Math.floor(seed / 300) % 14)).padStart(2, '0')}:${seed % 2 ? '30' : '00'}`;
  const source = {
    ...phase2Keys.waitlist(waitlistId),
    entity: 'waitlist' as const,
    waitlistId,
    organizationId: 'seed-org',
    customerId: 'seed-customer-1',
    type: 'COURT_SLOT' as const,
    courtId: 'seed-court-2',
    desiredDate,
    desiredStartTime,
    durationMinutes: 60,
    status: 'ACTIVE' as const,
    joinedAt,
  };
  await repo.put(source);
  await repo.put({
    ...source,
    ...phase2Keys.organizationWaitlist('seed-org', joinedAt, waitlistId),
  });
  await repo.put({
    ...source,
    ...phase2Keys.courtWaitlist(
      'seed-org',
      'seed-court-2',
      desiredDate,
      desiredStartTime,
      joinedAt,
      waitlistId,
    ),
  });
  await repo.put({
    ...source,
    ...phase2Keys.customerWaitlist(
      'seed-org',
      'seed-customer-1',
      joinedAt,
      waitlistId,
    ),
  });
  await repo.put({
    ...source,
    ...phase2Keys.customerWaitlistIdentity(
      'seed-org',
      'seed-customer-1',
      `COURT_SLOT#seed-court-2#${desiredDate}#${desiredStartTime}#60`,
    ),
  });

  await login(page);
  await page.goto('/waitlists');
  await expect(
    page.getByRole('heading', { name: 'Listas de espera' }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Customer 1' }).first(),
  ).toBeVisible();
  await expect(page.getByText('Disponível agora').first()).toBeVisible();
  await page
    .locator('tr')
    .filter({ hasText: `${desiredDate} ${desiredStartTime}` })
    .getByRole('button', { name: 'Criar reserva' })
    .click();
  await expect(page.getByText('Reserva criada.')).toBeVisible();
  await expect(page.getByText('Atendida').first()).toBeVisible();
});
