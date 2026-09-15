import { describe, expect, it } from 'vitest';
import { membershipActionBody } from './memberships.js';

describe('membership actions', () => {
  it('sends an idempotency key for renewal while keeping other actions empty', () => {
    expect(membershipActionBody('renew', 'renewal-1')).toBe(
      JSON.stringify({ idempotencyKey: 'renewal-1' }),
    );
    expect(membershipActionBody('pause', 'unused')).toBe('{}');
  });
});
