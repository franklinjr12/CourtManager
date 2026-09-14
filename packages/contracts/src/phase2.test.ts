import { describe, expect, it } from 'vitest';
import {
  BookingPolicySchema,
  CustomerAccountSchema,
  CustomerReservationInputSchema,
  CustomerSessionSchema,
  DEFAULT_BOOKING_POLICY,
  OrganizationSchema,
  ReservationSourceSchema,
  WaitlistSchema,
} from './index.js';

describe('Phase 2 contracts', () => {
  it('defaults legacy organizations to request approval policy', () => {
    const organization = OrganizationSchema.parse({
      organizationId: 'org-1',
      name: 'Arena',
      slug: 'arena',
      timezone: 'UTC',
      currency: 'BRL',
      active: true,
      features: { classes: false, finance: true },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(organization.bookingPolicy).toEqual(DEFAULT_BOOKING_POLICY);
    expect(BookingPolicySchema.parse(DEFAULT_BOOKING_POLICY)).toEqual(
      DEFAULT_BOOKING_POLICY,
    );
  });

  it('requires a positive customer booking horizon', () => {
    expect(
      BookingPolicySchema.safeParse({
        ...DEFAULT_BOOKING_POLICY,
        bookAheadDays: 0,
      }).success,
    ).toBe(false);
  });

  it('keeps customer credentials and sessions separate from staff identity', () => {
    const account = CustomerAccountSchema.parse({
      customerAccountId: 'account-1',
      organizationId: 'org-1',
      customerId: 'customer-1',
      email: 'ana@example.test',
      normalizedEmail: 'ana@example.test',
      passwordHash: 'hash',
      status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const session = CustomerSessionSchema.parse({
      customerSessionId: 'session-1',
      organizationId: account.organizationId,
      customerId: account.customerId,
      customerAccountId: account.customerAccountId,
      tokenHash: 'token-hash',
      expiresAt: 1_800_000_000,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(account).not.toHaveProperty('role');
    expect(session).toMatchObject({
      customerId: 'customer-1',
      customerAccountId: 'account-1',
    });
  });

  it('validates customer booking duration ordering and waitlist shape', () => {
    expect(
      CustomerReservationInputSchema.safeParse({
        courtId: 'court-1',
        startAt: '2027-01-01T18:00:00Z',
        endAt: '2027-01-01T17:00:00Z',
      }).success,
    ).toBe(false);
    expect(
      WaitlistSchema.safeParse({
        waitlistId: 'waitlist-1',
        organizationId: 'org-1',
        customerId: 'customer-1',
        type: 'COURT',
        status: 'ACTIVE',
        joinedAt: '2026-01-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('adds customer portal as a reservation source while retaining public requests', () => {
    expect(ReservationSourceSchema.parse('CUSTOMER_PORTAL')).toBe(
      'CUSTOMER_PORTAL',
    );
    expect(ReservationSourceSchema.parse('PUBLIC_REQUEST')).toBe(
      'PUBLIC_REQUEST',
    );
  });
});
