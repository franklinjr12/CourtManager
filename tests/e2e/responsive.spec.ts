import { expect, test } from '@playwright/test';

import { dynamo } from '../../apps/api/src/db.js';
import { classFixture } from '../../apps/api/src/testing/class-fixture.js';
import { login, loginCustomer } from './support/auth.js';
import { useEnglish } from './support/locale.js';

test('mobile schedule keeps actions usable and modal closes with Escape', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto('/schedule');
  await expect(
    page.getByRole('button', { name: 'Nova reserva' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Nova reserva' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('mobile customer portal keeps navigation and booking form usable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { slug } = await classFixture(dynamo());
  await useEnglish(page);
  await loginCustomer(page, slug, 'ana@example.test', 'class-password');
  await expect(
    page.getByRole('navigation', { name: 'Customer navigation' }),
  ).toBeVisible();
  const fitsViewport = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(fitsViewport).toBe(true);
  await page.getByRole('link', { name: 'Book', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Book a court' }),
  ).toBeVisible();
  await expect(page.locator('#portal-booking-form')).toBeVisible();
});
