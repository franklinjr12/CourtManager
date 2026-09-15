import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../db.js';
import { phase3Keys } from '../persistence/phase3-keys.js';
import { Phase3Repository } from '../persistence/phase3-repository.js';
import { CommercialActivityEventService } from './commercial-activity-events.js';
import { CustomerActivityService } from './customer-activities.js';
import { buildServices } from './index.js';

const customerContext = {
  organizationId: 'org-1',
  customerId: 'customer-1',
  customerAccountId: 'account-1',
  actorType: 'CUSTOMER' as const,
};

describe('commercial customer activity events', () => {
  it('stores source-linked events once and exposes them in customer history', async () => {
    const repo = new MemoryRepository();
    const persistence = new Phase3Repository(repo);
    const events = new CommercialActivityEventService(persistence);
    const input = {
      organizationId: 'org-1',
      customerId: 'customer-1',
      eventType: 'PACKAGE_CONSUMED' as const,
      sourceType: 'PACKAGE' as const,
      sourceId: 'package-1',
      occurredAt: '2026-09-15T12:00:00.000Z',
      dedupeKey: 'allocation-1',
    };

    const first = await events.record(input);
    const second = await events.record(input);

    expect(second).toEqual(first);
    expect(
      await persistence.listCustomerActivityEvents('org-1', 'customer-1'),
    ).toEqual([first]);
    const history = await new CustomerActivityService(repo).list(
      customerContext,
      {
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-10-01T00:00:00.000Z',
        limit: 20,
      },
    );
    expect(history.data).toMatchObject([
      {
        activityType: 'COMMERCIAL',
        eventType: 'PACKAGE_CONSUMED',
        sourceType: 'PACKAGE',
        sourceId: 'package-1',
        status: 'RECORDED',
      },
    ]);
  });

  it('keeps event identities tenant and source specific', async () => {
    const repo = new MemoryRepository();
    const persistence = new Phase3Repository(repo);
    const events = new CommercialActivityEventService(persistence);
    const base = {
      customerId: 'customer-1',
      eventType: 'MEMBERSHIP_STARTED' as const,
      sourceType: 'MEMBERSHIP' as const,
      sourceId: 'membership-1',
      occurredAt: '2026-09-15T12:00:00.000Z',
    };
    const orgOne = await events.record({ organizationId: 'org-1', ...base });
    const orgTwo = await events.record({ organizationId: 'org-2', ...base });

    expect(orgOne.eventId).not.toBe(orgTwo.eventId);
    expect(
      await repo.get(phase3Keys.customerActivityEvent(orgOne.eventId)),
    ).toBeDefined();
    expect(
      await persistence.listCustomerActivityEvents('org-1', 'customer-1'),
    ).toHaveLength(1);
    expect(
      await persistence.listCustomerActivityEvents('org-2', 'customer-1'),
    ).toHaveLength(1);
  });

  it('is emitted by membership lifecycle and entitlement operations', async () => {
    const repo = new MemoryRepository();
    await repo.put({
      PK: 'ORG#org-lifecycle',
      SK: 'META',
      entity: 'organization',
      organizationId: 'org-lifecycle',
      currency: 'BRL',
      timezone: 'UTC',
    });
    const services = buildServices(repo);
    const staff = {
      organizationId: 'org-lifecycle',
      userId: 'owner-1',
      role: 'OWNER' as const,
    };
    const customer = await services.customers.create(staff, {
      name: 'Carlos',
      phone: '41999990000',
    });
    const plan = await services.plans.create(staff, {
      name: 'Monthly court time',
      basePrice: 200,
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
    const membership = await services.memberships.create(staff, {
      customerId: customer.customerId,
      planId: plan.planId,
      startDate: '2026-09-15',
    });
    await services.memberships.pause(staff, membership.membershipId);
    await services.memberships.resume(staff, membership.membershipId);
    await services.memberships.cancel(staff, membership.membershipId, {
      effectiveDate: '2026-09-15',
    });

    const rows = await repo.query(
      `CUSTOMER#org-lifecycle#${customer.customerId}`,
      { beginsWith: 'ACTIVITY#' },
    );
    expect(
      rows.filter((row) => row.entity === 'customerActivityEvent'),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: 'MEMBERSHIP_STARTED' }),
        expect.objectContaining({ eventType: 'MEMBERSHIP_PAUSED' }),
        expect.objectContaining({ eventType: 'MEMBERSHIP_RESUMED' }),
        expect.objectContaining({ eventType: 'MEMBERSHIP_CANCELLED' }),
        expect.objectContaining({ eventType: 'CREDIT_ISSUED' }),
      ]),
    );
  });
});
