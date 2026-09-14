import { describe, expect, it } from 'vitest';
import { resolveDevelopmentBookingMode } from './seed-dev-config.js';

describe('development seed booking mode', () => {
  it('defaults to request approval and accepts selectable venue modes', () => {
    expect(resolveDevelopmentBookingMode('')).toBe('REQUEST_APPROVAL');
    expect(resolveDevelopmentBookingMode('auto_confirm')).toBe('AUTO_CONFIRM');
    expect(resolveDevelopmentBookingMode('STAFF_ONLY')).toBe('STAFF_ONLY');
  });

  it('rejects invalid mode values before writing seed data', () => {
    expect(() => resolveDevelopmentBookingMode('LIVE')).toThrow(
      'DEV_BOOKING_MODE must be one of STAFF_ONLY, REQUEST_APPROVAL, AUTO_CONFIRM.',
    );
  });
});
