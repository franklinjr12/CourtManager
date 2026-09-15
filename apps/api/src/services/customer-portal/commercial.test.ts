import type {
  AuthContext,
  CustomerAuthContext,
} from '@court-manager/contracts';
import { expect, it } from 'vitest';
import { MemoryRepository } from '../../db.js';
import { buildServices } from '../index.js';

const owner: AuthContext = {
  organizationId: 'org-customer-commercial-portal',
  userId: 'owner-1',
  role: 'OWNER',
};
const customerContext = (customerId: string): CustomerAuthContext => ({
  organizationId: owner.organizationId,
  customerId,
  customerAccountId: 'account-1',
  actorType: 'CUSTOMER',
});

it('returns customer-safe membership and package usage with auditable history', async () => {
  const repo = new MemoryRepository();
  await repo.put({
    PK: `ORG#${owner.organizationId}`,
    SK: 'META',
    entity: 'organization',
    organizationId: owner.organizationId,
    currency: 'BRL',
    timezone: 'UTC',
  });
  const services = buildServices(repo);
  const customer = await services.customers.create(owner, {
    name: 'Customer One',
    phone: '41999990000',
  });
  const otherCustomer = await services.customers.create(owner, {
    name: 'Customer Two',
    phone: '41999990001',
  });
  const plan = await services.plans.create(owner, {
    name: 'Eight classes',
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
  });
  const membership = await services.memberships.create(owner, {
    customerId: String(customer.customerId),
    planId: plan.planId,
    startDate: '2026-09-01',
    notes: 'Staff-only note',
  });
  const definition = await services.packages.createDefinition(owner, {
    name: 'Court hours',
    price: 240,
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
  const customerPackage = await services.packages.issue(
    owner,
    String(customer.customerId),
    {
      packageDefinitionId: definition.packageDefinitionId,
      issuedAt: '2026-09-01T10:00:00.000Z',
      notes: 'Staff-only package note',
    },
  );
  await services.entitlements.consume({
    organizationId: owner.organizationId,
    customerId: String(customer.customerId),
    sourceType: 'PACKAGE',
    sourceId: customerPackage.customerPackageId,
    ...(definition.benefits[0]!.benefitId
      ? { benefitId: definition.benefits[0]!.benefitId }
      : {}),
    activityType: 'RESERVATION',
    activityId: 'reservation-1',
    unit: 'COURT_MINUTES',
    quantity: 60,
    coveredAmount: 80,
    currency: 'BRL',
    createdBy: owner.userId,
    occurredAt: '2026-09-03T19:00:00.000Z',
  });

  const ctx = customerContext(String(customer.customerId));
  const memberships = await services.customerCommercialPortal.memberships(ctx);
  expect(memberships[0]).toMatchObject({
    membershipId: membership.membershipId,
    planNameSnapshot: 'Eight classes',
    benefits: [
      { issuedQuantity: 8, consumedQuantity: 0, remainingQuantity: 8 },
    ],
  });
  expect(memberships[0]).not.toHaveProperty('notes');

  const credits = await services.customerCommercialPortal.credits(ctx);
  expect(credits).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sourceType: 'PACKAGE',
        sourceName: 'Court hours',
        issuedQuantity: 120,
        consumedQuantity: 60,
        remainingQuantity: 60,
      }),
    ]),
  );

  const detail = await services.customerCommercialPortal.package(
    ctx,
    customerPackage.customerPackageId,
  );
  expect(detail.package).not.toHaveProperty('notes');
  expect(detail.history).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        transactionType: 'CONSUMED',
        quantity: -60,
        activityType: 'RESERVATION',
        activityId: 'reservation-1',
      }),
    ]),
  );

  await expect(
    services.customerCommercialPortal.membership(
      customerContext(String(otherCustomer.customerId)),
      membership.membershipId,
    ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
