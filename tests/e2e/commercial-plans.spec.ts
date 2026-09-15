import { expect, test } from '@playwright/test';
import { login } from './support/auth.js';

test('staff can create and review a commercial plan with multiple benefits', async ({
  page,
}) => {
  await login(page);
  await page.goto('/commercial/plans');
  await expect(
    page.getByRole('heading', { name: 'Planos comerciais' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar plano' }).click();
  await page
    .getByRole('textbox', { name: 'Nome', exact: true })
    .fill('Plano E2E');
  await page
    .getByRole('spinbutton', { name: 'Preço', exact: true })
    .fill('280');
  await expect(page.getByRole('heading', { name: 'Beneficios' })).toBeVisible();
  await page
    .locator('[data-benefit-row]')
    .first()
    .locator('[data-benefit-field="quantity"]')
    .fill('240');
  await page.getByRole('button', { name: 'Adicionar beneficio' }).click();
  await expect(page.locator('[data-benefit-row]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Criar plano' }).click();
  await expect(page.getByText('Plano E2E')).toBeVisible();
  await expect(page.getByText('240 minutos de quadra')).toBeVisible();
});
