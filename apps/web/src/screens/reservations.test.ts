import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppContext } from '../app/context.js';
import { setSession } from '../auth.js';
import { isoFromInputs } from '../core/presentation.js';
import { t } from '../i18n.js';
import {
  STAFF_DURATION_OPTIONS,
  expectedAmountFor,
  openRecurringReservationModal,
  openReservationDetail,
  openReservationModal,
  reservations,
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

describe('reservations list screen', () => {
  const fetchMock = vi.fn();
  const json = (body: unknown) => new Response(JSON.stringify(body));
  const row = (id: string, courtName: string) => ({
    ...reservation,
    reservationId: id,
    courtName,
    customerName: `Customer ${id}`,
  });
  const listCalls = () =>
    fetchMock.mock.calls
      .map(([url]) => new URL(String(url)))
      .filter((url) => url.pathname === '/reservations');

  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/reservations');
    document.body.innerHTML = '<div id="app"></div>';
    createAppContext(document.querySelector<HTMLDivElement>('#app')!);
    setSession({
      token: 't',
      user: { name: 'Staff', role: 'STAFF' },
      organization: { name: 'Org', timezone: 'America/Sao_Paulo' },
    } as never);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (url: string) => {
      const target = new URL(String(url));
      if (target.pathname !== '/reservations') return json({ data: [] });
      return target.searchParams.get('cursor')
        ? json({ data: [row('r3', 'Court B')], nextCursor: null })
        : json({
            data: [row('r1', 'Court A'), row('r2', 'Court A')],
            nextCursor: 'cursor-1',
          });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const rows = () => document.querySelectorAll('#screen tbody tr');

  it('requests the first page from today and renders names', async () => {
    await reservations();
    await vi.waitFor(() => expect(rows()).toHaveLength(2));
    const first = listCalls()[0]!;
    expect(first.searchParams.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first.searchParams.has('to')).toBe(false);
    expect(rows()[0]!.textContent).toContain('Court A');
    expect(rows()[0]!.textContent).toContain('Customer r1');
  });

  it('applies a range, updates the URL and reloads', async () => {
    await reservations();
    await vi.waitFor(() => expect(rows()).toHaveLength(2));
    const form = document.querySelector<HTMLFormElement>(
      '#reservation-filters',
    )!;
    form.querySelector<HTMLInputElement>('[name="from"]')!.value = '2027-01-10';
    form.querySelector<HTMLInputElement>('[name="to"]')!.value = '2027-01-20';
    form.requestSubmit();
    await vi.waitFor(() => expect(listCalls()).toHaveLength(2));
    const last = listCalls()[1]!;
    expect(last.searchParams.get('from')).toBe('2027-01-10');
    expect(last.searchParams.get('to')).toBe('2027-01-20');
    expect(window.location.search).toBe('?from=2027-01-10&to=2027-01-20');
  });

  it('sends the cursor for the next page, appends rows and hides the button at the end', async () => {
    await reservations();
    await vi.waitFor(() => expect(rows()).toHaveLength(2));
    const next = document.querySelector<HTMLButtonElement>('[data-next-page]')!;
    expect(next.hidden).toBe(false);
    next.click();
    await vi.waitFor(() => expect(rows()).toHaveLength(3));
    expect(listCalls()[1]!.searchParams.get('cursor')).toBe('cursor-1');
    expect(next.hidden).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>('[data-first-page]')!.hidden,
    ).toBe(false);
  });

  it('reads the range from the URL and shows an empty state', async () => {
    window.history.replaceState({}, '', '/reservations?from=&to=2027-02-01');
    fetchMock.mockImplementation(async () =>
      json({ data: [], nextCursor: null }),
    );
    await reservations();
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(
        t('reservations.noReservationsInRange'),
      ),
    );
    const call = listCalls()[0]!;
    expect(call.searchParams.has('from')).toBe(false);
    expect(call.searchParams.get('to')).toBe('2027-02-01');
    expect(
      document.querySelector<HTMLButtonElement>('[data-next-page]')!.hidden,
    ).toBe(true);
  });
});
