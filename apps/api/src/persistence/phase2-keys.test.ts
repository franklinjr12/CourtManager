import { describe, expect, it } from 'vitest';
import { phase2Keys } from './phase2-keys.js';

describe('Phase 2 DynamoDB access keys', () => {
  it('uses tenant/customer partitions for self-service reads', () => {
    expect(
      phase2Keys.customerAccountByEmail('org-1', 'ana@example.test'),
    ).toEqual({
      PK: 'ORG#org-1',
      SK: 'CUSTOMER_ACCOUNT_EMAIL#ana@example.test',
    });
    expect(
      phase2Keys.customerReservation(
        'org-1',
        'customer-1',
        '2027-01-01T18:00:00.000Z',
        'reservation-1',
      ),
    ).toEqual({
      PK: 'CUSTOMER#org-1#customer-1',
      SK: 'RESERVATION#2027-01-01T18:00:00.000Z#reservation-1',
    });
    expect(
      phase2Keys.classWaitlist(
        'org-1',
        'class-1',
        '2026-01-01T00:00:00.000Z',
        'waitlist-1',
      ),
    ).toEqual({
      PK: 'WAITLIST#org-1#CLASS#class-1',
      SK: 'ENTRY#2026-01-01T00:00:00.000Z#waitlist-1',
    });
    expect(
      phase2Keys.organizationWaitlist(
        'org-1',
        '2026-01-01T00:00:00.000Z',
        'waitlist-1',
      ),
    ).toEqual({
      PK: 'WAITLIST#org-1#ALL',
      SK: 'ENTRY#2026-01-01T00:00:00.000Z#waitlist-1',
    });
  });
});
