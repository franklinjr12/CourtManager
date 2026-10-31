import { describe, expect, it } from 'vitest';
import {
  STAFF_DURATION_OPTIONS,
  expectedAmountFor,
  staffDurationSelect,
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

describe('staff duration options', () => {
  const select = (custom: boolean) => {
    const box = document.createElement('div');
    box.innerHTML = staffDurationSelect({ custom });
    return box.querySelector<HTMLSelectElement>('select')!;
  };
  const steps = ['30', '60', '90', '120', '150', '180', '210', '240'];

  it('lists 30 to 240 minutes in 30-minute steps', () => {
    expect(STAFF_DURATION_OPTIONS).toEqual([
      30, 60, 90, 120, 150, 180, 210, 240,
    ]);
  });

  it('offers the steps with 60 minutes preselected', () => {
    const el = select(false);
    expect([...el.options].map((o) => o.value)).toEqual(steps);
    expect(el.value).toBe('60');
  });

  it('adds a custom option and field when requested', () => {
    const el = select(true);
    expect([...el.options].map((o) => o.value)).toEqual([...steps, 'custom']);
    expect(el.value).toBe('60');
    const box = document.createElement('div');
    box.innerHTML = staffDurationSelect({ custom: true });
    expect(box.querySelector('#custom-duration-field')).not.toBeNull();
  });

  it('scales the expected amount with duration', () => {
    expect(expectedAmountFor(100, 90)).toBe('150.00');
    expect(expectedAmountFor(100, 60)).toBe('100.00');
  });
});
