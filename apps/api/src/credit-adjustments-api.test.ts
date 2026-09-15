import { describe, expect, it } from 'vitest';
import {
  createCommercialVenue,
  createCourtMinutesPackage,
  issuePackageToCustomer,
} from './testing/phase3-fixture.js';

describe('credit adjustment API', () => {
  it('allows staff to adjust balances and rejects coach access', async () => {
    const venue = await createCommercialVenue({ label: 'credit-adjust' });
    const customer = await venue.createCustomer('Adjust customer');
    const customerId = String(customer.customerId);
    const definition = await createCourtMinutesPackage(venue, { minutes: 120 });
    const customerPackage = await issuePackageToCustomer(
      venue,
      customerId,
      definition.packageDefinitionId,
    );
    const benefitId = definition.benefits[0]!.benefitId!;
    const ownerToken = await venue.staffToken();
    const staffLogin = await venue.call<{ data: { token: string } }>(
      'POST',
      '/auth/login',
      undefined,
      {
        email: `staff-${venue.organizationId}@phase3.test`,
        password: 'phase3-fixture-password',
      },
    );
    const staffToken = staffLogin.body.data.token;
    const coachLogin = await venue.call<{ data: { token: string } }>(
      'POST',
      '/auth/login',
      undefined,
      {
        email: `coach-${venue.organizationId}@phase3.test`,
        password: 'phase3-fixture-password',
      },
    );
    const coachToken = coachLogin.body.data.token;

    const adjust = await venue.call('POST', '/credit-adjustments', staffToken, {
      customerId,
      sourceType: 'PACKAGE',
      sourceId: customerPackage.customerPackageId,
      benefitId,
      unit: 'COURT_MINUTES',
      quantity: -30,
      reason: 'Manual correction after staff review',
    });
    expect(adjust.status).toBe(201);
    expect(
      await venue.services.entitlements.getRemainingBalance({
        organizationId: venue.organizationId,
        customerId,
        sourceType: 'PACKAGE',
        sourceId: customerPackage.customerPackageId,
        benefitId,
      }),
    ).toMatchObject({ remainingQuantity: 90, adjustedQuantity: -30 });

    const forbidden = await venue.call(
      'POST',
      '/credit-adjustments',
      coachToken,
      {
        customerId,
        sourceType: 'PACKAGE',
        sourceId: customerPackage.customerPackageId,
        benefitId,
        unit: 'COURT_MINUTES',
        quantity: 10,
        reason: 'Coach should not adjust credits',
      },
    );
    expect(forbidden.status).toBe(403);

    const anonymous = await venue.call(
      'POST',
      '/credit-adjustments',
      undefined,
      {
        customerId,
        sourceType: 'PACKAGE',
        sourceId: customerPackage.customerPackageId,
        benefitId,
        unit: 'COURT_MINUTES',
        quantity: 10,
        reason: 'Anonymous adjustment',
      },
    );
    expect(anonymous.status).toBe(401);

    const negativeBalance = await venue.call(
      'POST',
      '/credit-adjustments',
      ownerToken,
      {
        customerId,
        sourceType: 'PACKAGE',
        sourceId: customerPackage.customerPackageId,
        benefitId,
        unit: 'COURT_MINUTES',
        quantity: -500,
        reason: 'Attempt to create negative balance',
      },
    );
    expect(negativeBalance.status).toBeGreaterThanOrEqual(400);
  });
});
