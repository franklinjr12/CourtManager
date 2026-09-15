import { describe, expect, it } from 'vitest';
import {
  createCommercialVenue,
  createCourtMinutesPackage,
  localDate,
} from '../testing/phase3-fixture.js';

describe('commercial journeys', () => {
  it('runs staff plan edit, membership assignment, and customer portal read paths', async () => {
    const venue = await createCommercialVenue({ label: 'journey' });
    const customer = await venue.createCustomer('Journey customer');
    const customerId = String(customer.customerId);
    const token = await venue.staffToken();

    const created = await venue.call<{ data: { planId: string } }>(
      'POST',
      '/plans',
      token,
      {
        name: '8 Classes / Month',
        basePrice: 280,
        benefits: [
          {
            type: 'CLASS_ATTENDANCE',
            period: 'MONTH',
            quantityType: 'FINITE',
            quantity: 8,
            unit: 'SESSION',
          },
        ],
      },
    );
    expect(created.status).toBe(201);
    const membership = await venue.call('POST', '/memberships', token, {
      customerId,
      planId: created.body.data.planId,
      startDate: localDate(2026, 9, 1),
      price: 250,
    });
    expect(membership.status).toBe(201);

    const edited = await venue.call(
      'PATCH',
      `/plans/${created.body.data.planId}`,
      token,
      { name: 'Updated plan', basePrice: 999 },
    );
    expect(edited.status).toBe(200);
    const membershipDetail = await venue.call<{
      data: Record<string, unknown>;
    }>(
      'GET',
      `/memberships/${(membership.body as { data: { membershipId: string } }).data.membershipId}`,
      token,
    );
    expect(membershipDetail.body.data).toMatchObject({
      planNameSnapshot: '8 Classes / Month',
      price: 250,
    });

    const definition = await createCourtMinutesPackage(venue);
    const issued = await venue.call(
      'POST',
      `/customers/${customerId}/packages`,
      token,
      {
        packageDefinitionId: definition.packageDefinitionId,
      },
    );
    expect(issued.status).toBe(201);
  });
});
