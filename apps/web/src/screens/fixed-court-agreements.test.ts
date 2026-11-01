import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FixedCourtAgreement } from '@court-manager/contracts';
import type { CustomerCharge } from '../core/types.js';
import { setLocale } from '../i18n.js';
import {
  agreementLatestCharge,
  agreementOpenCharge,
  openRichDetails,
} from './fixed-court-agreements.js';

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
vi.mock('../core/presentation.js', async () => {
  const dates = await import('../core/dates.js');
  return {
    dateValue: () => '2026-10-05',
    timeValue: (iso: string) => dates.timeValue(iso, 'America/Sao_Paulo'),
    errorMessage: String,
  };
});
vi.mock('../ui/feedback.js', () => ({ toast: vi.fn() }));
vi.mock('../ui/shell.js', () => ({ shell: vi.fn() }));

const agreement = {
  agreementId: 'fa1',
  customerId: 'c1',
  courtId: 'ct1',
  weekday: 'WEDNESDAY',
  startTime: '19:00',
  durationMinutes: 120,
  monthlyPrice: 200,
  currency: 'BRL',
  status: 'ACTIVE',
  occurrences: [],
} as unknown as FixedCourtAgreement & { occurrences: [] };

const charge = (over: Partial<CustomerCharge> = {}): CustomerCharge => ({
  chargeId: 'ch1',
  customerId: 'c1',
  sourceType: 'FIXED_COURT_AGREEMENT',
  sourceId: 'fa1',
  fixedCourtAgreementId: 'fa1',
  description: 'Monthly 2026-10',
  amount: 200,
  serviceAt: '2026-10-01T10:00:00.000Z',
  status: 'ACTIVE',
  paidAmount: 30,
  outstanding: 170,
  paymentStatus: 'PARTIALLY_PAID',
  ...over,
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('agreement charge helpers', () => {
  it('ignores other agreements, void and fully paid charges', () => {
    const charges = [
      charge({
        chargeId: 'other',
        fixedCourtAgreementId: 'fa2',
        sourceId: 'x',
      }),
      charge({ chargeId: 'void', status: 'VOID' }),
      charge({ chargeId: 'paid', outstanding: 0, paymentStatus: 'PAID' }),
      charge({ chargeId: 'later', serviceAt: '2026-11-01T10:00:00.000Z' }),
      charge({ chargeId: 'ch1' }),
    ];
    expect(agreementOpenCharge(agreement, charges)?.chargeId).toBe('ch1');
    expect(agreementLatestCharge(agreement, charges)?.chargeId).toBe('later');
    expect(agreementOpenCharge(agreement, [charges[0]!, charges[1]!])).toBe(
      undefined,
    );
  });
});

describe('agreement details payment action', () => {
  beforeEach(() => {
    setLocale('en-US');
    document.body.innerHTML = '';
    mocks.request.mockReset();
    mocks.request.mockImplementation(async (path: string) => {
      if (path.startsWith('/fixed-court-agreements/')) return agreement;
      if (path.includes('sourceType=FIXED_COURT_AGREEMENT'))
        return [
          charge({ chargeId: 'x', fixedCourtAgreementId: 'fa2' }),
          charge(),
        ];
      if (path.startsWith('/charges')) return [charge()];
      if (path.startsWith('/customers'))
        return [{ customerId: 'c1', name: 'Davi' }];
      if (path === '/reservations') return [];
      return {};
    });
  });

  it('opens the payment form with the charge and sends chargeId', async () => {
    await openRichDetails('fa1', [], []);
    expect(document.body.textContent).toContain('Outstanding');
    document
      .querySelector<HTMLButtonElement>('[data-record-charge-payment]')
      ?.click();
    await flush();
    const field = (n: string) =>
      document.querySelector<HTMLSelectElement>(`[name="${n}"]`)!;
    expect(field('targetType').value).toBe('charge');
    expect(field('targetId').value).toBe('ch1');
    expect(field('amount').value).toBe('170');
    document
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    const call = mocks.request.mock.calls.find((c) => c[0] === '/payments');
    const body = JSON.parse(call?.[1].body);
    expect(body).toMatchObject({ chargeId: 'ch1', amount: 170 });
    expect(body.reservationId).toBeUndefined();
  });

  it('shows court name and translated status for linked reservations', async () => {
    setLocale('pt-BR');
    mocks.request.mockImplementation(async (path: string) =>
      path.startsWith('/fixed-court-agreements/')
        ? {
            ...agreement,
            occurrences: [
              {
                occurrenceId: 'o1',
                date: '2026-10-07',
                startAt: '2026-10-07T22:00:00.000Z',
                endAt: '2026-10-08T00:00:00.000Z',
                status: 'MISSED',
                reservationId: 'res-uuid-999',
              },
              {
                occurrenceId: 'o2',
                date: '2026-10-14',
                startAt: '2026-10-14T22:00:00.000Z',
                endAt: '2026-10-15T00:00:00.000Z',
                status: 'SCHEDULED',
              },
            ],
          }
        : [],
    );
    await openRichDetails('fa1', [], [
      { courtId: 'ct1', name: 'Quadra 7' },
    ] as never);
    const rows = [...document.querySelectorAll('.table-wrap tbody tr')];
    expect(rows[0]?.textContent).toContain('Quadra 7');
    expect(rows[0]?.textContent).toContain('Não realizada');
    expect(rows[1]?.textContent).toContain('Programada');
    expect(document.body.textContent).not.toContain('res-uuid-999');
    expect(document.body.textContent).not.toContain('MISSED');
  });

  it('hides the action when nothing is outstanding', async () => {
    mocks.request.mockImplementation(async (path: string) =>
      path.startsWith('/fixed-court-agreements/')
        ? agreement
        : [charge({ outstanding: 0, paymentStatus: 'PAID' })],
    );
    await openRichDetails('fa1', [], []);
    expect(document.querySelector('[data-record-charge-payment]')).toBeNull();
  });
});

describe('agreement details linked reservations', () => {
  it('shows venue-zone times when the browser zone is UTC', async () => {
    process.env.TZ = 'UTC';
    setLocale('en-US');
    document.body.innerHTML = '';
    mocks.request.mockReset();
    mocks.request.mockImplementation(async (path: string) => {
      if (path.startsWith('/fixed-court-agreements/'))
        return {
          ...agreement,
          occurrences: [
            {
              date: '2026-11-03',
              startAt: '2026-11-03T10:00:00.000Z',
              endAt: '2026-11-03T11:00:00.000Z',
              status: 'ACTIVE',
              reservationId: 'r1',
            },
          ],
        };
      if (path.startsWith('/customers'))
        return [{ customerId: 'c1', name: 'Davi' }];
      return [];
    });
    await openRichDetails('fa1', [], []);
    const row = document.querySelector('tbody tr')!.textContent!;
    expect(row).toContain('07:00–08:00');
    expect(row).not.toContain('10:00');
  });
});
