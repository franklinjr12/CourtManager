import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerCharge } from '../core/types.js';
import { setLocale } from '../i18n.js';
import { shell } from '../ui/shell.js';
import { finance } from './finance.js';
import {
  chargeOptionLabel,
  openPaymentModal,
  paymentRequestBody,
} from './payment-modal.js';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('./runtime.js', () => ({
  app: document.body,
  escapeText: (v: unknown) =>
    String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;'),
  request: mocks.request,
  renderRoute: vi.fn(),
  screen: () => document.body,
}));
vi.mock('../ui/modal.js', () => ({
  openModal: (_title: string, html: string) => {
    document.body.innerHTML = html;
  },
  closeModal: vi.fn(),
}));
vi.mock('../core/presentation.js', () => ({
  dateValue: () => '2026-10-05',
  timeValue: () => '10:00',
  errorMessage: String,
}));
vi.mock('../ui/feedback.js', () => ({ toast: vi.fn() }));
vi.mock('../ui/shell.js', () => ({ shell: vi.fn() }));

const charge = (over: Partial<CustomerCharge> = {}): CustomerCharge => ({
  chargeId: 'ch1',
  customerId: 'c1',
  sourceType: 'FIXED_COURT_AGREEMENT',
  sourceId: 'fa1',
  description: 'Monthly 2026-10',
  amount: 200,
  serviceAt: '2026-10-01T10:00:00.000Z',
  status: 'ACTIVE',
  paidAmount: 30,
  outstanding: 170,
  paymentStatus: 'PARTIALLY_PAID',
  ...over,
});
const reservation = {
  reservationId: 'r1',
  customerId: 'c1',
  startAt: '2026-10-05T13:00:00.000Z',
  expectedAmount: 80,
  remainingAmount: 80,
};

let charges: CustomerCharge[];
const flush = () => new Promise((r) => setTimeout(r, 0));
const el = <T extends HTMLElement>(name: string) =>
  document.querySelector<T>(`[name="${name}"]`) as T;
const pick = async (name: string, value: string) => {
  el<HTMLSelectElement>(name).value = value;
  el(name).dispatchEvent(new Event('change'));
  await flush();
};
const posted = () => {
  const call = mocks.request.mock.calls.find((c) => c[0] === '/payments');
  return call ? JSON.parse(call[1].body) : undefined;
};
const submit = async () => {
  document
    .querySelector('form')
    ?.dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
};

beforeEach(() => {
  setLocale('en-US');
  document.body.innerHTML = '';
  charges = [
    charge(),
    charge({ chargeId: 'v', status: 'VOID' }),
    charge({ chargeId: 'p', outstanding: 0, paymentStatus: 'PAID' }),
  ];
  mocks.request.mockReset();
  mocks.request.mockImplementation(async (path: string) => {
    if (path === '/reservations') return [reservation];
    if (path.startsWith('/customers'))
      return [{ customerId: 'c1', name: 'Davi' }];
    if (path.startsWith('/charges')) return charges;
    return {};
  });
});

