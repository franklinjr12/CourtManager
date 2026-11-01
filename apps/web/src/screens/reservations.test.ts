import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppContext } from '../app/context.js';
import { isoFromInputs } from '../core/presentation.js';
import { t } from '../i18n.js';
import {
  STAFF_DURATION_OPTIONS,
  expectedAmountFor,
  openReservationDetail,
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

describe('reservation time edit form', () => {
  const fetchMock = vi.fn();
  const patches = () =>
    fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status });

  beforeEach(async () => {
    sessionStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    createAppContext(document.querySelector<HTMLDivElement>('#app')!);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async () => json(200, { data: reservation }));
    await openReservationDetail(reservation.reservationId);
  });
  afterEach(() => vi.unstubAllGlobals());

  const form = () =>
    document.querySelector<HTMLFormElement>('#reservation-edit-form')!;
  const input = (name: string) =>
    form().querySelector<HTMLInputElement>(`[name="${name}"]`)!;

  it('sends one PATCH with the new times and shows the updated toast', async () => {
    input('end').value = '23:30';
    form().requestSubmit();
    await vi.waitFor(() => expect(patches()).toHaveLength(1));
    const body = JSON.parse(String(patches()[0]![1].body));
    expect(body).toEqual({
      startAt: isoFromInputs(input('date').value, input('start').value),
      endAt: isoFromInputs(input('date').value, '23:30'),
    });
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(t('reservations.updated')),
    );
  });

  it('does not call the API when nothing changed', async () => {
    form().requestSubmit();
    await vi.waitFor(() =>
      expect(document.querySelector('#reservation-edit-form')).toBeNull(),
    );
    expect(patches()).toHaveLength(0);
    expect(document.body.textContent).toContain(t('reservations.updated'));
  });

  it('shows the schedule conflict message in the form alert', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'PATCH'
        ? json(409, {
            error: { code: 'SCHEDULE_CONFLICT', message: 'SCHEDULE_CONFLICT' },
          })
        : json(200, { data: reservation }),
    );
    input('end').value = '23:30';
    form().requestSubmit();
    await vi.waitFor(() =>
      expect(form().querySelector('[role="alert"]')!.textContent).toBe(
        t('errors.SCHEDULE_CONFLICT'),
      ),
    );
    expect(form().querySelector('[role="alert"]')!.textContent).not.toBe(
      t('errors.requestFailed'),
    );
  });
});
