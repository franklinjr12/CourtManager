import type { Page } from '@playwright/test';

export async function useEnglish(page: Page) {
  await page.goto('/login');
  await page.evaluate(() =>
    localStorage.setItem('court-manager-locale', 'en-US'),
  );
}
