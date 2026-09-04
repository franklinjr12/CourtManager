import { test, expect } from '@playwright/test';
test('login screen is keyboard accessible',async({page})=>{await page.goto('/login');await expect(page.getByLabel('Email')).toBeVisible();await expect(page.getByLabel('Password')).toBeVisible();await page.getByLabel('Email').fill('owner@example.test');await page.getByLabel('Password').fill('wrong');});
