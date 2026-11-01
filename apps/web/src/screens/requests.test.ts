import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../i18n.js';
import { requests } from './requests.js';

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
  session: () => ({ organization: { name: 'Arena' } }),
}));
vi.mock('../ui/modal.js', () => ({
  openModal: (_title: string, html: string) => {
    const el = document.createElement('div');
    el.id = 'modal';
    el.innerHTML = html;
    document.body.append(el);
  },
  closeModal: vi.fn(),
}));
vi.mock('../ui/feedback.js', () => ({ toast: vi.fn() }));
vi.mock('../ui/shell.js', () => ({
  shell: async (content: () => Promise<string>, onMount?: () => void) => {
    document.body.innerHTML = await content();
    onMount?.();
  },
}));
vi.mock('../core/presentation.js', () => ({
  dateValue: () => '2026-09-11',
  timeValue: () => '10:00',
}));

describe('requests screen', () => {
  beforeEach(() => {
    setLocale('en-US');
    document.body.innerHTML = '';
    mocks.request.mockImplementation(async (path: string) => {
      if (path === '/requests')
        return [
          {
            requestId: 'r1',
            courtId: 'court-uuid-1',
            requestedStartAt: '2026-09-11T13:00:00.000Z',
            requestedEndAt: '2026-09-11T14:00:00.000Z',
            customerName: 'Ana Lima',
            phone: '11999990000',
            status: 'REQUESTED',
          },
        ];
      if (path === '/courts')
        return [{ courtId: 'court-uuid-1', name: 'Quadra Central' }];
      return [];
    });
  });

  it('shows the court name instead of the court id', async () => {
    await requests();
    const row = document.querySelector('tbody tr')!;
    expect(row.textContent).toContain('Quadra Central');
    expect(row.textContent).not.toContain('court-uuid-1');
  });

  it('shows the court name in the review modal', async () => {
    await requests();
    document.querySelector<HTMLElement>('[data-review-request]')!.click();
    const modal = document.querySelector('#modal')!;
    expect(modal.textContent).toContain('Quadra Central');
    expect(modal.textContent).not.toContain('court-uuid-1');
  });
});
