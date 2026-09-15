import type { AuthContext, Reservation } from '@court-manager/contracts';
import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../db.js';
import { Phase3Repository } from '../persistence/phase3-repository.js';
import { buildServices } from './index.js';

const owner: AuthContext = {
  organizationId: 'org-reservation-entitlements',
  userId: 'owner-1',
  role: 'OWNER',
};

const openingHours = {
  MONDAY: { open: '07:00', close: '23:00' },
  TUESDAY: { open: '07:00', close: '23:00' },
  WEDNESDAY: { open: '07:00', close: '23:00' },
  THURSDAY: { open: '07:00', close: '23:00' },
  FRIDAY: { open: '07:00', close: '23:00' },
  SATURDAY: { open: '07:00', close: '23:00' },
  SUNDAY: { open: '07:00', close: '23:00' },
};

async function setup() {
  const repo = new MemoryRepository();
  await repo.put({
    PK: `ORG#${owner.organizationId}`,
    SK: 'META',
    entity: 'organization',
    organizationId: owner.organizationId,
    timezone: 'UTC',
    currency: 'BRL',
  });
  const services = buildServices(repo);
  const court = await services.courts.create(owner, {
    name: 'Court 1',
    sport: 'Tennis',
    slotMinutes: 30,
    defaultHourlyPrice: 80,
    publiclyRequestable: true,
    active: true,
    openingHours,
  });
  const customer = await services.customers.create(owner, {
    name: 'Maria',
    phone: '41999990000',
  });
  return { repo, services, court, customer };
}

