import { expect, type Page } from '@playwright/test';

export async function waitForBookingForm(page: Page) {
  await expect(page.locator('#portal-booking-form')).toBeVisible();
  await expect(page.locator('select[name="durationMinutes"]')).not.toHaveValue(
    '',
  );
  await expect(page.locator('#portal-booking-slots')).not.toHaveText(
    /Loading availability/,
  );
}

export async function findAvailability(page: Page, date: string) {
  await waitForBookingForm(page);
  await page.locator('input[name="date"]').fill(date);
  await page.getByRole('button', { name: 'Find availability' }).click();
  await expect(page.locator('#portal-booking-slots')).not.toHaveText(
    /Choose date and duration|Loading availability/,
  );
}

export async function selectFirstSlot(page: Page) {
  const slot = page.locator('input[name="slot"]').first();
  await expect(slot).toBeVisible();
  await slot.check();
  return slot;
}

export async function bookFirstAvailableSlot(
  page: Page,
  date: string,
  confirmLabel: 'Confirm booking' | 'Send booking request',
) {
  await findAvailability(page, date);
  await selectFirstSlot(page);
  await page.getByRole('button', { name: confirmLabel }).click();
}
