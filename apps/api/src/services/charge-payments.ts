import type { RecordItem } from '../db.js';

// Sums every payment linked to the charge, whatever its paidAt date.
export function paidAmountForCharge(
  charge: RecordItem,
  payments: RecordItem[],
): number {
  return payments
    .filter(
      (payment) =>
        payment.chargeId === charge.chargeId ||
        (!payment.chargeId &&
          ((charge.reservationId &&
            payment.reservationId === charge.reservationId) ||
            (charge.classId && payment.classId === charge.classId))),
    )
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
}
