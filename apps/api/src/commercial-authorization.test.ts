import { describe, expect, it } from 'vitest';
import {
  createCommercialVenue,
  createCourtMinutesPackage,
  createMonthlyClassMembership,
  issuePackageToCustomer,
  localDate,
} from './testing/phase3-fixture.js';
import { Phase3Repository } from './persistence/phase3-repository.js';

describe('commercial API authorization', () => {
  it('blocks cross-organization access to commercial records', async () => {
    const alpha = await createCommercialVenue({ label: 'auth-alpha' });
    const beta = await createCommercialVenue({ label: 'auth-beta' });
    const alphaCustomer = String((await alpha.createCustomer()).customerId);
    const betaCustomer = String((await beta.createCustomer()).customerId);
    const alphaPlan = (
      await createMonthlyClassMembership(alpha, { customerId: alphaCustomer })
    ).plan;
    const betaPlan = (
      await createMonthlyClassMembership(beta, { customerId: betaCustomer })
    ).plan;
    const alphaDefinition = await createCourtMinutesPackage(alpha);
    const betaDefinition = await createCourtMinutesPackage(beta);
    const alphaPackage = await issuePackageToCustomer(
      alpha,
      alphaCustomer,
      alphaDefinition.packageDefinitionId,
    );
    const betaPackage = await issuePackageToCustomer(
      beta,
      betaCustomer,
      betaDefinition.packageDefinitionId,
    );
    const alphaMembership = await alpha.services.memberships.create(
      alpha.owner,
      {
        customerId: alphaCustomer,
        planId: alphaPlan.planId,
        startDate: localDate(2026, 9, 1),
      },
    );
    const betaMembership = await beta.services.memberships.create(beta.owner, {
      customerId: betaCustomer,
      planId: betaPlan.planId,
      startDate: localDate(2026, 9, 1),
    });
    const alphaToken = await alpha.staffToken();
    const betaToken = await beta.staffToken();

    expect(
      (await alpha.call('GET', `/plans/${betaPlan.planId}`, alphaToken)).status,
    ).toBe(404);
    expect(
      (
        await alpha.call(
          'GET',
          `/memberships/${betaMembership.membershipId}`,
          alphaToken,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await alpha.call(
          'GET',
          `/customer-packages/${betaPackage.customerPackageId}`,
          alphaToken,
        )
      ).status,
    ).toBe(404);

    const alphaAgreement = await alpha.services.fixedCourtAgreements.create(
      alpha.owner,
      {
        customerId: alphaCustomer,
        courtId: alpha.courtId,
        weekday: 'WEDNESDAY',
        startTime: '19:00',
        startDate: localDate(2026, 9, 3),
        durationMinutes: 120,
        intervalWeeks: 1,
        monthlyPrice: 600,
        timezone: 'UTC',
        skipConflicts: true,
      },
    );
    expect('agreementId' in alphaAgreement).toBe(true);
    if (!('agreementId' in alphaAgreement))
      throw new Error('Expected a fixed court agreement');
    expect(
      (
        await beta.call(
          'GET',
          `/fixed-court-agreements/${alphaAgreement.agreementId}`,
          betaToken,
        )
      ).status,
    ).toBe(404);

    expect(alphaMembership.membershipId).toBeTruthy();
    expect(betaMembership.membershipId).toBeTruthy();
    expect(alphaPackage.customerPackageId).toBeTruthy();
    expect(betaPackage.customerPackageId).toBeTruthy();
    expect(
      await new Phase3Repository(alpha.repo).getPlan(
        alpha.organizationId,
        betaPlan.planId,
      ),
    ).toBeUndefined();
  });

  it('prevents coaches from mutating commercial configuration', async () => {
    const venue = await createCommercialVenue({ label: 'coach-auth' });
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

    const createPlan = await venue.call('POST', '/plans', coachToken, {
      name: 'Coach plan',
      basePrice: 100,
      benefits: [
        {
          type: 'CLASS_ATTENDANCE',
          period: 'MONTH',
          quantityType: 'FINITE',
          quantity: 4,
          unit: 'SESSION',
        },
      ],
    });
    expect(createPlan.status).toBe(403);

    const createPackage = await venue.call(
      'POST',
      '/package-definitions',
      coachToken,
      {
        name: 'Coach package',
        price: 100,
        validityDays: 30,
        benefits: [
          {
            type: 'COURT_TIME',
            period: 'PACKAGE_LIFETIME',
            quantityType: 'FINITE',
            quantity: 60,
            unit: 'COURT_MINUTES',
          },
        ],
      },
    );
    expect(createPackage.status).toBe(403);
  });
});
