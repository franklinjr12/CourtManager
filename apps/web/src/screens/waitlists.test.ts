import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../i18n.js';
import { waitlists } from './waitlists.js';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('./runtime.js', () => ({
  app: document.body,
  escapeText: (v: unknown) => String(v ?? '').replace(/&/g, '&amp;'),
  request: mocks.request,
  renderRoute: vi.fn(),
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

const entry = (over: Record<string, unknown>) => ({
  waitlistId: 'w1',
  customerId: 'c1',
  customerName: 'Ana',
  type: 'COURT',
  requestedActivity: 'Quadra 1',
  joinedAt: '2026-09-11T13:00:00.000Z',
  status: 'FULFILLED',
  actionable: false,
  currentAvailability: {},
  ...over,
});

describe('staff waitlists', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it.each([
    ['en-US', 'Reservation created', 'Enrolled'],
    ['pt-BR', 'Reserva criada', 'Matrícula criada'],
  ] as const)(
    'labels fulfilled entries without IDs (%s)',
    async (loc, r, e) => {
      setLocale(loc);
      mocks.request.mockResolvedValue([
        entry({ linkedReservationId: 'res-uuid-123' }),
        entry({
          waitlistId: 'w2',
          type: 'CLASS',
          linkedEnrollmentId: 'enr-uuid-456',
        }),
      ]);
      await waitlists();
      const text = document.body.textContent ?? '';
      expect(text).toContain(r);
      expect(text).toContain(e);
      expect(text).not.toContain('res-uuid-123');
      expect(text).not.toContain('enr-uuid-456');
    },
  );
});
