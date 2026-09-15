import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../db.js';
import { Phase3Repository } from '../persistence/phase3-repository.js';
import { EntitlementService } from './entitlements.js';

const input = {
  organizationId: 'org-ledger',
  customerId: 'customer-1',
  sourceType: 'MANUAL' as const,
  sourceId: 'credit-source-1',
  unit: 'COURT_MINUTES' as const,
  createdBy: 'staff-1',
  createdAt: '2026-09-14T12:00:00.000Z',
};

async function setup() {
  const persistence = new Phase3Repository(new MemoryRepository());
  const service = new EntitlementService(persistence);
  await service.issue({ ...input, quantityType: 'FINITE', quantity: 60 });
  return { persistence, service };
}

describe('EntitlementService', () => {
  it('derives an auditable balance and prevents concurrent overspending', async () => {
    const { persistence, service } = await setup();
    const consume = (activityId: string) =>
      service.consume({
        ...input,
        activityType: 'RESERVATION',
        activityId,
        quantity: 60,
        coveredAmount: 100,
        currency: 'BRL',
        occurredAt: input.createdAt,
      });

    const results = await Promise.allSettled([
      consume('reservation-1'),
      consume('reservation-2'),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);

    const successful = results.find((result) => result.status === 'fulfilled');
    const activityId =
      successful?.status === 'fulfilled'
        ? successful.value.allocation.activityId
        : 'reservation-1';
    const duplicate = await consume(activityId);
    expect(duplicate.duplicate).toBe(true);

    const balance = await service.getRemainingBalance({
      organizationId: input.organizationId,
      customerId: input.customerId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    });
    expect(balance).toMatchObject({
      issuedQuantity: 60,
      consumedQuantity: 60,
      remainingQuantity: 0,
    });
    expect(
      await persistence.listCreditTransactionsBySource(
        input.organizationId,
        input.sourceType,
        input.sourceId,
      ),
    ).toHaveLength(2);
  });

  it('records unlimited usage without pretending it has a finite balance', async () => {
    const persistence = new Phase3Repository(new MemoryRepository());
    const service = new EntitlementService(persistence);
    await service.issue({
      ...input,
      sourceId: 'unlimited-game-source',
      unit: 'GAME',
      quantityType: 'UNLIMITED',
    });

    const gameInput = {
      ...input,
      sourceId: 'unlimited-game-source',
      unit: 'GAME' as const,
    };
    await service.consume({
      ...gameInput,
      activityType: 'OPEN_GAME',
      activityId: 'game-1',
      quantity: 1,
      coveredAmount: 0,
      currency: 'BRL',
      occurredAt: input.createdAt,
    });
    await service.consume({
      ...gameInput,
      activityType: 'OPEN_GAME',
      activityId: 'game-2',
      quantity: 1,
      coveredAmount: 0,
      currency: 'BRL',
      occurredAt: input.createdAt,
    });

    const balance = await service.getRemainingBalance({
      organizationId: input.organizationId,
      customerId: input.customerId,
      sourceType: input.sourceType,
      sourceId: 'unlimited-game-source',
    });
    expect(balance).toMatchObject({
      consumedQuantity: 2,
      remainingQuantity: 0,
    });
    expect(
      await persistence.listCreditTransactionsBySource(
        input.organizationId,
        input.sourceType,
        'unlimited-game-source',
      ),
    ).toHaveLength(3);
  });

  it('restores a consumption with a reference and records manual adjustments and expiry', async () => {
    const { service, persistence } = await setup();
    const consumed = await service.consume({
      ...input,
      activityType: 'RESERVATION',
      activityId: 'reservation-restore',
      quantity: 20,
      coveredAmount: 100,
      currency: 'BRL',
      occurredAt: input.createdAt,
    });
    const restored = await service.restore({
      organizationId: input.organizationId,
      allocationId: consumed.allocation.allocationId,
      createdBy: 'staff-2',
      reason: 'Customer cancellation before cutoff',
      occurredAt: input.createdAt,
    });
    expect(restored.transaction).toMatchObject({
      transactionType: 'RESTORED',
      quantity: 20,
      relatedTransactionId: `consumption-${consumed.allocation.allocationId}`,
      createdBy: 'staff-2',
    });
    const repeatedRestore = await service.restore({
      organizationId: input.organizationId,
      allocationId: consumed.allocation.allocationId,
      createdBy: 'staff-2',
      reason: 'Customer cancellation before cutoff',
      occurredAt: input.createdAt,
    });
    expect(repeatedRestore.duplicate).toBe(true);
    expect(repeatedRestore.transaction.creditTransactionId).toBe(
      restored.transaction.creditTransactionId,
    );
    expect(
      await persistence.getEntitlementAllocation(
        input.organizationId,
        consumed.allocation.allocationId,
      ),
    ).toMatchObject({ status: 'VOID', voidedBy: 'staff-2' });

    await expect(
      service.adjust(ownerContext('COACH'), {
        ...input,
        quantity: -100,
        reason: 'Bad adjustment',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service.adjust(ownerContext('STAFF'), {
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        unit: input.unit,
        customerId: input.customerId,
        quantity: -100,
        reason: 'Bad adjustment',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const adjustment = await service.adjust(ownerContext('STAFF'), {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      unit: input.unit,
      customerId: input.customerId,
      quantity: 5,
      reason: 'Service recovery credit',
    });
    expect(adjustment.transaction).toMatchObject({
      transactionType: 'ADJUSTED',
      quantity: 5,
      reason: 'Service recovery credit',
      createdBy: 'staff',
    });

    const expired = await service.expire({
      ...input,
      reason: 'Package validity ended',
    });
    expect(expired?.transaction).toMatchObject({
      transactionType: 'EXPIRED',
      quantity: -65,
    });
    expect(
      await service.getRemainingBalance({
        organizationId: input.organizationId,
        customerId: input.customerId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      }),
    ).toMatchObject({ remainingQuantity: 0, adjustedQuantity: 5 });
  });

  it('selects only matching active commercial benefits and calculates coverage centrally', async () => {
    const persistence = new Phase3Repository(new MemoryRepository());
    const service = new EntitlementService(persistence);
    const benefit = {
      benefitId: 'court-minutes',
      type: 'COURT_TIME' as const,
      period: 'PACKAGE_LIFETIME' as const,
      quantityType: 'FINITE' as const,
      quantity: 120,
      unit: 'COURT_MINUTES' as const,
    };
    await persistence.putCustomerPackage({
      customerPackageId: 'package-1',
      organizationId: input.organizationId,
      customerId: input.customerId,
      packageDefinitionId: 'definition-1',
      packageNameSnapshot: 'Court minutes',
      status: 'ACTIVE',
      issuedAt: input.createdAt,
      startsAt: input.createdAt,
      price: 200,
      currency: 'BRL',
      benefitSnapshot: [benefit],
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
    await service.issue({
      ...input,
      sourceType: 'PACKAGE',
      sourceId: 'package-1',
      benefitId: benefit.benefitId,
      unit: benefit.unit,
      quantityType: benefit.quantityType,
      quantity: benefit.quantity,
    });
    const activity = {
      activityType: 'RESERVATION' as const,
      activityId: 'reservation-available',
      quantity: 60,
      unit: 'COURT_MINUTES' as const,
      occurredAt: input.createdAt,
      coveredAmount: 100,
      currency: 'BRL',
    };
    const available = await service.getAvailableEntitlements(
      { organizationId: input.organizationId, customerId: input.customerId },
      activity,
    );
    expect(available).toHaveLength(1);
    expect(service.calculateCoverage(activity, available[0]!)).toMatchObject({
      sourceType: 'PACKAGE',
      sourceId: 'package-1',
      quantity: 60,
      unit: 'COURT_MINUTES',
    });
  });
});

const ownerContext = (role: 'OWNER' | 'STAFF' | 'COACH') =>
  ({
    organizationId: input.organizationId,
    userId: role.toLowerCase(),
    role,
  }) as const;
