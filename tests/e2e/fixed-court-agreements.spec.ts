import { expect, test } from '@playwright/test';
import { login } from './support/auth.js';

test('staff can create and inspect a fixed recurring court agreement', async ({
  page,
}) => {
  await login(page);
  await page.goto('/commercial/fixed-courts');
  await expect(
    page.getByRole('heading', { name: 'Acordos de quadra fixa' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Adicionar acordo de quadra fixa' })
    .click();
  await page.getByLabel('Cliente').selectOption({ index: 0 });
  await page.getByLabel('Quadra').selectOption({ index: 0 });
  await page.getByLabel('Dia da semana').selectOption('WEDNESDAY');
  await page.getByLabel('Horário de início').fill('19:00');
  await page.getByLabel('Início').fill('2027-01-06');
  await page.getByLabel('Fim').fill('2027-01-20');
  await page.getByLabel('Preço').fill('600');
  await page.getByRole('button', { name: 'Criar acordo' }).click();
  await expect(page.getByText('Acordo de quadra fixa criado.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Detalhes' })).toBeVisible();
  await page.getByRole('button', { name: 'Detalhes' }).click();
  await expect(
    page.getByRole('heading', { name: 'Detalhes do acordo' }),
  ).toBeVisible();
  await expect(page.getByText('06/01/2027')).toBeVisible();
});
