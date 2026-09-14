import type { Repository } from '../db.js';
import {
  classCatalogKey,
  classEnrollmentKey,
} from '../persistence/class-keys.js';

/** Offline, idempotent backfill. Pause class writes while running. */
export async function migrateClassDiscovery(repo: Repository) {
  const rows = await repo.scan();
  const classes = rows.filter((row) => row.entity === 'class');
  for (const cls of classes) {
    const enrollments = rows.filter(
      (row) =>
        row.entity === 'enrollment' &&
        row.organizationId === cls.organizationId &&
        row.classId === cls.classId,
    );
    const current = new Map<string, typeof cls>();
    for (const row of enrollments.sort((a, b) =>
      String(a.joinedAt).localeCompare(String(b.joinedAt)),
    )) {
      const customerId = String(row.customerId);
      if (
        current.get(customerId)?.status !== 'ACTIVE' ||
        row.status === 'ACTIVE'
      )
        current.set(customerId, row);
    }
    await repo.put({
      ...cls,
      sessionIds: rows
        .filter(
          (row) =>
            row.entity === 'classSession' &&
            row.organizationId === cls.organizationId &&
            row.classId === cls.classId,
        )
        .map((row) => row.sessionId),
      enrolledCount: enrollments.filter((row) => row.status === 'ACTIVE')
        .length,
    });
    await repo.put({
      ...classCatalogKey(String(cls.organizationId), String(cls.classId)),
      classId: cls.classId,
    });
    for (const row of current.values())
      await repo.put({
        ...classEnrollmentKey(
          String(cls.organizationId),
          String(cls.classId),
          String(row.customerId),
        ),
        enrollmentId: row.enrollmentId,
        status: row.status,
      });
  }
  return { classesIndexed: classes.length };
}
