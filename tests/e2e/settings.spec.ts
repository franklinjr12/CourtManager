import { expect, test } from '@playwright/test';

import { api } from './support/api.js';
import { login } from './support/auth.js';

test('owner can manage courts from Settings', async ({ page }) => {
  const unique = `PW Court ${Date.now()}`;
  const edited = `${unique} Edited`;
  const sport = `PW Sport ${Date.now()}`;
  await login(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar esporte' }).click();
  const sportDialog = page.getByRole('dialog');
  await sportDialog.getByLabel('Nome').fill(sport);
  await sportDialog.getByRole('button', { name: 'Adicionar esporte' }).click();
  await expect(
    page.locator('.list-row').filter({ hasText: sport }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar quadra' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome').fill(unique);
  await dialog.getByLabel('Esporte').fill('Tennis');
  await dialog.getByRole('button', { name: 'Adicionar quadra' }).click();
  const row = page.locator('.list-row').filter({ hasText: unique });
  await expect(row).toBeVisible();
  const courts = await api(page, '/courts?includeArchived=true');
  const court = courts.body.data.find(
    (item: { name: string }) => item.name === unique,
  );
  expect(court).toBeTruthy();
  await row.getByRole('button', { name: 'Editar' }).click();
  await page.getByRole('dialog').getByLabel('Nome').fill(edited);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Salvar alterações' })
    .click();
  await expect(
    page.locator('.list-row').filter({ hasText: edited }),
  ).toBeVisible();
  page.once('dialog', (dialogEvent) => dialogEvent.accept());
  await page
    .locator('.list-row')
    .filter({ hasText: edited })
    .getByRole('button', { name: 'Arquivar' })
    .click();
  await expect(
    page.locator('.list-row').filter({ hasText: edited }).getByText('Arquivado'),
  ).toBeVisible();
  await page
    .locator('.list-row')
    .filter({ hasText: edited })
    .getByRole('button', { name: 'Restaurar' })
    .click();
  await expect(
    page.locator('.list-row').filter({ hasText: edited }).getByText('Ativo'),
  ).toBeVisible();
  page.once('dialog', (dialogEvent) => dialogEvent.accept());
  await page
    .locator('.list-row')
    .filter({ hasText: edited })
    .getByRole('button', { name: 'Arquivar' })
    .click();
  await expect(
    page.locator('.list-row').filter({ hasText: edited }).getByText('Arquivado'),
  ).toBeVisible();
  if (court)
    expect((await api(page, `/courts/${court.courtId}`)).status).toBe(404);
});
