import { describe, expect, it, vi } from 'vitest';
import { setLocale } from '../i18n.js';
import { dateTimeValue } from './presentation.js';

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
