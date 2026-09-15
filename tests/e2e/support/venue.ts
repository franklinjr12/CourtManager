import { randomUUID } from 'node:crypto';
import type { Browser, Page } from '@playwright/test';

import { dynamo } from '../../../apps/api/src/db.js';
import { hashPassword } from '../../../apps/api/src/security.js';
import { buildServices } from '../../../apps/api/src/services/index.js';

export const apiBase = 'http://localhost:8787';
export const PASSWORD = 'smoke-password';

const WEEKDAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;

export const openingHours = (open = '07:00', close = '23:00') =>
  Object.fromEntries(WEEKDAYS.map((day) => [day, { open, close }]));

export type ReservationMode =
  'STAFF_ONLY' | 'REQUEST_APPROVAL' | 'AUTO_CONFIRM';

export type BookingPolicy = {
  reservationMode: ReservationMode;
  bookAheadDays: number;
  cancellationCutoffHours: number;
  minimumReservationMinutes: number;
  maximumReservationMinutes: number;
  maximumActiveBookings: number;
};

type OwnerContext = {
  organizationId: string;
  userId: string;
  role: 'OWNER';
};

type CourtRecord = { courtId: string; name: string };

export const AUTO_CONFIRM_POLICY: BookingPolicy = {
  reservationMode: 'AUTO_CONFIRM',
  bookAheadDays: 365,
  cancellationCutoffHours: 6,
  minimumReservationMinutes: 60,
  maximumReservationMinutes: 60,
  maximumActiveBookings: 3,
};

export const REQUEST_APPROVAL_POLICY: BookingPolicy = {
  ...AUTO_CONFIRM_POLICY,
  reservationMode: 'REQUEST_APPROVAL',
};

export const STAFF_ONLY_POLICY: BookingPolicy = {
  ...AUTO_CONFIRM_POLICY,
  reservationMode: 'STAFF_ONLY',
};

export type CourtSeed = {
  name?: string;
  sport?: string;
  publiclyRequestable?: boolean;
  slotMinutes?: number;
  defaultHourlyPrice?: number;
  openingHours?: ReturnType<typeof openingHours>;
};

export type IsolatedVenueInput = {
  prefix?: string;
  bookingPolicy?: BookingPolicy;
  timezone?: string;
  features?: { classes?: boolean; finance?: boolean };
  courts?: CourtSeed[];
};

export async function createIsolatedVenue(input: IsolatedVenueInput = {}) {
  const organizationId = randomUUID();
  const slug = `${input.prefix ?? 'p2'}-${organizationId}`;
  const ownerPassword = 'dev-password';
  const ownerEmail = `owner-${organizationId}@phase2.test`;
  const userId = `owner-${organizationId}`;
  const timestamp = new Date().toISOString();
  const repo = dynamo();
  const bookingPolicy = input.bookingPolicy ?? AUTO_CONFIRM_POLICY;
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: 'META',
    entity: 'organization',
    organizationId,
    name: `Phase 2 ${slug}`,
    slug,
    timezone: input.timezone ?? 'UTC',
    currency: 'BRL',
    active: true,
    features: {
      classes: input.features?.classes ?? true,
      finance: input.features?.finance ?? true,
    },
    bookingPolicy,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: `USER#${userId}`,
    entity: 'user',
    userId,
    organizationId,
    name: 'Owner',
    email: ownerEmail,
    role: 'OWNER',
    passwordHash: await hashPassword(ownerPassword),
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const owner: OwnerContext = {
    organizationId,
    userId,
    role: 'OWNER',
  };
  const services = buildServices(repo);
  const courtSeeds = input.courts?.length
    ? input.courts
    : [{ name: `Court ${Date.now()}`, sport: 'Tennis' }];
  const courts = [] as CourtRecord[];
  for (const seed of courtSeeds) {
    courts.push(
      (await services.courts.create(owner, {
        name: seed.name ?? `Court ${Date.now()}`,
        sport: seed.sport ?? 'Tennis',
        slotMinutes: seed.slotMinutes ?? 30,
        defaultHourlyPrice: seed.defaultHourlyPrice ?? 80,
        publiclyRequestable: seed.publiclyRequestable ?? true,
        active: true,
        openingHours: seed.openingHours ?? openingHours(),
      })) as CourtRecord,
    );
  }
  return {
    repo,
    services,
    organizationId,
    slug,
    owner,
    ownerEmail,
    ownerPassword,
    court: courts[0]!,
    courts,
    bookingPolicy,
  };
}

