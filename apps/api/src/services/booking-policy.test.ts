import { DEFAULT_BOOKING_POLICY, type Court } from '@court-manager/contracts';
import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../db.js';
import { BookingPolicyService } from './booking-policy.js';

const court = {
  courtId: 'court-1',
  organizationId: 'org-1',
  name: 'Court',
  sport: 'Tennis',
  active: true,
  publiclyRequestable: true,
  slotMinutes: 60,
  defaultHourlyPrice: 80,
  openingHours: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as Court;

describe('BookingPolicyService', () => {
  it('enforces cancellation cutoff at exact timestamp boundaries', () => {
    const service = new BookingPolicyService(new MemoryRepository());
    const reservation = {
      reservationId: 'reservation-1',
      organizationId: 'org-1',
      courtId: 'court-1',
      customerId: 'customer-1',
      startAt: '2026-03-08T05:00:00.000Z',
      endAt: '2026-03-08T06:00:00.000Z',
      status: 'BOOKED' as const,
      source: 'CUSTOMER_PORTAL' as const,
      expectedAmount: 80,
      createdBy: 'customer-account-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedBy: 'customer-account-1',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const policy = { ...DEFAULT_BOOKING_POLICY, cancellationCutoffHours: 6 };
    expect(
      service.customerCancellationEligibility(
        reservation,
        policy,
        new Date('2026-03-07T22:59:59.999Z'),
      ).eligible,
    ).toBe(true);
    expect(
      service.customerCancellationEligibility(
        reservation,
        policy,
        new Date('2026-03-07T23:00:00.000Z'),
      ),
    ).toMatchObject({
      eligible: false,
      cutoffAt: '2026-03-07T23:00:00.000Z',
      reason: 'Cancellation period has ended.',
    });
  });

  it('uses venue-local dates at booking window boundaries', () => {
    const service = new BookingPolicyService(new MemoryRepository());
    const policy = { ...DEFAULT_BOOKING_POLICY, bookAheadDays: 1 };
    const at = new Date('2026-01-01T02:30:00.000Z');
    expect(
      service.customerBookingWindow(policy, 'America/Sao_Paulo', at),
    ).toEqual({ firstDate: '2025-12-31', lastDate: '2026-01-01' });
    expect(() =>
      service.assertCustomerCanBook(
        policy,
        'America/Sao_Paulo',
        court,
        '2026-01-02T01:00:00.000Z',
        '2026-01-02T02:00:00.000Z',
        at,
      ),
    ).not.toThrow();
    expect(() =>
      service.assertCustomerCanBook(
        policy,
        'America/Sao_Paulo',
        court,
        '2026-01-02T03:00:00.000Z',
        '2026-01-02T04:00:00.000Z',
        at,
      ),
    ).toThrow('outside the customer booking window');
  });

  it('counts pending requests with booked and checked-in commitments', async () => {
    const repo = new MemoryRepository();
    const service = new BookingPolicyService(repo);
    const future = '2027-01-01T18:00:00.000Z';
    for (const [entity, id, status] of [
      ['reservation', 'booked', 'BOOKED'],
      ['reservation', 'checked-in', 'CHECKED_IN'],
      ['request', 'pending', 'REQUESTED'],
      ['reservation', 'cancelled', 'CANCELLED'],
    ] as const)
      await repo.put({
        PK: `${entity.toUpperCase()}#${id}`,
        SK: 'META',
        entity,
        organizationId: 'org-1',
        customerId: entity === 'reservation' ? 'customer-1' : undefined,
        linkedCustomerId: entity === 'request' ? 'customer-1' : undefined,
        status,
        endAt: future,
        requestedEndAt: future,
      });
    expect(
      await service.customerActiveBookingCount(
        'org-1',
        'customer-1',
        new Date('2026-01-01T00:00:00.000Z'),
      ),
    ).toBe(3);
    await expect(
      service.assertCustomerCanCreateBooking(
        'org-1',
        'customer-1',
        { ...DEFAULT_BOOKING_POLICY, maximumActiveBookings: 3 },
        new Date('2026-01-01T00:00:00.000Z'),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
