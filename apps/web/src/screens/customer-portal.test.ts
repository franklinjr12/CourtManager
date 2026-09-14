import { afterEach, expect, it, vi } from 'vitest';
import { createAppContext } from '../app/context.js';
import { getCustomerSession, setCustomerSession } from '../customer-auth.js';
import { customerPortal, customerPortalPage } from './customer-portal.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('keeps the sign-in link after asynchronous registration and resets the form', async () => {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const context = createAppContext(root);
  vi.spyOn(context, 'request').mockResolvedValue({});
  await customerPortal('arena', 'register');
  const form = root.querySelector('form')!;
  (form.elements.namedItem('name') as HTMLInputElement).value = 'Maria';
  (form.elements.namedItem('email') as HTMLInputElement).value =
    'maria@example.test';
  (form.elements.namedItem('phone') as HTMLInputElement).value = '41999991111';
  (form.elements.namedItem('password') as HTMLInputElement).value = 'secret';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect(root.querySelector('#portal-result')?.textContent).toBe(
      'Conta criada. Entrar',
    ),
  );
  expect(root.querySelector('a')?.getAttribute('href')).toBe(
    '/portal/arena/login',
  );
  expect((form.elements.namedItem('name') as HTMLInputElement).value).toBe('');
});

it('retains the login token when refreshing the customer profile before loading activities', async () => {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  createAppContext(root);
  const profile = {
    organizationId: 'org',
    customerId: 'owner',
    customerAccountId: 'account',
    customer: { customerId: 'owner', name: 'Maria', archived: false },
  };
  setCustomerSession({ ...profile, token: 'customer-token' });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: profile })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })));
  vi.stubGlobal('fetch', fetcher);
  await customerPortalPage('arena', 'home');
  expect(getCustomerSession()?.token).toBe('customer-token');
  expect(fetcher.mock.calls[1]?.[1].headers.Authorization).toBe(
    'Bearer customer-token',
  );
  expect(root.textContent).toContain('Maria');
});

it('shows Book again only for historical reservations and opens a prefilled draft', async () => {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  createAppContext(root);
  window.history.pushState({}, '', '/portal/arena/reservations');
  setCustomerSession({
    token: 'customer-token',
    organizationId: 'org',
    customerId: 'customer-1',
    customerAccountId: 'account-1',
    customer: { customerId: 'customer-1', name: 'Maria', archived: false },
  });
  const historical = {
    itemType: 'RESERVATION',
    reservationId: 'reservation-1',
    court: { courtId: 'court-1', name: 'Court 1', sport: 'Tennis' },
    startAt: '2026-09-12T10:00:00.000Z',
    endAt: '2026-09-12T11:30:00.000Z',
    durationMinutes: 90,
    status: 'COMPLETED',
    source: 'STAFF',
    expectedAmount: 120,
    cancellationEligibility: {
      reservationId: 'reservation-1',
      eligible: false,
      status: 'COMPLETED',
      cutoffAt: '2026-09-12T04:00:00.000Z',
      evaluatedAt: '2026-09-13T12:00:00.000Z',
      reason: 'Reservation is already completed.',
    },
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ data: getCustomerSession() })),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { reservations: [], requests: [] } }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [historical], nextCursor: null })),
    );
  vi.stubGlobal('fetch', fetcher);
  await customerPortalPage('arena', 'reservations');
  const link = root.querySelector<HTMLAnchorElement>('a.button');
  expect(link?.textContent).toBe('Reservar novamente');
  expect(link?.getAttribute('href')).toBe(
    '/portal/arena/book?rebook=reservation-1',
  );
});

