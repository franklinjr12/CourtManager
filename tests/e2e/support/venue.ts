import { randomUUID } from 'node:crypto';

import { dynamo } from '../../../apps/api/src/db.js';
import { hashPassword } from '../../../apps/api/src/security.js';
import { buildServices } from '../../../apps/api/src/services/index.js';

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

export type BookingPolicy = {
  reservationMode: 'STAFF_ONLY' | 'REQUEST_APPROVAL' | 'AUTO_CONFIRM';
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
