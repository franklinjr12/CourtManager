import { DEFAULT_BOOKING_POLICY } from '@court-manager/contracts';
import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../db.js';
import { phase2Keys } from '../persistence/phase2-keys.js';
import { migratePhase2 } from './phase2.js';

describe('Phase 2 migration', () => {
  it('backfills policies idempotently and leaves non-organization records unchanged', async () => {
    const repo = new MemoryRepository();
    const organization = {
      PK: 'ORG#legacy',
      SK: 'META',
      entity: 'organization' as const,
      organizationId: 'legacy',
      name: 'Legacy Arena',
      slug: 'legacy-arena',
      timezone: 'UTC',
      currency: 'BRL',
      active: true,
      features: { classes: false, finance: true },
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    await repo.put(organization);
    await repo.put({
      PK: 'ORG#legacy',
      SK: 'CUSTOMER#customer-1',
      entity: 'customer',
      customerId: 'customer-1',
      organizationId: 'legacy',
    });
    await repo.put({
      PK: 'SESSION#staff-session',
      SK: 'META',
      expiresAt: 1_800_000_000,
      userId: 'staff-1',
    });
    await repo.put({
      PK: 'WAITLIST#waitlist-1',
      SK: 'META',
      entity: 'waitlist',
      waitlistId: 'waitlist-1',
      organizationId: 'legacy',
      customerId: 'customer-1',
      type: 'CLASS',
      classId: 'class-1',
      status: 'ACTIVE',
      joinedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(await migratePhase2(repo, '2026-01-01T00:00:00.000Z')).toEqual({
      organizationsUpdated: 1,
      waitlistsIndexed: 1,
    });
    expect(await migratePhase2(repo, '2026-01-02T00:00:00.000Z')).toEqual({
      organizationsUpdated: 0,
      waitlistsIndexed: 0,
    });
    expect(await repo.get({ PK: 'ORG#legacy', SK: 'META' })).toMatchObject({
      ...organization,
      bookingPolicy: DEFAULT_BOOKING_POLICY,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(
      await repo.get({ PK: 'ORG#legacy', SK: 'CUSTOMER#customer-1' }),
    ).toMatchObject({ entity: 'customer' });
    expect(
      await repo.get({ PK: 'SESSION#staff-session', SK: 'META' }),
    ).toMatchObject({ userId: 'staff-1' });
    expect(
      await repo.get(
        phase2Keys.organizationWaitlist(
          'legacy',
          '2026-01-01T00:00:00.000Z',
          'waitlist-1',
        ),
      ),
    ).toMatchObject({ waitlistId: 'waitlist-1' });
  });

  it('does not replace an organization policy already configured', async () => {
    const repo = new MemoryRepository();
    await repo.put({
      PK: 'ORG#configured',
      SK: 'META',
      entity: 'organization',
      bookingPolicy: {
        ...DEFAULT_BOOKING_POLICY,
        reservationMode: 'AUTO_CONFIRM',
      },
    });
    expect(await migratePhase2(repo)).toEqual({
      organizationsUpdated: 0,
      waitlistsIndexed: 0,
    });
    expect(
      (await repo.get({ PK: 'ORG#configured', SK: 'META' }))?.bookingPolicy,
    ).toMatchObject({ reservationMode: 'AUTO_CONFIRM' });
  });
});
