import type { AuthContext } from '@court-manager/contracts';
import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../db.js';
import { reconcileCommercial } from './commercial-reconciliation.js';
import { buildServices } from './index.js';

const owner: AuthContext = {
  organizationId: 'org-packages',
  userId: 'owner-1',
  role: 'OWNER',
};
const staff: AuthContext = { ...owner, userId: 'staff-1', role: 'STAFF' };
const coach: AuthContext = { ...owner, userId: 'coach-1', role: 'COACH' };

async function setup() {
  const repo = new MemoryRepository();
  await repo.put({
    PK: 'ORG#org-packages',
    SK: 'META',
    entity: 'organization',
    organizationId: owner.organizationId,
    currency: 'BRL',
  });
  const services = buildServices(repo);
  const customer = await services.customers.create(owner, {
    name: 'Maria',
    phone: '41999990000',
  });
  return { repo, services, customerId: String(customer.customerId) };
}

describe('PackageService', () => {
  it('manages definitions, snapshots issued terms, creates credits and a charge', async () => {
    const { services, customerId } = await setup();
    const definition = await services.packages.createDefinition(owner, {
      name: 'Ten court hours',
      price: 700,
      validityDays: 90,
      benefits: [
        {
          type: 'COURT_TIME',
          period: 'PACKAGE_LIFETIME',
          quantityType: 'FINITE',
          quantity: 600,
          unit: 'COURT_MINUTES',
        },
      ],
    });
    const issued = await services.packages.issue(owner, customerId, {
      packageDefinitionId: definition.packageDefinitionId,
      issuedAt: '2026-09-10T12:00:00.000Z',
      idempotencyKey: 'sale-1',
    });

    expect(issued).toMatchObject({
      customerId,
      packageNameSnapshot: 'Ten court hours',
      price: 700,
      expiresAt: '2026-12-09T12:00:00.000Z',
    });
    expect(
      await services.charges.list(owner, { sourceType: 'PACKAGE' }),
    ).toEqual([
      expect.objectContaining({
        sourceType: 'PACKAGE',
        sourceId: issued.customerPackageId,
        packageId: issued.customerPackageId,
        amount: 700,
        outstanding: 700,
      }),
    ]);
    expect(
      await services.repo.get({
        PK: `ENTITLEMENT_BALANCE#PACKAGE#${issued.customerPackageId}#-`,
        SK: `BENEFIT#${definition.benefits[0]!.benefitId}`,
      }),
    ).toMatchObject({
      issuedQuantity: 600,
      remainingQuantity: 600,
    });

    const repeated = await services.packages.issue(owner, customerId, {
      packageDefinitionId: definition.packageDefinitionId,
      issuedAt: '2026-09-10T12:00:00.000Z',
      idempotencyKey: 'sale-1',
    });
    expect(repeated.customerPackageId).toBe(issued.customerPackageId);
    expect(
      await services.packages.listCustomerPackages(owner, customerId),
    ).toHaveLength(1);
    const listed = await services.packages.list(owner, {
      packageDefinitionId: definition.packageDefinitionId,
      remainingMin: 600,
    });
    expect(listed[0]).toMatchObject({
      customerPackageId: issued.customerPackageId,
      creditBalances: [expect.objectContaining({ remainingQuantity: 600 })],
    });
    expect(
      await services.packages.transactions(owner, issued.customerPackageId),
    ).toEqual([
      expect.objectContaining({ transactionType: 'ISSUED', quantity: 600 }),
    ]);

    await services.packages.updateDefinition(
      owner,
      definition.packageDefinitionId,
      {
        name: 'Updated package',
        price: 800,
      },
    );
    expect(
      await services.packages.getCustomerPackage(
        owner,
        issued.customerPackageId,
      ),
    ).toMatchObject({ packageNameSnapshot: 'Ten court hours', price: 700 });
  });

  it('keeps definition and customer boundaries enforced and preserves cancelled history', async () => {
    const { services, customerId } = await setup();
    const definition = await services.packages.createDefinition(owner, {
      name: 'Private lessons',
      price: 250,
      validityDays: null,
      benefits: [
        {
          type: 'PRIVATE_LESSON',
          period: 'PACKAGE_LIFETIME',
          quantityType: 'FINITE',
          quantity: 3,
          unit: 'SESSION',
        },
      ],
    });
    await expect(
      services.packages.listDefinitions(coach),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const issued = await services.packages.issue(staff, customerId, {
      packageDefinitionId: definition.packageDefinitionId,
    });
    const cancelled = await services.packages.cancel(
      staff,
      issued.customerPackageId,
    );
    expect(cancelled.status).toBe('CANCELLED');
    expect(
      await services.packages.listCustomerPackages(staff, customerId),
    ).toHaveLength(1);
    await expect(
      services.packages.issue(
        { ...owner, organizationId: 'other-org' },
        customerId,
        { packageDefinitionId: definition.packageDefinitionId },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('materializes expired packages on read and keeps the credit history', async () => {
    const { services, customerId } = await setup();
    const definition = await services.packages.createDefinition(owner, {
      name: 'Short validity',
      price: 100,
      validityDays: 1,
      benefits: [
        {
          type: 'PRIVATE_LESSON',
          period: 'PACKAGE_LIFETIME',
          quantityType: 'FINITE',
          quantity: 2,
          unit: 'SESSION',
        },
      ],
    });
    const issued = await services.packages.issue(owner, customerId, {
      packageDefinitionId: definition.packageDefinitionId,
      issuedAt: '2020-01-01T12:00:00.000Z',
    });

    const expired = await services.packages.getCustomerPackage(
      owner,
      issued.customerPackageId,
    );
    expect(expired.status).toBe('EXPIRED');
    expect(expired.creditBalances).toEqual([
      expect.objectContaining({
        issuedQuantity: 2,
        remainingQuantity: 0,
        expiredQuantity: 2,
      }),
    ]);
    expect(
      await services.packages.transactions(owner, issued.customerPackageId),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ transactionType: 'ISSUED', quantity: 2 }),
        expect.objectContaining({ transactionType: 'EXPIRED', quantity: -2 }),
      ]),
    );
  });

  it('reconciles expired packages idempotently', async () => {
    const { repo, services, customerId } = await setup();
    const definition = await services.packages.createDefinition(owner, {
      name: 'Reconciliation package',
      price: 100,
      validityDays: 1,
      benefits: [
        {
          type: 'PRIVATE_LESSON',
          period: 'PACKAGE_LIFETIME',
          quantityType: 'FINITE',
          quantity: 1,
          unit: 'SESSION',
        },
      ],
    });
    await services.packages.issue(owner, customerId, {
      packageDefinitionId: definition.packageDefinitionId,
      issuedAt: '2020-01-01T12:00:00.000Z',
    });
    expect(await reconcileCommercial(repo)).toMatchObject({
      packagesChecked: 1,
      packagesChanged: 1,
    });
    expect(await reconcileCommercial(repo)).toMatchObject({
      packagesChecked: 1,
      packagesChanged: 0,
    });
  });
});
