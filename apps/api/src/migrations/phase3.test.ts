import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../db.js';
import { phase3Keys } from '../persistence/phase3-keys.js';
import { migratePhase3 } from './phase3.js';

describe('Phase 3 migration', () => {
  it('backfills financial access records without inventing commercial relationships', async () => {
    const repo = new MemoryRepository();
    await repo.put({
      PK: 'CHARGE#legacy-charge',
      SK: 'META',
      entity: 'charge',
      chargeId: 'legacy-charge',
      organizationId: 'org-1',
      customerId: 'customer-1',
      serviceAt: '2026-09-10T19:00:00.000Z',
      amount: 100,
    });
    await repo.put({
      PK: 'PAYMENT#legacy-payment',
      SK: 'META',
      entity: 'payment',
      paymentId: 'legacy-payment',
      organizationId: 'org-1',
      customerId: 'customer-1',
      paidAt: '2026-09-10T19:05:00.000Z',
      amount: 100,
    });
    await repo.put({
      PK: 'ORG#org-1',
      SK: 'CUSTOMER#customer-1',
      entity: 'customer',
      organizationId: 'org-1',
      customerId: 'customer-1',
    });

    expect(await migratePhase3(repo)).toEqual({
      indexesCreated: 2,
      financialIndexesCreated: 2,
    });
    expect(await migratePhase3(repo)).toEqual({
      indexesCreated: 0,
      financialIndexesCreated: 0,
    });
    expect(
      await repo.get(
        phase3Keys.customerCharge(
          'org-1',
          'customer-1',
          '2026-09-10T19:00:00.000Z',
          'legacy-charge',
        ),
      ),
    ).toMatchObject({
      chargeId: 'legacy-charge',
    });
    expect(
      await repo.query('CUSTOMER#org-1#customer-1', {
        beginsWith: 'MEMBERSHIP#',
      }),
    ).toHaveLength(0);
  });
});