describe('reservation entitlement coverage', () => {
  it('partially covers a reservation, leaves only the uncovered charge, and is idempotent', async () => {
    const { services, court, customer } = await setup();
    const customerId = String(customer.customerId);
    const courtId = String(court.courtId);
    const definition = await services.packages.createDefinition(owner, {
      name: 'One court hour',
      price: 100,
      validityDays: 90,
      benefits: [
        {
          type: 'COURT_TIME',
          period: 'PACKAGE_LIFETIME',
          quantityType: 'FINITE',
          quantity: 60,
          unit: 'COURT_MINUTES',
        },
      ],
    });
    const customerPackage = await services.packages.issue(owner, customerId, {
      packageDefinitionId: String(definition.packageDefinitionId),
      issuedAt: '2027-01-01T00:00:00.000Z',
    });

    const reservation = (await services.reservations.create(owner, {
      courtId,
      customerId,
      startAt: '2027-01-10T18:00:00.000Z',
      endAt: '2027-01-10T20:00:00.000Z',
      expectedAmount: 160,
      source: 'STAFF',
    })) as Reservation & { serviceAmount?: number };
    const packageId = String(customerPackage.customerPackageId);
    const benefitId = String(definition.benefits[0]!.benefitId);

    expect(reservation).toMatchObject({
      expectedAmount: 80,
      serviceAmount: 160,
    });
    expect(
      await services.charges.list(owner, { sourceType: 'RESERVATION' }),
    ).toEqual([
      expect.objectContaining({
        reservationId: reservation.reservationId,
        amount: 80,
        outstanding: 80,
      }),
    ]);
    const detail = await services.reservations.detail(
      owner,
      reservation.reservationId,
    );
    expect(detail.entitlementAllocations).toEqual([
      expect.objectContaining({
        sourceType: 'PACKAGE',
        sourceId: packageId,
        quantity: 60,
        coveredAmount: 80,
        status: 'ACTIVE',
      }),
    ]);

    const repeated = await services.reservationEntitlements.apply(
      owner,
      reservation,
    );
    expect(repeated.allocations).toHaveLength(1);
    expect(
      await services.entitlements.getRemainingBalance({
        organizationId: owner.organizationId,
        customerId,
        sourceType: 'PACKAGE',
        sourceId: packageId,
        benefitId,
      }),
    ).toMatchObject({ remainingQuantity: 0, consumedQuantity: 60 });
  });

  it('restores eligible cancellations once and does not restore no-shows', async () => {
    const { services, court, customer } = await setup();
    const customerId = String(customer.customerId);
    const courtId = String(court.courtId);
    const definition = await services.packages.createDefinition(owner, {
      name: 'Two court hours',
      price: 180,
      validityDays: 90,
      benefits: [
        {
          type: 'COURT_TIME',
          period: 'PACKAGE_LIFETIME',
          quantityType: 'FINITE',
          quantity: 120,
          unit: 'COURT_MINUTES',
        },
      ],
    });
    const customerPackage = await services.packages.issue(owner, customerId, {
      packageDefinitionId: String(definition.packageDefinitionId),
      issuedAt: '2027-01-01T00:00:00.000Z',
    });
    const cancelled = (await services.reservations.create(owner, {
      courtId,
      customerId,
      startAt: '2027-01-11T18:00:00.000Z',
      endAt: '2027-01-11T19:00:00.000Z',
      source: 'STAFF',
    })) as Reservation;
    const packageId = String(customerPackage.customerPackageId);
    const benefitId = String(definition.benefits[0]!.benefitId);
    await services.reservations.transition(
      owner,
      cancelled.reservationId,
      'CANCELLED',
    );
    expect(
      await services.entitlements.getRemainingBalance({
        organizationId: owner.organizationId,
        customerId,
        sourceType: 'PACKAGE',
        sourceId: packageId,
        benefitId,
      }),
    ).toMatchObject({ remainingQuantity: 120, restoredQuantity: 60 });

    const noShow = (await services.reservations.create(owner, {
      courtId,
      customerId,
      startAt: '2027-01-13T18:00:00.000Z',
      endAt: '2027-01-13T19:00:00.000Z',
      source: 'STAFF',
    })) as Reservation;
    await services.reservations.transition(
      owner,
      noShow.reservationId,
      'NO_SHOW',
    );
    expect(
      await services.entitlements.getRemainingBalance({
        organizationId: owner.organizationId,
        customerId,
        sourceType: 'PACKAGE',
        sourceId: packageId,
        benefitId,
      }),
    ).toMatchObject({ remainingQuantity: 60, restoredQuantity: 60 });
  });

  it('allocates active membership court-time benefits before packages', async () => {
    const { services, court, customer } = await setup();
    const customerId = String(customer.customerId);
    const plan = await services.plans.create(owner, {
      name: 'Monthly court hours',
      basePrice: 300,
      billingInterval: 'MONTHLY',
      benefits: [
        {
          type: 'COURT_TIME',
          period: 'MONTH',
          quantityType: 'FINITE',
          quantity: 120,
          unit: 'COURT_MINUTES',
        },
      ],
    });
    const membership = await services.memberships.create(owner, {
      customerId,
      planId: plan.planId,
      startDate: '2027-01-01',
      price: 280,
    });
    const reservation = (await services.reservations.create(owner, {
      courtId: String(court.courtId),
      customerId,
      startAt: '2027-01-06T19:00:00.000Z',
      endAt: '2027-01-06T20:00:00.000Z',
      expectedAmount: 80,
      source: 'STAFF',
    })) as Reservation & { serviceAmount?: number };

    expect(reservation).toMatchObject({
      serviceAmount: 80,
      expectedAmount: 0,
    });
    expect(
      (await services.reservationEntitlements.allocations(reservation))[0],
    ).toMatchObject({
      sourceType: 'MEMBERSHIP',
      sourceId: membership.membershipId,
      quantity: 60,
      coveredAmount: 80,
      status: 'ACTIVE',
    });
  });

  it('uses a matching fixed court agreement before credit balances', async () => {
    const { repo, services, court, customer } = await setup();
    const customerId = String(customer.customerId);
    const courtId = String(court.courtId);
    const commercial = new Phase3Repository(repo);
    await commercial.putFixedCourtAgreement({
      agreementId: 'agreement-1',
      organizationId: owner.organizationId,
      customerId,
      courtId,
      status: 'ACTIVE',
      weekday: 'WEDNESDAY',
      startTime: '19:00',
      durationMinutes: 120,
      startDate: '2027-01-06',
      intervalWeeks: 1,
      monthlyPrice: 500,
      currency: 'BRL',
      billingInterval: 'MONTHLY',
      timezone: 'UTC',
      createdAt: '2026-12-01T00:00:00.000Z',
      updatedAt: '2026-12-01T00:00:00.000Z',
    });
    const reservation = (await services.reservations.create(owner, {
      courtId,
      customerId,
      startAt: '2027-01-06T19:00:00.000Z',
      endAt: '2027-01-06T21:00:00.000Z',
      expectedAmount: 160,
      source: 'STAFF',
    })) as Reservation;

    expect(reservation.expectedAmount).toBe(0);
    expect(
      (await services.reservations.detail(owner, reservation.reservationId))
        .entitlementAllocations,
    ).toEqual([
      expect.objectContaining({
        sourceType: 'FIXED_AGREEMENT',
        sourceId: 'agreement-1',
        quantity: 120,
        coveredAmount: 160,
      }),
    ]);
  });
});
