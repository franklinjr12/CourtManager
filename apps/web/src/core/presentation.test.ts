import { describe, expect, it, vi } from 'vitest';
import { setLocale } from '../i18n.js';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { dateValue, dateTimeValue, today } from './presentation.js';

vi.mock('../app/context.js', () => ({
  getAppContext: () => ({ timezone: () => 'America/Sao_Paulo' }),
}));

describe('dateTimeValue', () => {
  it('formats in the venue zone regardless of the browser zone', () => {
    setLocale('en-US');
    const text = dateTimeValue('2026-11-03T10:00:00.000Z');
    expect(text).toContain('07:00');
    expect(text).not.toContain('10:00');
  });
});

describe.each(['America/Sao_Paulo', 'UTC'])(
  'venue date with browser TZ %s',
  (tz) => {
    const original = process.env.TZ;
    beforeAll(() => {
      process.env.TZ = tz;
    });
    afterAll(() => {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    });
    afterEach(() => vi.useRealTimers());

    it('uses the venue date for today and shows date-only values exactly', () => {
      setLocale('pt-BR');
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-04T01:30:00Z'));
      expect(today()).toBe('2026-11-03');
      expect(dateValue('2026-11-03')).toBe('03/11/2026');
    });
  },
);
