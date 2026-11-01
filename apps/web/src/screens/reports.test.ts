import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../i18n.js';
import { reports } from './reports.js';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('./runtime.js', () => ({
  escapeText: (v: unknown) => String(v ?? ''),
  request: mocks.request,
  renderRoute: vi.fn(),
}));
vi.mock('../ui/shell.js', () => ({
  shell: async (render: () => Promise<string>) => {
    document.body.innerHTML = await render();
  },
}));

const fixture = {
  from: '2026-10-01',
  to: '2026-10-31',
  timezone: 'America/Sao_Paulo',
  totalReservations: 2,
  noShow: 0,
  expectedRevenue: 160,
  outstanding: 80,
  paymentsRecordedInPeriod: 30,
  recordedPayments: 30,
  utilization: [],
  commercial: {},
};

describe('reports screen', () => {
  beforeEach(() => {
    mocks.request.mockResolvedValue(fixture);
  });

  it('shows outstanding and payments recorded in period in pt-BR', async () => {
    setLocale('pt-BR');
    await reports();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Em aberto');
    expect(text).toContain('Pagamentos registrados no período');
    expect(text).toMatch(/80/);
    expect(text).toMatch(/30/);
  });

  it('shows the metrics in en-US', async () => {
    setLocale('en-US');
    await reports();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Payments recorded in period');
    expect(text).toContain('Outstanding');
  });
});
