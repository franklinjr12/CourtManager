import { DEFAULT_BOOKING_POLICY } from '@court-manager/contracts';
import type { RecordItem, Repository } from '../db.js';
import { phase2Keys } from '../persistence/phase2-keys.js';

export type Phase2MigrationResult = {
  organizationsUpdated: number;
  waitlistsIndexed: number;
};

/** Add Phase 2 defaults without rewriting or removing existing business data. */
export async function migratePhase2(
  repo: Repository,
  timestamp = new Date().toISOString(),
): Promise<Phase2MigrationResult> {
  let organizationsUpdated = 0;
  let waitlistsIndexed = 0;
  const organizations = await repo.scan<RecordItem>(
    (item) => item.entity === 'organization',
  );
  for (const organization of organizations) {
    if (organization.bookingPolicy !== undefined) continue;
    await repo.put({
      ...organization,
      bookingPolicy: { ...DEFAULT_BOOKING_POLICY },
      updatedAt: timestamp,
    });
    organizationsUpdated += 1;
  }
  const waitlists = await repo.scan<RecordItem>(
    (item) => item.entity === 'waitlist',
  );
  for (const waitlist of waitlists) {
    const key = phase2Keys.organizationWaitlist(
      String(waitlist.organizationId),
      String(waitlist.joinedAt),
      String(waitlist.waitlistId),
    );
    if (await repo.get(key)) continue;
    await repo.put({ ...waitlist, ...key });
    waitlistsIndexed += 1;
  }
  return { organizationsUpdated, waitlistsIndexed };
}
