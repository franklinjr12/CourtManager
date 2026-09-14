import { beforeEach, expect, it, vi } from 'vitest';
import { customerRequest } from '../customer-auth.js';
import { wireReservationParticipants } from './reservation-participants.js';

vi.mock('../customer-auth.js', () => ({ customerRequest: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  document.body.innerHTML = `<article>
    <button data-reservation-participants="booking">Participants</button>
    <section data-participants-panel hidden></section>
  </article>`;
});

it.each([false, true])(
  'preserves participant draft across pagination (editing=%s)',
  async (editing) => {
    const request = vi.mocked(customerRequest);
    request
      .mockResolvedValueOnce({
        participants: [
          { participantId: 'maria', name: 'Maria', status: 'ACTIVE' },
        ],
        mutable: true,
        nextCursor: 'next',
      })
      .mockResolvedValueOnce({
        participants: [
          { participantId: 'joao', name: 'João', status: 'ACTIVE' },
        ],
        mutable: true,
        nextCursor: null,
      })
      .mockResolvedValue({ participants: [], mutable: true, nextCursor: null });
    wireReservationParticipants(document.body);
    document
      .querySelector<HTMLButtonElement>('[data-reservation-participants]')!
      .click();
    await vi.waitFor(() =>
      expect(document.querySelector('form')).not.toBeNull(),
    );
    if (editing)
      document
        .querySelector<HTMLButtonElement>('[data-edit-participant="maria"]')!
        .click();
    const name = document.querySelector<HTMLInputElement>('[name="name"]')!;
    name.value = 'Maria Silva';
    document.querySelector<HTMLInputElement>('[name="email"]')!.value =
      'guest@example.test';
    document
      .querySelector<HTMLButtonElement>('[data-more-participants]')!
      .click();
    await vi.waitFor(() =>
      expect(document.querySelector('[data-more-participants]')).toBeNull(),
    );
    expect(
      document.querySelector<HTMLInputElement>('[name="name"]')!.value,
    ).toBe('Maria Silva');
    expect(
      document.querySelector<HTMLButtonElement>('[type="submit"]')!.textContent,
    ).toBe(editing ? 'Salvar participante' : 'Adicionar participante');
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(4));
    const [path, init] = request.mock.calls[2]!;
    expect(path).toMatch(editing ? /\/maria$/ : /\/[0-9a-f-]{36}$/);
    expect(JSON.parse(String(init?.body))).toEqual({
      name: 'Maria Silva',
      email: 'guest@example.test',
    });
  },
);