it('uses rebooking response availability to preselect historical court, time, and duration', async () => {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  createAppContext(root);
  setCustomerSession({
    token: 'customer-token',
    organizationId: 'org',
    customerId: 'customer-1',
    customerAccountId: 'account-1',
    customer: { customerId: 'customer-1', name: 'Maria', archived: false },
  });
  window.history.pushState({}, '', '/portal/arena/book?rebook=reservation-1');
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            organizationId: 'org',
            customerId: 'customer-1',
            customerAccountId: 'account-1',
            customer: {
              customerId: 'customer-1',
              name: 'Maria',
              archived: false,
            },
          },
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            reservationMode: 'AUTO_CONFIRM',
            minimumReservationMinutes: 30,
            maximumReservationMinutes: 120,
          },
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { timezone: 'UTC' } })),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            sourceReservationId: 'reservation-1',
            date: '2026-09-19',
            startTime: '10:00',
            durationMinutes: 90,
            sport: 'Tennis',
            preferredCourtId: 'court-1',
            availability: {
              allowedDurations: [30, 60, 90, 120],
              onlineBookingAvailable: true,
              courts: [
                {
                  courtId: 'court-1',
                  name: 'Court 1',
                  sport: 'Tennis',
                  slotMinutes: 30,
                  available: ['10:00'],
                },
              ],
            },
          },
        }),
      ),
    );
  vi.stubGlobal('fetch', fetcher);
  await customerPortalPage('arena', 'book');
  await vi.waitFor(() =>
    expect(
      root.querySelector<HTMLInputElement>('input[name="date"]')?.value,
    ).toBe('2026-09-19'),
  );
  expect(
    root.querySelector<HTMLSelectElement>('select[name="durationMinutes"]')
      ?.value,
  ).toBe('90');
  expect(
    root.querySelector<HTMLInputElement>('input[name="slot"]')?.checked,
  ).toBe(true);
});

it('lets customer update contact details through labeled profile form', async () => {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  createAppContext(root);
  window.history.pushState({}, '', '/portal/arena/profile');
  const profile = {
    organizationId: 'org',
    customerId: 'customer-1',
    customerAccountId: 'account-1',
    customer: {
      customerId: 'customer-1',
      name: 'Maria',
      email: 'maria@example.test',
      phone: '41999991111',
      archived: false,
    },
  };
  setCustomerSession({ ...profile, token: 'customer-token' });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: profile })))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            customer: { ...profile.customer, name: 'Maria Silva' },
            account: {},
          },
        }),
      ),
    );
  vi.stubGlobal('fetch', fetcher);
  await customerPortalPage('arena', 'profile');
  const form = root.querySelector<HTMLFormElement>('#portal-profile-form')!;
  (form.elements.namedItem('name') as HTMLInputElement).value = 'Maria Silva';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect(root.textContent).toContain('Perfil atualizado.'),
  );
  expect(fetcher.mock.calls[1]?.[1].method).toBe('PATCH');
  expect(JSON.parse(String(fetcher.mock.calls[1]?.[1].body))).toMatchObject({
    name: 'Maria Silva',
  });
});

it('shows request approval as unconfirmed and changes booking action label', async () => {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  createAppContext(root);
  window.history.pushState({}, '', '/portal/arena/book');
  setCustomerSession({
    token: 'customer-token',
    organizationId: 'org',
    customerId: 'customer-1',
    customerAccountId: 'account-1',
    customer: { customerId: 'customer-1', name: 'Maria', archived: false },
  });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            organizationId: 'org',
            customerId: 'customer-1',
            customerAccountId: 'account-1',
            customer: {
              customerId: 'customer-1',
              name: 'Maria',
              archived: false,
            },
          },
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            reservationMode: 'REQUEST_APPROVAL',
            minimumReservationMinutes: 60,
            maximumReservationMinutes: 60,
          },
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { timezone: 'UTC' } })),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            allowedDurations: [60],
            onlineBookingAvailable: true,
            courts: [
              {
                courtId: 'court-1',
                name: 'Court 1',
                sport: 'Tennis',
                available: ['10:00'],
              },
            ],
          },
        }),
      ),
    );
  vi.stubGlobal('fetch', fetcher);
  await customerPortalPage('arena', 'book');
  await vi.waitFor(() =>
    expect(root.querySelector('#portal-booking-policy')?.textContent).toContain(
      'Este horário foi solicitado',
    ),
  );
  expect(
    root
      .querySelector('#portal-booking-policy')
      ?.classList.contains('portal-request-note'),
  ).toBe(true);
  expect(
    root.querySelector<HTMLButtonElement>('#portal-booking-confirm')
      ?.textContent,
  ).toBe('Enviar solicitação de reserva');
});
it('keeps a retryable localized error when portal profile request loses network', async () => {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  createAppContext(root);
  setCustomerSession({
    token: 'customer-token',
    organizationId: 'org',
    customerId: 'customer-1',
    customerAccountId: 'account-1',
    customer: { customerId: 'customer-1', name: 'Maria', archived: false },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
  );
  await customerPortalPage('arena', 'home');
  expect(root.querySelector('[role="alert"]')?.textContent).toContain(
    'Erro de conexão',
  );
  expect(root.querySelector('a.button')?.textContent).toBe('Tentar novamente');
});
