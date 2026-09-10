import { expect, test } from '@playwright/test';

test('login screen is keyboard accessible', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByLabel('E-mail')).toBeVisible();
  await expect(page.getByLabel('Senha')).toBeVisible();
  await page.getByLabel('E-mail').fill('owner@example.test');
  await page.getByLabel('Senha').fill('wrong');
});
