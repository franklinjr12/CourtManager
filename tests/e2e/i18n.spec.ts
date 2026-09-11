import { expect, test } from '@playwright/test';

import { api } from './support/api.js';
import { login } from './support/auth.js';

test('Portuguese is the default language and can switch to English', async ({
  page,
}) => {
  await page.goto('/login');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(
    page.getByText('Entre para gerenciar suas quadras.'),
  ).toBeVisible();
  await expect(page.getByLabel('Senha')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');

  await page.getByLabel('Idioma').selectOption('en-US');
  await expect(page.getByText('Sign in to manage your courts.')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
});

test('language preference persists across reload and authenticated navigation', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Idioma').selectOption('en-US');
  await page.reload();
  await expect(page.getByText('Sign in to manage your courts.')).toBeVisible();
  await expect(page.locator('[data-language-selector]')).toHaveValue('en-US');

  await login(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.locator('[data-language-selector]')).toHaveValue('en-US');
});

test('public booking exposes the persisted language selector', async ({
  page,
}) => {
  await login(page);
  const organization = await api(page, '/organization');
  await page.evaluate(() => localStorage.removeItem('court-manager-locale'));
  await page.goto(`/book/${organization.body.data.slug}`);
  await expect(page.getByText('Solicitar reserva de quadra')).toBeVisible({
    timeout: 10000,
  });
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await page.getByLabel('Idioma').selectOption('en-US');
  await expect(page.getByText('Request a court reservation')).toBeVisible();
  await expect(page.locator('[data-language-selector]')).toHaveValue('en-US');
});
