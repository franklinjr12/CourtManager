import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../i18n.js';
import { shell } from '../ui/shell.js';
import { membershipActionBody, memberships } from './memberships.js';

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
    today: () => dates.today(() => 'America/Sao_Paulo'),
    dateValue: (d: string) => d,
    timeValue: () => '10:00',
    errorMessage: String,
  };
});
vi.mock('../ui/feedback.js', () => ({ toast: vi.fn() }));
vi.mock('../ui/shell.js', () => ({ shell: vi.fn() }));

afterEach(() => vi.useRealTimers());

describe('membership actions', () => {
  it('sends an idempotency key for renewal while keeping other actions empty', () => {
    expect(membershipActionBody('renew', 'renewal-1')).toBe(
      JSON.stringify({ idempotencyKey: 'renewal-1' }),
    );
    expect(membershipActionBody('pause', 'unused')).toBe('{}');
  });
});

describe('membership dates at 22:30 venue time', () => {
  it('defaults the start to the venue date and shows period dates exactly', async () => {
    setLocale('pt-BR');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T01:30:00Z'));
    vi.mocked(shell).mockImplementation(async (render, onMount) => {
      document.body.innerHTML = await render();
      onMount?.();
    });
    mocks.request.mockImplementation(async (path: string) => {
      if (path.startsWith('/memberships'))
        return [
          {
            membershipId: 'm1',
            customerId: 'c1',
            planName: 'Mensal',
            status: 'ACTIVE',
            currentPeriodStart: '2026-11-03',
            currentPeriodEnd: '2026-12-02',
            nextRenewalDate: '2026-12-03',
          },
        ];
      return [];
    });
    await memberships();
    expect(document.body.textContent).toContain('03/11/2026');
    expect(document.body.textContent).not.toContain('02/11/2026');
    document.querySelector<HTMLButtonElement>('#add-membership')?.click();
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLInputElement>('[name="startDate"]')?.value,
      ).toBe('2026-11-03'),
    );
  });
});