describe('payment modal', () => {
  it('pays an open charge and sends chargeId only', async () => {
    await openPaymentModal();
    await pick('customerId', 'c1');
    await pick('targetType', 'charge');
    const options = [...el<HTMLSelectElement>('targetId').options];
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain('Fixed court');
    expect(options[0]?.textContent).toContain('170');
    expect(el<HTMLInputElement>('amount').value).toBe('170');
    await submit();
    const body = posted();
    expect(body).toMatchObject({
      chargeId: 'ch1',
      customerId: 'c1',
      amount: 170,
    });
    expect(body.reservationId).toBeUndefined();
  });

  it('hides void and fully paid charges', async () => {
    await openPaymentModal();
    await pick('customerId', 'c1');
    await pick('targetType', 'charge');
    expect(
      [...el<HTMLSelectElement>('targetId').options].map((o) => o.value),
    ).toEqual(['ch1']);
  });

  it('keeps the reservation path sending reservationId', async () => {
    await openPaymentModal();
    await pick('customerId', 'c1');
    expect(el<HTMLInputElement>('amount').value).toBe('80');
    await submit();
    const body = posted();
    expect(body.reservationId).toBe('r1');
    expect(body.chargeId).toBeUndefined();
  });

  it('preselects a prefilled charge', async () => {
    await openPaymentModal(undefined, { charge: charge() });
    expect(el<HTMLSelectElement>('customerId').value).toBe('c1');
    expect(el<HTMLSelectElement>('targetType').value).toBe('charge');
    expect(el<HTMLInputElement>('amount').value).toBe('170');
    await submit();
    expect(posted()).toMatchObject({ chargeId: 'ch1', amount: 170 });
  });

  it('rejects a zero amount without posting', async () => {
    await openPaymentModal();
    await pick('customerId', 'c1');
    el<HTMLInputElement>('amount').value = '0';
    await submit();
    expect(posted()).toBeUndefined();
    expect(document.querySelector('.form-error')?.textContent).toBe(
      'Amount must be greater than zero.',
    );
  });

  it('asks before recording more than the outstanding balance', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await openPaymentModal();
    await pick('customerId', 'c1');
    el<HTMLInputElement>('amount').value = '120';
    await submit();
    expect(confirm).toHaveBeenCalledWith(
      'Amount is greater than the outstanding balance. Record anyway?',
    );
    expect(posted()).toBeUndefined();
    confirm.mockReturnValue(true);
    await submit();
    expect(posted()).toMatchObject({ amount: 120 });
    confirm.mockRestore();
  });

  it('labels charges in pt-BR', () => {
    setLocale('pt-BR');
    expect(chargeOptionLabel(charge())).toContain('Horário fixo');
  });

  it('builds the request body with exactly one target id', () => {
    const base = {
      customerId: 'c1',
      targetId: 'x',
      amount: '10',
      method: 'PIX',
      paidAt: '2026-10-05T10:00',
      notes: '',
    };
    const c = paymentRequestBody({ ...base, targetType: 'charge' });
    expect(c).toMatchObject({ chargeId: 'x', amount: 10, notes: undefined });
    expect('reservationId' in c).toBe(false);
    const r = paymentRequestBody({ ...base, targetType: 'reservation' });
    expect(r).toMatchObject({ reservationId: 'x' });
    expect('chargeId' in r).toBe(false);
  });
});

describe('finance screen names', () => {
  it('shows customer, court and date/time instead of ids', async () => {
    vi.mocked(shell).mockImplementation(async (render) => {
      document.body.innerHTML = await render();
    });
    mocks.request.mockImplementation(async (path: string) => {
      if (path.startsWith('/payments'))
        return [
          {
            paymentId: 'pay-uuid-1',
            reservationId: 'res-uuid-1',
            customerId: 'cust-uuid-1',
            amount: 50,
            method: 'PIX',
            paidAt: '2026-10-05T13:00:00.000Z',
            courtName: 'Quadra Central',
            startAt: '2026-10-05T13:00:00.000Z',
          },
          {
            paymentId: 'pay-uuid-2',
            classId: 'class-uuid-1',
            customerId: 'cust-uuid-1',
            amount: 20,
            method: 'PIX',
            paidAt: '2026-10-05T13:00:00.000Z',
            className: 'Tênis Iniciante',
          },
        ];
      if (path.startsWith('/charges'))
        return [
          {
            chargeId: 'charge-uuid-1',
            customerId: 'cust-uuid-1',
            customerName: 'Davi Souza',
            amount: 80,
            paidAmount: 50,
            outstanding: 30,
          },
        ];
      if (path === '/finance/summary')
        return {
          expectedRevenue: 0,
          recordedPayments: 0,
          outstanding: 0,
          expenses: 0,
        };
      return [];
    });
    await finance();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Davi Souza');
    expect(text).toContain('Quadra Central · 2026-10-05 10:00');
    expect(text).toContain('Tênis Iniciante');
    expect(text).not.toMatch(/uuid/);
  });
});