export async function addOwnerLogin(
  organizationId: string,
  userId: string,
  email: string,
  password = 'dev-password',
) {
  const timestamp = new Date().toISOString();
  await dynamo().put({
    PK: `ORG#${organizationId}`,
    SK: `USER#${userId}`,
    entity: 'user',
    userId,
    organizationId,
    name: 'Owner',
    email,
    role: 'OWNER',
    passwordHash: await hashPassword(password),
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return { email, password };
}

export function futureDate(days = 7) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Seeds an isolated UTC venue with one public court and its own owner, so
 * policy changes and bookings never collide with other specs or seed data.
 */
export async function seedVenue(reservationMode: ReservationMode) {
  const repo = dynamo();
  const services = buildServices(repo);
  const organizationId = randomUUID();
  const slug = `smoke-${organizationId}`;
  const owner = {
    organizationId,
    userId: `owner-${organizationId}`,
    role: 'OWNER' as const,
  };
  const ownerEmail = `owner-${organizationId}@smoke.test`;
  const timestamp = new Date().toISOString();
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: 'META',
    entity: 'organization',
    organizationId,
    name: `Smoke Arena ${organizationId.slice(0, 6)}`,
    slug,
    timezone: 'UTC',
    currency: 'BRL',
    active: true,
    features: { classes: true, finance: true },
    bookingPolicy: {
      reservationMode,
      bookAheadDays: 60,
      cancellationCutoffHours: 6,
      minimumReservationMinutes: 60,
      maximumReservationMinutes: 60,
      maximumActiveBookings: 3,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: `USER#${owner.userId}`,
    entity: 'user',
    organizationId,
    userId: owner.userId,
    role: 'OWNER',
    name: 'Smoke Owner',
    email: ownerEmail,
    passwordHash: await hashPassword(PASSWORD),
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: 'USER#coach',
    entity: 'user',
    organizationId,
    userId: 'coach',
    role: 'COACH',
    name: 'Coach Smoke',
    email: `coach-${organizationId}@smoke.test`,
    passwordHash: 'unused',
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const court = await services.courts.create(owner, {
    name: `Smoke Court ${organizationId.slice(0, 6)}`,
    sport: 'Tennis',
    slotMinutes: 30,
    defaultHourlyPrice: 80,
    publiclyRequestable: true,
    active: true,
    openingHours: openingHours(),
  });
  let sequence = 0;
  const registerCustomer = async (name = 'Smoke Customer') => {
    sequence += 1;
    const email = `customer-${sequence}-${organizationId}@smoke.test`;
    const registered = await services.customerAccounts.register(slug, {
      name: `${name} ${sequence}`,
      email,
      phone: `9${Date.now().toString().slice(-8)}${sequence}`,
      password: PASSWORD,
    });
    return {
      email,
      name: `${name} ${sequence}`,
      customerId: String(registered.customer.customerId),
    };
  };
  return {
    repo,
    services,
    organizationId,
    slug,
    owner,
    ownerEmail,
    courtId: String(court.courtId),
    registerCustomer,
  };
}

export type SmokeVenue = Awaited<ReturnType<typeof seedVenue>>;

export async function useEnglish(page: Page) {
  await page.goto('/login');
  await page.evaluate(() =>
    localStorage.setItem('court-manager-locale', 'en-US'),
  );
}

export async function customerSignIn(page: Page, slug: string, email: string) {
  await useEnglish(page);
  await page.goto(`/portal/${slug}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('navigation', { name: 'Customer navigation' }).waitFor();
}

export async function staffSignIn(
  page: Page,
  email: string,
  password = PASSWORD,
) {
  await useEnglish(page);
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/today|dashboard/);
}

/** A second, fully separate browser session (its own storage). */
export async function newPage(browser: Browser) {
  const context = await browser.newContext({
    baseURL: 'http://localhost:5173',
  });
  return context.newPage();
}

export const dateAhead = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export async function customerToken(slug: string, email: string) {
  const response = await fetch(`${apiBase}/customer-auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, email, password: PASSWORD }),
  });
  return ((await response.json()) as { data: { token: string } }).data.token;
}

export async function apiAs(
  token: string,
  path: string,
  init: RequestInit = {},
) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  return {
    status: response.status,
    body: (await response.json().catch(() => ({}))) as Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  };
}

/** Opens Book, searches a date, and selects the first slot offered. */
export async function selectFirstSlot(page: Page, slug: string, date: string) {
  await page.goto(`/portal/${slug}/book`);
  const duration = page.locator('select[name="durationMinutes"]');
  await duration.waitFor({ state: 'attached', timeout: 15000 });
  await duration.selectOption('60');
  await page.locator('input[name="date"]').fill(date);
  await page.getByRole('button', { name: 'Find availability' }).click();
  const slot = page.locator('input[name="slot"]').first();
  await slot.waitFor({ timeout: 15000 });
  await slot.check();
  return slot.inputValue();
}
