import { expect, test } from '@playwright/test';

import { login } from './support/auth.js';

test('mobile schedule keeps actions usable and modal closes with Escape', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto('/schedule');
  await expect(
    page.getByRole('button', { name: 'New reservation' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'New reservation' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
