import { afterEach, expect, it, vi } from 'vitest';
import { createAppContext } from '../app/context.js';
import { publicBooking } from './public-booking.js';

afterEach(() => vi.unstubAllGlobals());

it('shows a choose-date prompt and skips availability fetch while date is empty', async () => {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  createAppContext(root);
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        data: {
          name: 'Arena',
          timezone: 'America/Sao_Paulo',
          courts: [
            {
              courtId: 'c1',
              name: 'Quadra 1',
              sport: 'Tênis',
              slotMinutes: 60,
            },
          ],
          bookingPolicy: { reservationMode: 'REQUEST_APPROVAL' },
        },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetcher);
  await publicBooking('arena');
  const duration = root.querySelector<HTMLSelectElement>(
    '[name="durationMinutes"]',
  )!;
  duration.dispatchEvent(new Event('change', { bubbles: true }));
  await Promise.resolve();
  expect(root.querySelector('[name="time"]')?.textContent).toContain(
    'Escolha uma data primeiro',
  );
  expect(
    fetcher.mock.calls.some(([url]) => String(url).includes('/availability')),
  ).toBe(false);
});
