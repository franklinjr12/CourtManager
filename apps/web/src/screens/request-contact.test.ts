import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../i18n.js';
import type { RequestItem } from '../core/types.js';
import {
  normalizeWhatsAppPhone,
  requestConfirmationMessage,
  requestContactActions,
  whatsAppUrl,
  wireRequestContactActions,
} from './request-contact.js';

vi.mock('./runtime.js', () => ({
  escapeText: (v: unknown) =>
    String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;'),
  session: () => ({ organization: { name: 'Arena' } }),
}));
vi.mock('../ui/feedback.js', () => ({ toast: vi.fn() }));
vi.mock('../core/presentation.js', () => ({
  dateValue: () => '2026-09-11',
  timeValue: () => '10:00',
}));

const item: RequestItem = {
  requestId: 'r1',
  courtId: 'c1',
  requestedStartAt: '2026-09-11T13:00:00.000Z',
  requestedEndAt: '2026-09-11T14:30:00.000Z',
  customerName: 'Ana Lima',
  phone: '(11) 91234-5678',
  status: 'REQUESTED',
};
const ctx = { venueName: 'Arena', courtName: 'Court 1' };

function mount(it: RequestItem) {
  document.body.innerHTML = requestContactActions(it, ctx);
  wireRequestContactActions(document.body, it, ctx);
}

describe('request contact actions', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  beforeEach(() => {
    setLocale('en-US');
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  });

  it('normalizes phones', () => {
    expect(normalizeWhatsAppPhone('(11) 91234-5678')).toBe('5511912345678');
    expect(normalizeWhatsAppPhone('+1 415 555 0100')).toBe('14155550100');
    expect(normalizeWhatsAppPhone('5511912345678')).toBe('5511912345678');
    expect(normalizeWhatsAppPhone('0044 20 7946 0958')).toBe('442079460958');
    expect(normalizeWhatsAppPhone('')).toBeNull();
    expect(normalizeWhatsAppPhone('abc')).toBeNull();
  });

  it('copies phone, name and message', async () => {
    mount(item);
    const click = (s: string) =>
      document.querySelector<HTMLElement>(s)?.click();
    click('[data-copy-phone]');
    expect(writeText).toHaveBeenLastCalledWith('(11) 91234-5678');
    click('[data-copy-name]');
    expect(writeText).toHaveBeenLastCalledWith('Ana Lima');
    click('[data-copy-message]');
    const expected = requestConfirmationMessage({
      customerName: 'Ana Lima',
      venueName: 'Arena',
      courtName: 'Court 1',
      date: '2026-09-11',
      startTime: '10:00',
      durationMinutes: 90,
    });
    expect(writeText).toHaveBeenLastCalledWith(expected);
    expect(expected).toContain('Arena');
    expect(expected).toContain('Court 1');
    expect(expected).toContain('90 min');
  });

  it('builds the encoded wa.me link', () => {
    mount(item);
    const href = document
      .querySelector('[data-open-whatsapp]')
      ?.getAttribute('href');
    const msg = requestConfirmationMessage({
      customerName: 'Ana Lima',
      venueName: 'Arena',
      courtName: 'Court 1',
      date: '2026-09-11',
      startTime: '10:00',
      durationMinutes: 90,
    });
    expect(href).toBe(whatsAppUrl('5511912345678', msg));
    expect(href).toMatch(/^https:\/\/wa\.me\/5511912345678\?text=Hello%20Ana/);
    expect(
      document.querySelector('[data-open-whatsapp]')?.getAttribute('target'),
    ).toBe('_blank');
  });

  it('hides WhatsApp and phone copy without a phone', () => {
    mount({ ...item, phone: '' });
    expect(document.querySelector('[data-open-whatsapp]')).toBeNull();
    expect(document.querySelector('[data-copy-phone]')).toBeNull();
    expect(document.querySelector('[data-copy-name]')).not.toBeNull();
  });

  it('uses pt-BR message', () => {
    setLocale('pt-BR');
    expect(
      requestConfirmationMessage({
        customerName: 'Ana',
        venueName: 'Arena',
        courtName: 'Quadra 1',
        date: '11/09/2026',
        startTime: '10:00',
        durationMinutes: 60,
      }),
    ).toContain('Olá Ana');
  });
});
