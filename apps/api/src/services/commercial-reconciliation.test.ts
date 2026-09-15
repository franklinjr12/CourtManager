import { describe, expect, it } from 'vitest';
import {
  createCommercialVenue,
  createCourtMinutesPackage,
  createMonthlyClassMembership,
  issuePackageToCustomer,
  localDate,
} from '../testing/phase3-fixture.js';
import { reconcileCommercial } from './commercial-reconciliation.js';
import { Phase3Repository } from '../persistence/phase3-repository.js';

describe('commercial reconciliation', () => {
  it('materializes expired packages and memberships idempotently', async () => {
    const venue = await createCommercialVenue({ label: 'reconcile' });
    const customer = await venue.createCustomer('Reconcile customer');
    const customerId = String(customer.customerId);
    const { membership } = await createMonthlyClassMembership(venue, {
      customerId,
      startDate: '2020-01-01',
    });
    const definition = await createCourtMinutesPackage(venue, {
      validityDays: 1,
      minutes: 60,
    });
    await issuePackageToCustomer(
      venue,
      customerId,
      definition.packageDefinitionId,
      { issuedAt: '2020-01-01T12:00:00.000Z' },
    );

    const first = await reconcileCommercial(venue.repo);
    expect(first).toMatchObject({
      membershipsChecked: 1,
      packagesChecked: 1,
    });
    expect(first.membershipsChanged + first.packagesChanged).toBeGreaterThan(0);

    const expiredMembership = await venue.services.memberships.get(
      venue.owner,
      membership.membershipId,
    );
    expect(expiredMembership.status).toBe('EXPIRED');

    const packages = await venue.services.packages.listCustomerPackages(
      venue.owner,
      customerId,
      { activeOnly: false },
    );
    expect(packages.every((item) => item.status === 'EXPIRED')).toBe(true);

    const second = await reconcileCommercial(venue.repo);
    expect(second).toMatchObject({
      membershipsChecked: 1,
      packagesChecked: 1,
      membershipsChanged: 0,
      packagesChanged: 0,
    });

    const transactions = await new Phase3Repository(
      venue.repo,
    ).listCreditTransactionsBySource(
      venue.organizationId,
      'PACKAGE',
      packages[0]!.customerPackageId,
    );
    const expiredTransactions = transactions.filter(
      (transaction) => transaction.transactionType === 'EXPIRED',
    );
    expect(expiredTransactions.length).toBeGreaterThan(0);
    expect(await reconcileCommercial(venue.repo)).toMatchObject({
      packagesChanged: 0,
    });
  });

  it('keeps organizations isolated during reconciliation', async () => {
    const alpha = await createCommercialVenue({ label: 'alpha-reconcile' });
    const beta = await createCommercialVenue({ label: 'beta-reconcile' });
    const alphaCustomer = String((await alpha.createCustomer()).customerId);
    const betaCustomer = String((await beta.createCustomer()).customerId);
    await createMonthlyClassMembership(alpha, {
      customerId: alphaCustomer,
      startDate: localDate(2020, 1, 1),
    });
    await createMonthlyClassMembership(beta, {
      customerId: betaCustomer,
      startDate: localDate(2020, 1, 1),
    });

    const alphaResult = await reconcileCommercial(alpha.repo);
    const betaResult = await reconcileCommercial(beta.repo);
    expect(alphaResult.membershipsChecked).toBe(1);
    expect(betaResult.membershipsChecked).toBe(1);
    expect(alphaResult.membershipsChanged).toBe(1);
    expect(betaResult.membershipsChanged).toBe(1);
  });
});
