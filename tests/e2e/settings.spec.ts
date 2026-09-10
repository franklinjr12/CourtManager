import { expect, test } from '@playwright/test';

import { api } from './support/api.js';
import { login } from './support/auth.js';

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
  await expect(
    page.locator('.list-row').filter({ hasText: sport }),
  ).toBeVisible();
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
