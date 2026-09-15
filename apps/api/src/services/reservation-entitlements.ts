import type {
  EntitlementAllocation,
  FixedCourtAgreement,
  Reservation,
} from '@court-manager/contracts';
import type { Repository } from '../db.js';
import {
  calculateDuration,
  dayKeyInTimezone,
  localTime,
  weekdayNameForDate,
} from '../domain.js';
import { Phase3Repository } from '../persistence/phase3-repository.js';
import {
  EntitlementService,
  type AvailableEntitlement,
} from './entitlements.js';

type ReservationContext = {
  organizationId: string;
  userId: string;
};

export type ReservationEntitlementResult = {
  allocations: EntitlementAllocation[];
  coveredAmount: number;
  uncoveredAmount: number;
};

const roundMoney = (value: number) => Math.round((value + 1e-9) * 100) / 100;

const localDateDifference = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T12:00:00.000Z`) - Date.parse(`${from}T12:00:00.000Z`)) /
      86400000,
  );

const addLocalDays = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

/**
 * Applies commercial coverage to reservations while keeping the reservation
 * and the direct-charge model authoritative. Credit consumption itself is
 * delegated to the atomic entitlement repository operation.
 */
export class ReservationEntitlementService {
  private readonly commercial: Phase3Repository;

  constructor(
    private readonly repo: Repository,
    private readonly entitlements: EntitlementService,
  ) {
    this.commercial = new Phase3Repository(repo);
  }

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

  private matchesFixedAgreement(
    agreement: FixedCourtAgreement,
    reservation: Reservation,
  ) {
    if (agreement.status !== 'ACTIVE') return false;
    if (agreement.courtId !== reservation.courtId) return false;
    const timezone = agreement.timezone;
    const date = dayKeyInTimezone(reservation.startAt, timezone);
    const startTime = localTime(new Date(reservation.startAt), timezone);
    const duration = calculateDuration(
      new Date(reservation.startAt),
      new Date(reservation.endAt),
    );
    const firstOccurrence = Array.from({ length: 7 }, (_, offset) =>
      addLocalDays(agreement.startDate, offset),
    ).find((candidate) => weekdayNameForDate(candidate) === agreement.weekday);
    if (!firstOccurrence) return false;
    return (
      date >= agreement.startDate &&
      (!agreement.endDate || date <= agreement.endDate) &&
      weekdayNameForDate(date) === agreement.weekday &&
      startTime === agreement.startTime &&
      duration === agreement.durationMinutes &&
      localDateDifference(firstOccurrence, date) >= 0 &&
      localDateDifference(firstOccurrence, date) %
        (7 * agreement.intervalWeeks) ===
        0
    );
  }

  private async fixedCandidates(
    reservation: Reservation,
  ): Promise<AvailableEntitlement[]> {
    const agreements = await this.commercial.listFixedCourtAgreementsByCustomer(
      reservation.organizationId,
      reservation.customerId,
      { activeOnly: true },
    );
    return agreements
      .filter((agreement) => this.matchesFixedAgreement(agreement, reservation))
      .sort((a, b) => a.agreementId.localeCompare(b.agreementId))
      .map((agreement) => ({
        sourceType: 'FIXED_AGREEMENT' as const,
        sourceId: agreement.agreementId,
        benefitId: 'fixed-court-time',
        benefit: {
          type: 'COURT_TIME' as const,
          period: 'PACKAGE_LIFETIME' as const,
          quantityType: 'UNLIMITED' as const,
          unit: 'COURT_MINUTES' as const,
        },
        unit: 'COURT_MINUTES' as const,
        quantityType: 'UNLIMITED' as const,
        availableQuantity: null,
        ...(agreement.endDate
          ? { expiresAt: `${agreement.endDate}T23:59:59.999Z` }
          : {}),
      }));
  }

  private async candidates(reservation: Reservation) {
    const settings = await this.organizationSettings(
      reservation.organizationId,
    );
    const activity = {
      activityType: 'RESERVATION' as const,
      activityId: reservation.reservationId,
      quantity: calculateDuration(
        new Date(reservation.startAt),
        new Date(reservation.endAt),
      ),
      unit: 'COURT_MINUTES' as const,
      occurredAt: reservation.startAt,
      venueDate: dayKeyInTimezone(reservation.startAt, settings.timezone),
      coveredAmount: reservation.serviceAmount ?? reservation.expectedAmount,
      currency: settings.currency,
    };
    const regular = await this.entitlements.getAvailableEntitlements(
      {
        organizationId: reservation.organizationId,
        customerId: reservation.customerId,
      },
      activity,
    );
    return {
      settings,
      activity,
      candidates: [...(await this.fixedCandidates(reservation)), ...regular],
    };
  }

  async apply(
    context: ReservationContext,
    reservation: Reservation,
  ): Promise<ReservationEntitlementResult> {
    const existing = await this.commercial.listAllocationsByActivity(
      reservation.organizationId,
      'RESERVATION',
      reservation.reservationId,
    );
    const activeExisting = existing.filter(
      (allocation) => allocation.status === 'ACTIVE',
    );
    if (activeExisting.length) {
      const coveredAmount = roundMoney(
        activeExisting.reduce(
          (total, allocation) => total + allocation.coveredAmount,
          0,
        ),
      );
      return {
        allocations: activeExisting,
        coveredAmount,
        uncoveredAmount: roundMoney(
          Math.max(
            0,
            (reservation.serviceAmount ?? reservation.expectedAmount) -
              coveredAmount,
          ),
        ),
      };
    }

    const { activity, candidates } = await this.candidates(reservation);
    const serviceAmount =
      reservation.serviceAmount ?? reservation.expectedAmount;
    let remainingQuantity = activity.quantity;
    let remainingAmount = serviceAmount;
    const allocations: EntitlementAllocation[] = [];

    try {
      for (const candidate of candidates) {
        if (remainingQuantity <= 0) break;
        const coverage = this.entitlements.calculateCoverage(
          {
            ...activity,
            quantity: remainingQuantity,
            coveredAmount: remainingAmount,
          },
          candidate,
        );
        if (!coverage) continue;
        const coveredAmount =
          coverage.quantity === remainingQuantity
            ? roundMoney(remainingAmount)
            : roundMoney(
                (serviceAmount * coverage.quantity) / activity.quantity,
              );
        if (candidate.sourceType === 'FIXED_AGREEMENT')
          await this.entitlements.ensureUnlimitedSource({
            organizationId: reservation.organizationId,
            customerId: reservation.customerId,
            sourceType: candidate.sourceType,
            sourceId: candidate.sourceId,
            ...(candidate.benefitId ? { benefitId: candidate.benefitId } : {}),
            unit: candidate.unit,
            createdBy: context.userId,
            occurredAt: reservation.startAt,
            createdAt: reservation.createdAt,
          });
        const consumed = await this.entitlements.consume({
          organizationId: reservation.organizationId,
          customerId: reservation.customerId,
          sourceType: candidate.sourceType,
          sourceId: candidate.sourceId,
          ...(candidate.membershipPeriodId
            ? { membershipPeriodId: candidate.membershipPeriodId }
            : {}),
          ...(candidate.benefitId ? { benefitId: candidate.benefitId } : {}),
          ...(candidate.benefitPeriodKey
            ? { benefitPeriodKey: candidate.benefitPeriodKey }
            : {}),
          activityType: 'RESERVATION',
          activityId: reservation.reservationId,
          unit: 'COURT_MINUTES',
          quantity: coverage.quantity,
          coveredAmount,
          currency: activity.currency,
          createdBy: context.userId,
          occurredAt: reservation.startAt,
          createdAt: reservation.createdAt,
        });
        allocations.push(consumed.allocation);
        remainingQuantity -= coverage.quantity;
        remainingAmount = roundMoney(remainingAmount - coveredAmount);
      }
    } catch (error) {
      for (const allocation of allocations) {
        if (allocation.status === 'ACTIVE')
          await this.entitlements.restore({
            organizationId: reservation.organizationId,
            allocationId: allocation.allocationId,
            createdBy: context.userId,
            reason: 'Reservation entitlement allocation rolled back',
            restorationId: `reservation-create-rollback:${reservation.reservationId}`,
            occurredAt: reservation.startAt,
            createdAt: reservation.createdAt,
          });
      }
      throw error;
    }

    return {
      allocations,
      coveredAmount: roundMoney(serviceAmount - remainingAmount),
      uncoveredAmount: remainingAmount,
    };
  }

  private async restoreAllocations(
    context: ReservationContext,
    reservation: Reservation,
    reason: string,
    restorationId: string,
  ) {
    const allocations = await this.commercial.listAllocationsByActivity(
      reservation.organizationId,
      'RESERVATION',
      reservation.reservationId,
    );
    for (const allocation of allocations) {
      if (allocation.status !== 'ACTIVE') continue;
      await this.entitlements.restore({
        organizationId: reservation.organizationId,
        allocationId: allocation.allocationId,
        createdBy: context.userId,
        reason,
        restorationId,
        occurredAt: reservation.cancelledAt ?? new Date().toISOString(),
      });
    }
    return allocations;
  }

  async restoreForCancellation(
    context: ReservationContext,
    reservation: Reservation,
  ) {
    return this.restoreAllocations(
      context,
      reservation,
      'Reservation cancelled before service',
      `reservation-cancel:${reservation.reservationId}`,
    );
  }

  async allocations(reservation: Reservation) {
    return this.commercial.listAllocationsByActivity(
      reservation.organizationId,
      'RESERVATION',
      reservation.reservationId,
    );
  }
}
