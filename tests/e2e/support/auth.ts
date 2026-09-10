import type { Page } from '@playwright/test';

const credentials = { email: 'owner@arena.test', password: 'dev-password' };

export async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(credentials.email);
  await page.getByLabel('Password').fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/dashboard/);
}
