import { expect, test } from '@playwright/test';

import { login } from './support/auth.js';

test('owner operational screens expose workflows instead of placeholders', async ({
  page,
}) => {
  await login(page);
  await page.goto('/today');
  await expect(page.getByRole('heading', { name: /Hoje/ })).toBeVisible();
  await page.goto('/schedule');
  await expect(
    page.getByRole('button', { name: 'Nova reserva' }),
  ).toBeVisible();
  await page.goto('/waitlists');
  await expect(
    page.getByRole('heading', { name: 'Listas de espera' }),
  ).toBeVisible();
  await page.goto('/settings');
  await expect(
    page.getByText('Use the API or add courts through the settings workflow.'),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Adicionar quadra' }),
  ).toBeVisible();
  await page.goto('/customers');
  await expect(
    page.getByRole('button', { name: 'Adicionar cliente' }),
  ).toBeVisible();
  await page.goto('/reservations');
  await expect(
    page.getByRole('button', { name: 'Nova reserva' }),
  ).toBeVisible();
  await page.goto('/requests');
  await expect(
    page.getByRole('heading', { name: 'Solicitações de reserva' }),
  ).toBeVisible();
  await page.goto('/finance');
  await expect(
    page.getByRole('button', { name: 'Registrar pagamento' }),
  ).toBeVisible();
  await page.goto('/commercial');
  await expect(
    page.getByRole('heading', { name: /Visao geral|Visão geral/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Mensalidades', exact: true }),
  ).toBeVisible();
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Relatórios' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Relatório comercial' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Aplicar filtros' }),
  ).toBeVisible();
  await page.goto('/classes');
  await expect(page.getByRole('heading', { name: 'Aulas' })).toBeVisible();
});
