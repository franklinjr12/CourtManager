import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppContext } from '../app/context.js';
import { isoFromInputs } from '../core/presentation.js';
import { t } from '../i18n.js';
import {
  STAFF_DURATION_OPTIONS,
  expectedAmountFor,
  openRecurringReservationModal,
  openReservationDetail,
  openReservationModal,
  staffDurationSelect,
  reservationDetailActions,
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

describe('reservation detail actions per status', () => {
  const fetchMock = vi.fn();
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status });
  const posts = () =>
    fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
  const open = async (status: string) => {
    fetchMock.mockImplementation(async () =>
      json(200, { data: { ...reservation, status } }),
    );
    await openReservationDetail(reservation.reservationId);
  };
  const transitions = () =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '.modal .detail-actions [data-transition]',
      ),
    ].map((element) => element.dataset.transition);

  beforeEach(() => {
    sessionStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    createAppContext(document.querySelector<HTMLDivElement>('#app')!);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('maps statuses to API-accepted actions', () => {
    expect(reservationDetailActions('BOOKED')).toEqual({
      transitions: ['CHECKED_IN', 'NO_SHOW', 'CANCELLED'],
      payment: true,
    });
    expect(reservationDetailActions('CHECKED_IN')).toEqual({
      transitions: ['COMPLETED'],
      payment: true,
    });
    expect(reservationDetailActions('COMPLETED')).toEqual({
      transitions: [],
      payment: true,
    });
    expect(reservationDetailActions('NO_SHOW')).toEqual({
      transitions: [],
      payment: false,
    });
    expect(reservationDetailActions('CANCELLED')).toEqual({
      transitions: [],
      payment: false,
    });
  });

  it.each([
    ['BOOKED', ['CHECKED_IN', 'NO_SHOW', 'CANCELLED'], true],
    ['CHECKED_IN', ['COMPLETED'], true],
    ['COMPLETED', [], true],
    ['NO_SHOW', [], false],
    ['CANCELLED', [], false],
  ])('renders the buttons for %s', async (status, expected, payment) => {
    await open(status);
    expect(transitions()).toEqual(expected);
    expect(!!document.querySelector('.modal [data-payment]')).toBe(payment);
    if (status === 'BOOKED') expect(transitions()).not.toContain('COMPLETED');
  });

  it('completes a checked-in reservation from the UI', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fetchMock.mockImplementation(async (_url, init) =>
      json(200, {
        data: {
          ...reservation,
          status: init?.method ? 'COMPLETED' : 'CHECKED_IN',
        },
      }),
    );
    await openReservationDetail(reservation.reservationId);
    document
      .querySelector<HTMLElement>('[data-transition="COMPLETED"]')!
      .click();
    await vi.waitFor(() => expect(posts()).toHaveLength(1));
    expect(String(posts()[0]![0])).toContain(
      '/reservations/reservation-1/complete',
    );
  });

  it('asks the check-in question, not the complete one', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await open('BOOKED');
    document
      .querySelector<HTMLElement>('[data-transition="CHECKED_IN"]')!
      .click();
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm).toHaveBeenCalledWith(t('reservations.checkInConfirmation'));
    expect(confirm).not.toHaveBeenCalledWith(
      t('reservations.completeConfirmation'),
    );
    expect(posts()).toHaveLength(0);
  });
});

describe('explicit customer choice in reservation forms', () => {
  const fetchMock = vi.fn();
  const json = (body: unknown) =>
    new Response(JSON.stringify({ data: body }), { status: 200 });
  const posts = () =>
    fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

  beforeEach(() => {
    sessionStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    createAppContext(document.querySelector<HTMLDivElement>('#app')!);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (url: string) => {
      const path = String(url);
      if (path.includes('/courts'))
        return json([{ courtId: 'court-1', name: 'Court 1', sport: 'Tennis' }]);
      if (path.includes('/customers'))
        return json([{ customerId: 'customer-1', name: 'Ana' }]);
      return json({ slots: [] });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['reservation-form', () => openReservationModal()],
    ['recurring-form', () => openRecurringReservationModal()],
  ])('%s starts on the placeholder and blocks saving', async (id, open) => {
    await open();
    const form = document.querySelector<HTMLFormElement>(`#${id}`)!;
    const select = form.querySelector<HTMLSelectElement>(
      '[name="customerId"]',
    )!;
    expect(select.options[0]!.value).toBe('');
    expect(select.options[0]!.textContent).toBe(
      t('reservations.selectCustomer'),
    );
    expect(select.options[0]!.selected).toBe(true);
    expect(select.value).toBe('');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() =>
      expect(form.querySelector('.form-error')!.textContent).toBe(
        t('reservations.selectCustomer'),
      ),
    );
    expect(posts()).toHaveLength(0);
  });
});
