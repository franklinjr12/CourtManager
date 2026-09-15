import { describe, expect, it } from 'vitest';
import {
  createCommercialVenue,
  createCourtMinutesPackage,
  createMonthlyClassMembership,
  issuePackageToCustomer,
  localDate,
  recordExternalPayment,
} from '../testing/phase3-fixture.js';

describe('Phase 3 canonical business scenarios', () => {
  it('scenario A: Carlos monthly class membership tracks usage and renewal history', async () => {
    const venue = await createCommercialVenue({ label: 'carlos' });
    const customer = await venue.createCustomer('Carlos');
    const customerId = String(customer.customerId);
    const { membership } = await createMonthlyClassMembership(venue, {
      customerId,
      classesPerMonth: 8,
      startDate: localDate(2026, 9, 1),
    });

    for (let index = 1; index <= 8; index += 1) {
      const activity = {
        activityType: 'CLASS_ATTENDANCE' as const,
        activityId: `carlos-class-${index}`,
        quantity: 1,
        unit: 'SESSION' as const,
        occurredAt: `2026-09-${String(index + 4).padStart(2, '0')}T10:00:00.000Z`,
        venueDate: `2026-09-${String(index + 4).padStart(2, '0')}`,
        classType: 'GROUP' as const,
        coveredAmount: 35,
        currency: 'BRL',
      };
      const [entitlement] =
        await venue.services.entitlements.getAvailableEntitlements(
          { organizationId: venue.organizationId, customerId },
          activity,
        );
      expect(entitlement).toBeTruthy();
      await venue.services.entitlements.consume({
        customer: { organizationId: venue.organizationId, customerId },
        activity,
        entitlement: entitlement!,
        coveredAmount: 35,
        currency: 'BRL',
        createdBy: venue.owner.userId,
      });
    }

    const exhausted =
      await venue.services.entitlements.getAvailableEntitlements(
        { organizationId: venue.organizationId, customerId },
        {
          activityType: 'CLASS_ATTENDANCE',
          activityId: 'carlos-class-9',
          quantity: 1,
          unit: 'SESSION',
          occurredAt: '2026-09-20T10:00:00.000Z',
          venueDate: '2026-09-20',
          classType: 'GROUP',
          coveredAmount: 35,
          currency: 'BRL',
        },
      );
    expect(exhausted).toEqual([]);

    const renewed = await venue.services.memberships.renew(
      venue.owner,
      membership.membershipId,
    );
    const periods = await venue.services.memberships.periods(
      venue.owner,
      membership.membershipId,
    );
    expect(periods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'COMPLETED' }),
        expect.objectContaining({
          membershipPeriodId: renewed.currentPeriodId,
          status: 'ACTIVE',
        }),
      ]),
    );
  });

  it('scenario B: Maria court-hour package consumes and restores credits', async () => {
    const venue = await createCommercialVenue({ label: 'maria' });
    const customer = await venue.createCustomer('Maria');
    const customerId = String(customer.customerId);
    const definition = await createCourtMinutesPackage(venue, { minutes: 600 });
    const customerPackage = await issuePackageToCustomer(
      venue,
      customerId,
      definition.packageDefinitionId,
      { issuedAt: '2027-01-01T00:00:00.000Z' },
    );
    const benefitId = definition.benefits[0]!.benefitId!;

    const consume = async (activityId: string, minutes: number) => {
      const startHour = activityId.endsWith('2') ? 20 : 18;
      const endHour = startHour + minutes / 60;
      const reservation = await venue.services.reservations.create(
        venue.owner,
        {
          courtId: venue.courtId,
          customerId,
          startAt: `2027-01-10T${String(startHour).padStart(2, '0')}:00:00.000Z`,
          endAt: `2027-01-10T${String(endHour).padStart(2, '0')}:00:00.000Z`,
          source: 'STAFF',
        },
      );
      expect(reservation.reservationId).toBeTruthy();
      return venue.services.entitlements.getRemainingBalance({
        organizationId: venue.organizationId,
        customerId,
        sourceType: 'PACKAGE',
        sourceId: customerPackage.customerPackageId,
        benefitId,
      });
    };

    expect(await consume('maria-reservation-1', 120)).toMatchObject({
      remainingQuantity: 480,
    });
    expect(await consume('maria-reservation-2', 60)).toMatchObject({
      remainingQuantity: 420,
    });

    const reservations = await venue.services.reservations.list(venue.owner, {
      customerId,
    });
    await venue.services.reservations.transition(
      venue.owner,
      reservations[1]!.reservationId,
      'CANCELLED',
    );
    expect(
      await venue.services.entitlements.getRemainingBalance({
        organizationId: venue.organizationId,
        customerId,
        sourceType: 'PACKAGE',
        sourceId: customerPackage.customerPackageId,
        benefitId,
      }),
    ).toMatchObject({ remainingQuantity: 480, restoredQuantity: 60 });
  });

  it('scenario C: partial reservation coverage charges only the uncovered amount', async () => {
    const venue = await createCommercialVenue({ label: 'partial' });
    const customer = await venue.createCustomer('Partial');
    const customerId = String(customer.customerId);
    const definition = await createCourtMinutesPackage(venue, { minutes: 60 });
    await issuePackageToCustomer(
      venue,
      customerId,
      definition.packageDefinitionId,
      { issuedAt: '2027-01-01T00:00:00.000Z' },
    );
    const reservation = await venue.services.reservations.create(venue.owner, {
      courtId: venue.courtId,
      customerId,
      startAt: '2027-01-10T18:00:00.000Z',
      endAt: '2027-01-10T20:00:00.000Z',
      expectedAmount: 160,
      source: 'STAFF',
    });
    expect(reservation).toMatchObject({
      expectedAmount: 80,
      serviceAmount: 160,
    });
    expect(
      await venue.services.charges.list(venue.owner, {
        sourceType: 'RESERVATION',
      }),
    ).toEqual([expect.objectContaining({ amount: 80, outstanding: 80 })]);
  });

  it('scenario E: membership payment settles outstanding balance without mixing service credits', async () => {
    const venue = await createCommercialVenue({ label: 'payment' });
    const customer = await venue.createCustomer('Payment');
    const customerId = String(customer.customerId);
    const { membership } = await createMonthlyClassMembership(venue, {
      customerId,
      price: 280,
      startDate: localDate(2026, 9, 1),
    });
    await recordExternalPayment(venue, {
      chargeId: `membership-${membership.currentPeriodId}`,
      customerId,
      amount: 280,
    });
    const summary = await venue.services.customerCommercialBalance.get(
      venue.owner,
      customerId,
    );
    expect(summary.balance.outstandingAmount).toBe(0);
    expect(summary.balance.totalPayments).toBe(280);
    expect(summary.memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ membershipId: membership.membershipId }),
      ]),
    );
  });
});
