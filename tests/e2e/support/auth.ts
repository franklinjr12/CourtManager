import { expect, type Page } from '@playwright/test';

const defaultCredentials = {
  email: 'owner@arena.test',
  password: 'dev-password',
};

export async function login(
  page: Page,
  credentials: { email: string; password: string } = defaultCredentials,
) {
  await page.goto('/login');
  const locale = await page.locator('[data-language-selector]').inputValue();
  await page
    .getByLabel(locale === 'en-US' ? 'Email' : 'E-mail')
    .fill(credentials.email);
  await page
    .getByLabel(locale === 'en-US' ? 'Password' : 'Senha')
    .fill(credentials.password);
  await page
    .getByRole('button', { name: locale === 'en-US' ? 'Sign in' : 'Entrar' })
    .click();
  await page.waitForURL(/today|dashboard/);
}

export async function registerCustomer(
  page: Page,
  slug: string,
  input: { name: string; email: string; phone: string; password: string },
) {
  await page.goto(`/portal/${slug}/register`);
  await page.getByLabel('Name').fill(input.name);
  await page.getByLabel('Email').fill(input.email);
  await page.getByLabel('Phone').fill(input.phone);
  await page.getByLabel('Password').fill(input.password);
  await page.getByRole('button', { name: 'Register' }).click();
}

export async function loginCustomer(
  page: Page,
  slug: string,
  email: string,
  password: string,
) {
  await page.goto(`/portal/${slug}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('navigation', { name: 'Customer navigation' }),
  ).toBeVisible();
}
