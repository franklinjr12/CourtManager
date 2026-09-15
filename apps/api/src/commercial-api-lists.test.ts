import { describe, expect, it } from 'vitest';
import {
  createCommercialVenue,
  createCourtMinutesPackage,
  createMonthlyClassMembership,
  issuePackageToCustomer,
  localDate,
  recordExternalPayment,
} from './testing/phase3-fixture.js';
import { Phase3Repository } from './persistence/phase3-repository.js';

describe('commercial list and summary APIs', () => {
  it('exposes renewal-due, overdue, expiring-soon, and commercial summary endpoints', async () => {
    const venue = await createCommercialVenue({
      label: 'commercial-lists',
      timezone: 'America/Sao_Paulo',
    });
    const customer = await venue.createCustomer('Summary customer');
    const customerId = String(customer.customerId);
    const { membership } = await createMonthlyClassMembership(venue, {
      customerId,
      startDate: localDate(2026, 9, 1),
    });
    const definition = await createCourtMinutesPackage(venue, {
      validityDays: 5,
      minutes: 120,
    });
    await issuePackageToCustomer(
      venue,
      customerId,
      definition.packageDefinitionId,
      { issuedAt: '2026-09-10T12:00:00.000Z' },
    );
    const token = await venue.staffToken();
    const persistence = new Phase3Repository(venue.repo);
    await persistence.putMembership(
      {
        ...membership,
        currentPeriodEnd: '2026-12-31',
        nextRenewalDate: '2020-01-01',
        updatedAt: '2026-09-15T12:00:00.000Z',
      },
      membership,
    );

    const overdue = await venue.call<{ data: unknown[] }>(
      'GET',
      '/memberships/overdue',
      token,
    );
    expect(overdue.status).toBe(200);
    expect(overdue.body.data).toEqual([
      expect.objectContaining({ membershipId: membership.membershipId }),
    ]);

    await recordExternalPayment(venue, {
      chargeId: `membership-${membership.currentPeriodId}`,
      customerId,
      amount: membership.price,
    });
    expect(
      (
        await venue.call<{ data: unknown[] }>(
          'GET',
          '/memberships/overdue',
          token,
        )
      ).body.data,
    ).toEqual([]);

    const renewalsDue = await venue.call(
      'GET',
      '/memberships/renewals-due',
      token,
    );
    expect(renewalsDue.status).toBe(200);

    const expiringMemberships = await venue.call(
      'GET',
      '/memberships/expiring-soon?windowDays=30',
      token,
    );
    expect(expiringMemberships.status).toBe(200);

    const expiringPackages = await venue.call(
      'GET',
      '/customer-packages/expiring-soon?windowDays=30',
      token,
    );
    expect(expiringPackages.status).toBe(200);

    const summary = await venue.call<{
      data: {
        memberships: Array<{ membershipId: string }>;
        packages: Array<{ customerPackageId: string }>;
      };
    }>('GET', `/customers/${customerId}/commercial-summary`, token);
    expect(summary.status).toBe(200);
    expect(summary.body.data.memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ membershipId: membership.membershipId }),
      ]),
    );
  });
});
