import { describe, expect, it } from 'vitest';
import {
  calculateDuration,
  calculatePrice,
  expandSlots,
  isWithinOpeningHours,
  normalizeEmail,
  normalizePhone,
  paymentStatus,
  recurrenceDates,
  dayKeyInTimezone,
  zonedDateTimeToIso,
} from './domain.js';

describe('schedule domain', () => {
  it('expands slots and calculates price', () => {
    expect(expandSlots('18:00', '19:30', 30)).toEqual([
      '18:00',
      '18:30',
      '19:00',
    ]);
    expect(calculatePrice(80, 90)).toBe(120);
    expect(
      calculateDuration(
        new Date('2026-01-01T18:00:00Z'),
        new Date('2026-01-01T19:30:00Z'),
      ),
    ).toBe(90);
  });
  it('validates opening hours and boundaries', () => {
    const hours = { FRIDAY: { open: '07:00', close: '23:00' } };
    expect(
      isWithinOpeningHours(
        new Date('2026-01-02T18:00:00Z'),
        new Date('2026-01-02T19:00:00Z'),
        hours,
        30,
      ),
    ).toBe(true);
    expect(
      isWithinOpeningHours(
        new Date('2026-01-02T18:15:00Z'),
        new Date('2026-01-02T19:15:00Z'),
        hours,
        30,
      ),
    ).toBe(false);
  });
  it('normalizes contacts, payment state and recurrence', () => {
    expect(normalizePhone('(41) 99999-1234')).toBe('41999991234');
    expect(normalizeEmail(' Person@Example.COM ')).toBe('person@example.com');
    expect(paymentStatus(100, 0)).toBe('UNPAID');
    expect(paymentStatus(100, 40)).toBe('PARTIAL');
    expect(paymentStatus(100, 100)).toBe('PAID');
    expect(paymentStatus(100, 110)).toBe('OVERPAID');
    expect(recurrenceDates('2026-01-05', '2026-01-26', 1)).toEqual([
      '2026-01-05',
      '2026-01-12',
      '2026-01-19',
      '2026-01-26',
    ]);
  });
  it('uses the venue timezone for weekday, midnight, offset, and DST boundaries', () => {
    const hours = {
      MONDAY: { open: '19:00', close: '20:00' },
      SUNDAY: { open: '23:00', close: '23:30' },
    };
    expect(
      dayKeyInTimezone('2026-01-06T02:30:00.000Z', 'America/Sao_Paulo'),
    ).toBe('2026-01-05');
    expect(
      isWithinOpeningHours(
        new Date('2026-01-05T22:00:00.000Z'),
        new Date('2026-01-05T23:00:00.000Z'),
        hours,
        30,
        'America/Sao_Paulo',
      ),
    ).toBe(true);
    expect(
      isWithinOpeningHours(
        new Date('2026-01-06T02:00:00.000Z'),
        new Date('2026-01-06T02:30:00.000Z'),
        hours,
        30,
        'America/Sao_Paulo',
      ),
    ).toBe(false);
    expect(zonedDateTimeToIso('2026-01-05', '19:00', 'America/Sao_Paulo')).toBe(
      '2026-01-05T22:00:00.000Z',
    );
    expect(zonedDateTimeToIso('2026-07-06', '19:00', 'America/New_York')).toBe(
      '2026-07-06T23:00:00.000Z',
    );
    expect(zonedDateTimeToIso('2026-01-05', '19:00', 'America/New_York')).toBe(
      '2026-01-06T00:00:00.000Z',
    );
    expect(() =>
      zonedDateTimeToIso('2026-03-08', '02:30', 'America/New_York'),
    ).toThrow('does not exist');
  });
});
