import { randomUUID } from 'node:crypto';
import type { AuthContext, PlanBenefit } from '@court-manager/contracts';
import { DEFAULT_BOOKING_POLICY } from '@court-manager/contracts';
import { MemoryRepository } from '../db.js';
import { createApp } from '../app.js';
import { hashPassword } from '../security.js';
import { buildServices } from '../services/index.js';
import { call, openingHours, type Api } from './journey-fixture.js';

export const PASSWORD = 'phase3-fixture-password';

export const fixedInstant = (iso: string) => iso;

export const localDate = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

export const nextLocalWeek = (from: string) => {
  const value = new Date(`${from}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 7);
  return value.toISOString().slice(0, 10);
};

export const membershipPeriod = (startDate: string, endDate: string) => ({
  startDate,
  endDate,
});

export type CommercialVenue = Awaited<ReturnType<typeof createCommercialVenue>>;

export async function createCommercialVenue(input?: {
  label?: string;
  timezone?: string;
  currency?: string;
}) {
  const organizationId = randomUUID();
  const label = input?.label ?? 'commercial';
  const slug = `${label}-${organizationId.slice(0, 8)}`;
  const ownerId = `owner-${organizationId}`;
  const ownerEmail = `${ownerId}@phase3.test`;
  const timestamp = '2026-09-01T00:00:00.000Z';
  const repo = new MemoryRepository();
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: 'META',
    entity: 'organization',
    organizationId,
    name: `${label} arena`,
    slug,
    timezone: input?.timezone ?? 'UTC',
    currency: input?.currency ?? 'BRL',
    active: true,
    features: { classes: true, finance: true },
    bookingPolicy: { ...DEFAULT_BOOKING_POLICY, bookAheadDays: 365 },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: `USER#${ownerId}`,
    entity: 'user',
    organizationId,
    userId: ownerId,
    role: 'OWNER',
    name: 'Commercial Owner',
    email: ownerEmail,
    passwordHash: await hashPassword(PASSWORD),
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: 'USER#staff',
    entity: 'user',
    organizationId,
    userId: 'staff',
    role: 'STAFF',
    name: 'Commercial Staff',
    email: `staff-${organizationId}@phase3.test`,
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
    name: 'Commercial Coach',
    email: `coach-${organizationId}@phase3.test`,
    passwordHash: await hashPassword(PASSWORD),
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const owner: AuthContext = {
    organizationId,
    userId: ownerId,
    role: 'OWNER',
  };
  const staff: AuthContext = {
    organizationId,
    userId: 'staff',
    role: 'STAFF',
  };
  const coach: AuthContext = {
    organizationId,
    userId: 'coach',
    role: 'COACH',
  };
  const services = buildServices(repo);
  const app = createApp(repo);
  const court = await services.courts.create(owner, {
    name: `${label} Court`,
    sport: 'Tennis',
    slotMinutes: 30,
    defaultHourlyPrice: 80,
    publiclyRequestable: true,
    active: true,
    openingHours: openingHours(),
  });
  let customerSequence = 0;
  const createCustomer = async (name?: string) => {
    customerSequence += 1;
    return services.customers.create(owner, {
      name: name ?? `Customer ${customerSequence}`,
      phone: `4198888${String(customerSequence).padStart(4, '0')}`,
    });
  };
  const staffToken = async () => {
    const response = await call<{ data: { token: string } }>(
      app,
      'POST',
      '/auth/login',
      undefined,
      { email: ownerEmail, password: PASSWORD },
    );
    if (response.status !== 200)
      throw new Error(`Staff login failed: ${JSON.stringify(response.body)}`);
    return response.body.data.token;
  };
  return {
    repo,
    app,
    services,
    owner,
    staff,
    coach,
    organizationId,
    slug,
    ownerEmail,
    courtId: String(court.courtId),
    createCustomer,
    staffToken,
    call: <T = unknown>(
      method: string,
      path: string,
      token?: string,
      body?: unknown,
    ) => call<T>(app, method, path, token, body),
  };
}

export async function createMonthlyClassMembership(
  venue: CommercialVenue,
  input?: {
    customerId?: string;
    classesPerMonth?: number;
    price?: number;
    startDate?: string;
    planName?: string;
  },
) {
  const customerId =
    input?.customerId ??
    String((await venue.createCustomer('Class member')).customerId);
  const benefit: PlanBenefit = {
    type: 'CLASS_ATTENDANCE',
    period: 'MONTH',
    quantityType: 'FINITE',
    quantity: input?.classesPerMonth ?? 8,
    unit: 'SESSION',
  };
  const plan = await venue.services.plans.create(venue.owner, {
    name: input?.planName ?? '8 Classes / Month',
    basePrice: input?.price ?? 280,
    billingInterval: 'MONTHLY',
    benefits: [benefit],
  });
  const membership = await venue.services.memberships.create(venue.owner, {
    customerId,
    planId: plan.planId,
    startDate: input?.startDate ?? '2026-09-01',
    price: input?.price ?? 280,
  });
  return { customerId, plan, membership, benefit };
}

export async function createCourtMinutesPackage(
  venue: CommercialVenue,
  input?: {
    minutes?: number;
    price?: number;
    validityDays?: number;
    name?: string;
  },
) {
  return venue.services.packages.createDefinition(venue.owner, {
    name: input?.name ?? 'Court hours package',
    price: input?.price ?? 240,
    validityDays: input?.validityDays ?? 90,
    benefits: [
      {
        type: 'COURT_TIME',
        period: 'PACKAGE_LIFETIME',
        quantityType: 'FINITE',
        quantity: input?.minutes ?? 600,
        unit: 'COURT_MINUTES',
      },
    ],
  });
}

export async function issuePackageToCustomer(
  venue: CommercialVenue,
  customerId: string,
  packageDefinitionId: string,
  input?: { issuedAt?: string; idempotencyKey?: string },
) {
  return venue.services.packages.issue(venue.owner, customerId, {
    packageDefinitionId,
    ...(input?.issuedAt ? { issuedAt: input.issuedAt } : {}),
    ...(input?.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
  });
}

export async function createActiveMembership(
  venue: CommercialVenue,
  customerId: string,
  planId: string,
  startDate = '2026-09-01',
) {
  return venue.services.memberships.create(venue.owner, {
    customerId,
    planId,
    startDate,
  });
}

export async function recordExternalPayment(
  venue: CommercialVenue,
  input: {
    chargeId: string;
    customerId: string;
    amount: number;
    paidAt?: string;
  },
) {
  return venue.services.payments.create(venue.owner, {
    chargeId: input.chargeId,
    customerId: input.customerId,
    amount: input.amount,
    method: 'PIX',
    paidAt: input.paidAt ?? '2026-09-15T12:00:00.000Z',
  });
}

export async function consumeClassCredit(
  venue: CommercialVenue,
  input: {
    customerId: string;
    activityId: string;
    occurredAt: string;
    entitlement: Awaited<
      ReturnType<typeof venue.services.entitlements.getAvailableEntitlements>
    >[number];
  },
) {
  return venue.services.entitlements.consume({
    customer: {
      organizationId: venue.organizationId,
      customerId: input.customerId,
    },
    activity: {
      activityType: 'CLASS_ATTENDANCE',
      activityId: input.activityId,
      quantity: 1,
      unit: 'SESSION',
      occurredAt: input.occurredAt,
      venueDate: input.occurredAt.slice(0, 10),
      classType: 'GROUP',
      coveredAmount: 35,
      currency: 'BRL',
    },
    entitlement: input.entitlement,
    coveredAmount: 35,
    currency: 'BRL',
    createdBy: venue.owner.userId,
  });
}

export type CommercialApi = Api;
