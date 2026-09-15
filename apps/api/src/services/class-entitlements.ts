import type { EntitlementAllocation } from '@court-manager/contracts';
import type { RecordItem, Repository } from '../db.js';
import { dayKeyInTimezone } from '../domain.js';
import { EntitlementService } from './entitlements.js';

type ClassAttendanceInput = {
  organizationId: string;
  customerId: string;
  session: RecordItem;
  classRecord: RecordItem;
  attendanceId: string;
  createdBy: string;
};

/** Applies commercial coverage at the single authoritative attendance event. */
export class ClassEntitlementService {
  constructor(
    private readonly repo: Repository,
    private readonly entitlements: EntitlementService,
  ) {}

  private async organizationSettings(organizationId: string) {
    const organization = await this.repo.get({
      PK: `ORG#${organizationId}`,
      SK: 'META',
    });
    return {
      timezone: String(organization?.timezone ?? 'UTC'),
      currency: String(organization?.currency ?? 'BRL'),
    };
  }

  async consumeAttendance(
    input: ClassAttendanceInput,
  ): Promise<EntitlementAllocation | undefined> {
    const settings = await this.organizationSettings(input.organizationId);
    const classType: 'GROUP' | 'PRIVATE' =
      input.classRecord.type === 'PRIVATE' ? 'PRIVATE' : 'GROUP';
    const activity = {
      activityType:
        classType === 'PRIVATE'
          ? ('PRIVATE_LESSON' as const)
          : ('CLASS_ATTENDANCE' as const),
      activityId: input.attendanceId,
      quantity: 1,
      unit: 'SESSION' as const,
      occurredAt: String(input.session.startAt),
      venueDate: dayKeyInTimezone(
        String(input.session.startAt),
        settings.timezone,
      ),
      classId: String(input.classRecord.classId),
      classType,
      ...(input.classRecord.sportId
        ? { sportId: String(input.classRecord.sportId) }
        : {}),
      coveredAmount: Number(
        input.classRecord.pricePerParticipant ?? input.classRecord.price ?? 0,
      ),
      currency: settings.currency,
    };
    const candidates = await this.entitlements.getAvailableEntitlements(
      { organizationId: input.organizationId, customerId: input.customerId },
      activity,
    );
    const entitlement = candidates[0];
    if (!entitlement) return undefined;
    const result = await this.entitlements.consume({
      customer: {
        organizationId: input.organizationId,
        customerId: input.customerId,
      },
      activity,
      entitlement,
      coveredAmount: activity.coveredAmount,
      currency: settings.currency,
      createdBy: input.createdBy,
      createdAt: String(input.session.createdAt),
    });
    await this.applyChargeCoverage(input, result.allocation);
    return result.allocation;
  }

  private async applyChargeCoverage(
    input: ClassAttendanceInput,
    allocation: EntitlementAllocation,
  ) {
    const charge = await this.repo.get({
      PK: `CHARGE#class-${input.session.sessionId}-${input.customerId}`,
      SK: 'META',
    });
    if (!charge || charge.status !== 'ACTIVE') return;
    const remaining = Math.max(
      0,
      Number(charge.amount) - allocation.coveredAmount,
    );
    const timestamp = new Date().toISOString();
    await this.repo.put({
      ...charge,
      ...(remaining > 0
        ? { amount: Math.round(remaining * 100) / 100 }
        : {
            status: 'VOID',
            voidedAt: timestamp,
            voidedBy: input.createdBy,
            voidReason: 'Covered by entitlement',
          }),
    });
  }
}
