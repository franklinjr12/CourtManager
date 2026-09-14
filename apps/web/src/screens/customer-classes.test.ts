import type { CustomerClass } from '@court-manager/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { createAppContext } from '../app/context.js';
import * as auth from '../customer-auth.js';
import { mountCustomerClasses } from './customer-classes.js';

const cls: CustomerClass = {
  classId: 'class-one',
  name: 'Tennis <script>',
  sport: 'Tennis',
  coachName: 'Maria',
  courtName: 'Court A',
  scheduleType: 'WEEKLY',
  startDate: '2099-01-01',
  endDate: '2099-02-01',
  startTime: '10:00',
  durationMinutes: 60,
  weekday: 1,
  intervalWeeks: 2,
  timezone: 'America/Sao_Paulo',
  currency: 'BRL',
  capacity: 2,
  enrolledCount: 1,
  full: false,
  pricePerParticipant: 40,
  enrollment: null,
};
afterEach(() => vi.restoreAllMocks());
it('renders safe class details and enrolls/leaves using only the class ID', async () => {
  const root = document.createElement('div');
  createAppContext(root);
  const request = vi
    .spyOn(auth, 'customerRequest')
    .mockResolvedValue({ data: [cls], nextCursor: null });
  await mountCustomerClasses(root);
  expect(root.querySelector('script')).toBeNull();
  expect(root.textContent).toContain('1 / 2 matriculados');
  expect(root.textContent).toContain('America/Sao_Paulo');
  expect(root.textContent).toContain('Maria');
  request.mockResolvedValueOnce({}).mockResolvedValueOnce({
    data: [{ ...cls, enrollment: { enrollmentId: 'one', status: 'ACTIVE' } }],
    nextCursor: null,
  });
  root
    .querySelector<HTMLButtonElement>('[data-class-action="enroll"]')!
    .click();
  await vi.waitFor(() =>
    expect(root.textContent).toContain('Inscrição confirmada.'),
  );
  expect(request).toHaveBeenCalledWith('/customer/classes/class-one/enroll', {
    method: 'POST',
  });
  request.mockResolvedValueOnce({}).mockResolvedValueOnce({
    data: [
      { ...cls, enrollment: { enrollmentId: 'one', status: 'CANCELLED' } },
    ],
    nextCursor: null,
  });
  root.querySelector<HTMLButtonElement>('[data-class-action="leave"]')!.click();
  await vi.waitFor(() =>
    expect(request).toHaveBeenCalledWith('/customer/classes/class-one/leave', {
      method: 'POST',
    }),
  );
  await vi.waitFor(() =>
    expect(root.textContent).toContain('Inscrição cancelada.'),
  );
});
it('joins a full class waitlist and reports capacity races', async () => {
  const root = document.createElement('div');
  createAppContext(root);
  const request = vi
    .spyOn(auth, 'customerRequest')
    .mockResolvedValueOnce({ data: [cls], nextCursor: null });
  await mountCustomerClasses(root);
  request
    .mockRejectedValueOnce(new Error('Class is full. Join the waitlist.'))
    .mockResolvedValueOnce({
      data: [{ ...cls, full: true, enrolledCount: 2, waitlist: null }],
      nextCursor: null,
    });
  root.querySelector<HTMLButtonElement>('button')!.click();
  await vi.waitFor(() =>
    expect(root.textContent).toContain('Class is full. Join the waitlist.'),
  );
  const button = root.querySelector<HTMLButtonElement>(
    '[data-class-action="waitlist"]',
  )!;
  expect(button.textContent).toBe('Entrar na lista de espera');
  request.mockResolvedValueOnce({}).mockResolvedValueOnce({
    data: [
      {
        ...cls,
        full: true,
        enrolledCount: 2,
        waitlist: { waitlistId: 'waitlist-1', status: 'ACTIVE' },
      },
    ],
    nextCursor: null,
  });
  button.click();
  await vi.waitFor(() =>
    expect(root.textContent).toContain('Você entrou na lista de espera.'),
  );
  expect(request).toHaveBeenCalledWith('/customer/classes/class-one/waitlist', {
    method: 'POST',
  });
  expect(root.querySelector('[data-class-action="enroll"]')).toBeNull();
});
