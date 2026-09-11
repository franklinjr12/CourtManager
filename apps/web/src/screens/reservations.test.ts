import { describe, expect, it } from 'vitest';
import {
  reservationIsEditable,
  reservationTimeChanged,
  wireReservationDetailButtons,
} from './reservations.js';

const reservation = {
  reservationId: 'reservation-1',
  courtId: 'court-1',
  customerId: 'customer-1',
  startAt: '2026-09-11T13:00:00.000Z',
  endAt: '2026-09-11T14:00:00.000Z',
  status: 'BOOKED',
  source: 'STAFF',
  expectedAmount: 80,
};

describe('reservation detail editing', () => {
  it('allows editing normalized booked reservations', () => {
    expect(reservationIsEditable('BOOKED')).toBe(true);
    expect(reservationIsEditable('CONFIRMED')).toBe(true);
    expect(reservationIsEditable('COMPLETED')).toBe(false);
  });

  it('detects date or time changes for paid-edit confirmation', () => {
    expect(
      reservationTimeChanged(
        reservation,
        reservation.startAt,
        reservation.endAt,
      ),
    ).toBe(false);
    expect(
      reservationTimeChanged(
        reservation,
        '2026-09-12T13:00:00.000Z',
        reservation.endAt,
      ),
    ).toBe(true);
  });

  it('wires reservation detail buttons through shared binding', () => {
    let bound = '';
    const root = {
      querySelectorAll: () => [
        {
          dataset: { reservation: 'reservation-1' },
          addEventListener: (event: string) => {
            bound = event;
          },
        },
      ],
    } as unknown as ParentNode;

    wireReservationDetailButtons(root);

    expect(bound).toBe('click');
  });
});
