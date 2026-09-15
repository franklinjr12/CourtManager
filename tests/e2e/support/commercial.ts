import type { createIsolatedVenue, seedVenue } from './venue.js';

type Venue = Awaited<ReturnType<typeof createIsolatedVenue>>;
type SmokeVenue = Awaited<ReturnType<typeof seedVenue>>;

export async function createMonthlyClassPlan(
  venue: Venue | SmokeVenue,
  input?: { price?: number; classes?: number; name?: string },
) {
  return venue.services.plans.create(venue.owner, {
    name: input?.name ?? '8 Classes / Month',
    basePrice: input?.price ?? 280,
    billingInterval: 'MONTHLY',
    benefits: [
      {
        type: 'CLASS_ATTENDANCE',
        period: 'MONTH',
        quantityType: 'FINITE',
        quantity: input?.classes ?? 8,
        unit: 'SESSION',
      },
    ],
  });
}

export async function issueCourtHourPackage(
  venue: Venue | SmokeVenue,
  input?: {
    minutes?: number;
    price?: number;
    validityDays?: number;
    name?: string;
  },
) {
  return venue.services.packages.createDefinition(venue.owner, {
    name: input?.name ?? 'Court hours',
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

export async function seedCommercialOverviewVenue() {
  const { createIsolatedVenue } = await import('./venue.js');
  const venue = await createIsolatedVenue({ prefix: 'commercial-overview' });
  const activeCustomer = await venue.services.customers.create(venue.owner, {
    name: 'Active member',
    phone: '41999991001',
  });
  const overdueCustomer = await venue.services.customers.create(venue.owner, {
    name: 'Overdue member',
    phone: '41999991002',
  });
  const plan = await createMonthlyClassPlan(venue);
  await venue.services.memberships.create(venue.owner, {
    customerId: String(activeCustomer.customerId),
    planId: plan.planId,
    startDate: '2099-01-01',
  });
  const overdueMembership = await venue.services.memberships.create(
    venue.owner,
    {
      customerId: String(overdueCustomer.customerId),
      planId: plan.planId,
      startDate: '2026-09-01',
    },
  );
  await venue.services.payments.create(venue.owner, {
    chargeId: `membership-${overdueMembership.currentPeriodId}`,
    customerId: String(overdueCustomer.customerId),
    amount: 0,
    method: 'OTHER',
    paidAt: '2026-09-01T12:00:00.000Z',
  });
  const definition = await issueCourtHourPackage(venue, { validityDays: 10 });
  await venue.services.packages.issue(
    venue.owner,
    String(activeCustomer.customerId),
    {
      packageDefinitionId: definition.packageDefinitionId,
      issuedAt: '2099-01-01T12:00:00.000Z',
    },
  );
  await venue.services.fixedCourtAgreements.create(venue.owner, {
    customerId: String(activeCustomer.customerId),
    courtId: venue.court.courtId,
    weekday: 'WEDNESDAY',
    startTime: '19:00',
    startDate: '2099-01-01',
    durationMinutes: 120,
    intervalWeeks: 1,
    monthlyPrice: 600,
    timezone: 'UTC',
    skipConflicts: true,
  });
  return venue;
}

export async function reconcileCommercialState(venue: Venue | SmokeVenue) {
  const { reconcileCommercial } =
    await import('../../../apps/api/src/services/commercial-reconciliation.js');
  return reconcileCommercial(venue.repo);
}
