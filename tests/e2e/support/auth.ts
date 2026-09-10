import type { Page } from '@playwright/test';

const credentials = { email: 'owner@arena.test', password: 'dev-password' };

export async function login(page: Page) {
  await page.goto('/login');
  const locale = await page.locator('[data-language-selector]').inputValue();
  await page.getByLabel(locale === 'en-US' ? 'Email' : 'E-mail').fill(credentials.email);
  await page.getByLabel(locale === 'en-US' ? 'Password' : 'Senha').fill(credentials.password);
  await page.getByRole('button', { name: locale === 'en-US' ? 'Sign in' : 'Entrar' }).click();
  await page.waitForURL(/dashboard/);
}
