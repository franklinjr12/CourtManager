import { expect, test } from '@playwright/test';

import { api } from './support/api.js';
import { login, loginCustomer, registerCustomer } from './support/auth.js';
import {
  PORTAL_PASSWORD,
  tokenFromLink,
  uniqueEmail,
  uniqueName,
  uniquePhone,
} from './support/identity.js';
import { useEnglish } from './support/locale.js';
import { AUTO_CONFIRM_POLICY, createIsolatedVenue } from './support/venue.js';

test('customer can log out and sign in again', async ({ page }) => {
  await useEnglish(page);
  const venue = await createIsolatedVenue({
    bookingPolicy: AUTO_CONFIRM_POLICY,
  });
  const email = uniqueEmail('lifecycle');
  const name = uniqueName('Lifecycle Customer');
  await registerCustomer(page, venue.slug, {
    name,
    email,
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  await expect(page.locator('#portal-result')).toHaveText(/Account created/);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PORTAL_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: name })).toBeVisible();
  await page.locator('#portal-logout').click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PORTAL_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: name })).toBeVisible();
});

test('staff activation and reset links work once and reject reuse or expiry', async ({
  page,
}) => {
  await useEnglish(page);
  const venue = await createIsolatedVenue({
    prefix: 'activate',
    bookingPolicy: AUTO_CONFIRM_POLICY,
  });
  await login(page, {
    email: venue.ownerEmail,
    password: venue.ownerPassword,
  });
  const name = uniqueName('Staff Created');
  const email = uniqueEmail('staff-created');
  const created = await api(page, '/customers', {
    method: 'POST',
    body: JSON.stringify({
      name,
      email,
      phone: uniquePhone(),
    }),
  });
  expect(created.status).toBe(201);
  const customerId = created.body.data.customerId as string;
  await page.goto(`/customers/${customerId}`);
  const activation = page.waitForResponse(
    (response) =>
      response.url().includes('/portal-access') &&
      response.request().method() === 'POST',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Enable portal access' }).click();
  const activationBody = (await (await activation).json()) as {
    data: { link: string };
  };
  const activationToken = tokenFromLink(activationBody.data.link);
  expect(activationToken).toBeTruthy();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await page.goto(`/portal/${venue.slug}/activate?token=${activationToken}`);
  await page.getByLabel('Password').fill(PORTAL_PASSWORD);
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(page.locator('#portal-result')).toHaveText(/Password set/);
  await page.goto(`/portal/${venue.slug}/activate?token=${activationToken}`);
  await page.getByLabel('Password').fill('other-password');
  const reused = page.waitForResponse((response) =>
    response.url().includes('/portal/activate'),
  );
  await page.getByRole('button', { name: 'Set password' }).click();
  expect((await reused).status()).toBe(401);
  await expect(
    page.getByRole('navigation', { name: 'Customer navigation' }),
  ).toHaveCount(0);
  await login(page, {
    email: venue.ownerEmail,
    password: venue.ownerPassword,
  });
  const reset = page.waitForResponse(
    (response) =>
      response.url().includes('/portal-reset') &&
      response.request().method() === 'POST',
  );
  await page.goto(`/customers/${customerId}`);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Reset portal password' }).click();
  const resetBody = (await (await reset).json()) as {
    data: { link: string };
  };
  const token = new URL(
    resetBody.data.link,
    'http://localhost:5173',
  ).searchParams.get('token');
  const tokenRecord = (
    await venue.repo.query(`ORG#${venue.organizationId}`, {
      beginsWith: 'CUSTOMER_ACCOUNT_TOKEN#',
    })
  ).find((item) => item.type === 'RESET');
  expect(tokenRecord).toBeTruthy();
  await venue.repo.put({ ...tokenRecord!, expiresAt: 1 });
  await page.goto(`/portal/${venue.slug}/reset-password?token=${token}`);
  await page.getByLabel('Password').fill('fresh-password');
  const expired = page.waitForResponse((response) =>
    response.url().includes('/portal/reset-password'),
  );
  await page.getByRole('button', { name: 'Set password' }).click();
  expect((await expired).status()).toBe(401);
  await expect(
    page.getByRole('navigation', { name: 'Customer navigation' }),
  ).toHaveCount(0);
});

test('disabled accounts cannot sign in and the same email is venue-scoped', async ({
  page,
}) => {
  await useEnglish(page);
  const first = await createIsolatedVenue({
    prefix: 'email-one',
    bookingPolicy: AUTO_CONFIRM_POLICY,
  });
  const second = await createIsolatedVenue({
    prefix: 'email-two',
    bookingPolicy: AUTO_CONFIRM_POLICY,
  });
  const email = uniqueEmail('shared');
  const firstName = uniqueName('Venue One');
  const secondName = uniqueName('Venue Two');
  await first.services.customerAccounts.register(first.slug, {
    name: firstName,
    email,
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  await second.services.customerAccounts.register(second.slug, {
    name: secondName,
    email,
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  await loginCustomer(page, first.slug, email, PORTAL_PASSWORD);
  await expect(page.getByRole('heading', { name: firstName })).toBeVisible();
  await loginCustomer(page, second.slug, email, PORTAL_PASSWORD);
  await expect(page.getByRole('heading', { name: secondName })).toBeVisible();
  const disabledEmail = uniqueEmail('disabled');
  const disabled = await first.services.customerAccounts.register(first.slug, {
    name: uniqueName('Disabled'),
    email: disabledEmail,
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  const account = await first.repo.get({
    PK: `ORG#${first.organizationId}`,
    SK: `CUSTOMER_ACCOUNT#${disabled.account.customerAccountId}`,
  });
  await first.repo.put({ ...account!, status: 'DISABLED' });
  await page.goto(`/portal/${first.slug}/login`);
  await expect(page.locator('#portal-login-form')).toBeVisible();
  const loginResponse = page.waitForResponse((response) =>
    response.url().includes('/customer-auth/login'),
  );
  await page
    .locator('#portal-login-form')
    .getByLabel('Email')
    .fill(disabledEmail);
  await page
    .locator('#portal-login-form')
    .getByLabel('Password')
    .fill(PORTAL_PASSWORD);
  await page
    .locator('#portal-login-form')
    .getByRole('button', { name: 'Sign in', exact: true })
    .click();
  expect((await loginResponse).status()).toBe(401);
  await expect(
    page.getByRole('navigation', { name: 'Customer navigation' }),
  ).toHaveCount(0);
});

test('staff and customer sessions coexist in the same browser', async ({
  page,
}) => {
  await useEnglish(page);
  const venue = await createIsolatedVenue({
    prefix: 'sessions',
    bookingPolicy: AUTO_CONFIRM_POLICY,
  });
  const email = uniqueEmail('coexist');
  await venue.services.customerAccounts.register(venue.slug, {
    name: uniqueName('Coexist'),
    email,
    phone: uniquePhone(),
    password: PORTAL_PASSWORD,
  });
  await login(page, {
    email: venue.ownerEmail,
    password: venue.ownerPassword,
  });
  await loginCustomer(page, venue.slug, email, PORTAL_PASSWORD);
  const stored = await page.evaluate(() => ({
    staff: Boolean(localStorage.getItem('court-manager-session')),
    customer: Boolean(localStorage.getItem('court-manager-customer-session')),
  }));
  expect(stored).toEqual({ staff: true, customer: true });
  await page.goto('/today');
  await expect(page.getByRole('heading', { name: /Today/ })).toBeVisible();
  await page.goto(`/portal/${venue.slug}`);
  await expect(
    page.getByRole('navigation', { name: 'Customer navigation' }),
  ).toBeVisible();
});
