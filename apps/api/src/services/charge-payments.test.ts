import { describe, expect, it } from 'vitest';
import type { RecordItem } from '../db.js';
import { paidAmountForCharge } from './charge-payments.js';

const item = (fields: Record<string, unknown>) => fields as RecordItem;

describe('paidAmountForCharge', () => {
  const charge = item({ chargeId: 'c1', reservationId: 'r1' });

  it('sums payments linked by chargeId', () => {
    expect(
      paidAmountForCharge(charge, [
        item({ chargeId: 'c1', amount: 50 }),
        item({ chargeId: 'c1', amount: 30 }),
      ]),
    ).toBe(80);
  });

  it('falls back to reservationId when the payment has no chargeId', () => {
    expect(
      paidAmountForCharge(charge, [item({ reservationId: 'r1', amount: 40 })]),
    ).toBe(40);
  });

  it('ignores payments linked to a different charge', () => {
    expect(
      paidAmountForCharge(charge, [
        item({ chargeId: 'c2', reservationId: 'r1', amount: 99 }),
      ]),
    ).toBe(0);
  });
});
