import { describe, expect, it } from 'vitest';
import {
  commercialOutstandingAmount,
  commercialOverviewMetrics,
} from './commercial-overview.js';

describe('commercial overview metrics', () => {
  it('counts actionable memberships, expiring packages, and fixed agreements', () => {
    const result = commercialOverviewMetrics({
      today: '2026-09-15',
      memberships: [
        {
          status: 'ACTIVE',
          currentPeriodEnd: '2026-09-14',
          nextRenewalDate: '2026-09-20',
        },
        {
          status: 'ACTIVE',
          currentPeriodEnd: '2026-09-30',
          nextRenewalDate: '2026-09-30',
        },
        {
          status: 'PAUSED',
          currentPeriodEnd: '2026-09-14',
          nextRenewalDate: '2026-09-20',
        },
      ] as never,
      renewals: [{ status: 'ACTIVE' }] as never,
      packages: [{ status: 'ACTIVE' }, { status: 'CONSUMED' }] as never,
      agreements: [{ status: 'ACTIVE' }, { status: 'PAUSED' }] as never,
    });

    expect(result).toEqual({
      activeMemberships: 2,
      renewalsDue: 1,
      overdueMemberships: 1,
      packagesExpiring: 1,
      activeFixedAgreements: 1,
    });
  });

  it('sums only the commercial charge categories shown on the overview', () => {
    expect(
      commercialOutstandingAmount([
        { outstanding: 300 },
        { outstanding: 125 },
        { outstanding: 75 },
      ]),
    ).toBe(500);
  });
});
