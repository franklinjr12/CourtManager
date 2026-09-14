import { beforeEach, describe, expect, it } from 'vitest';
import { SESSION_STORAGE_KEY, setSession } from './auth.js';
import {
  CUSTOMER_SESSION_STORAGE_KEY,
  getCustomerSession,
  setCustomerSession,
} from './customer-auth.js';

describe('customer browser session', () => {
  beforeEach(() => localStorage.clear());

  it('does not overwrite the staff session', () => {
    setSession({
      token: 'staff-token',
      user: { userId: 'staff-1', name: 'Staff', role: 'STAFF' },
    });
    setCustomerSession({
      token: 'customer-token',
      organizationId: 'org-1',
      customerId: 'customer-1',
      customerAccountId: 'account-1',
      customer: { customerId: 'customer-1', name: 'Customer', archived: false },
    });

    expect(
      JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) ?? '{}'),
    ).toMatchObject({
      token: 'staff-token',
    });
    expect(
      JSON.parse(localStorage.getItem(CUSTOMER_SESSION_STORAGE_KEY) ?? '{}'),
    ).toMatchObject({ token: 'customer-token' });
    expect(getCustomerSession()?.customerId).toBe('customer-1');
  });
});
