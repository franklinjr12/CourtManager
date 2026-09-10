import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  blockReasonLabel,
  formatDate,
  formatMoney,
  getLocale,
  paymentMethodLabel,
  reservationStatusLabel,
  setLocale,
  t,
  translateError,
  translations,
  weekdayLabel,
} from './i18n.js';

describe('localization', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = DEFAULT_LOCALE;
  });

  it('uses Brazilian Portuguese unless a valid preference is saved', () => {
    expect(getLocale()).toBe('pt-BR');
    localStorage.setItem(LOCALE_STORAGE_KEY, 'fr-FR');
    expect(getLocale()).toBe('pt-BR');
  });

  it('restores and persists supported locales', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en-US');
    expect(getLocale()).toBe('en-US');
    setLocale('pt-BR');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('pt-BR');
    setLocale('en-US');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en-US');
    expect(document.documentElement.lang).toBe('en-US');
    expect(SUPPORTED_LOCALES).toEqual(['pt-BR', 'en-US']);
  });

  it('looks up translations and interpolates parameters', () => {
    expect(t('login.subtitle')).toBe('Entre para gerenciar suas quadras.');
    expect(t('settings.activeSummary', { active: 3, inactive: 1 })).toBe(
      '3 ativos · 1 inativo',
    );
    setLocale('en-US');
    expect(t('login.submit')).toBe('Sign in');
    expect(t('settings.activeSummary', { active: 3, inactive: 1 })).toBe(
      '3 active · 1 inactive',
    );
  });

  it('keeps dictionary keys in parity', () => {
    expect(Object.keys(translations['pt-BR']).sort()).toEqual(
      Object.keys(translations['en-US']).sort(),
    );
  });

  it('translates enum values without changing their API values', () => {
    expect(reservationStatusLabel('CONFIRMED')).toBe('Confirmada');
    expect(paymentMethodLabel('CREDIT_CARD')).toBe('Cartão de crédito');
    expect(blockReasonLabel('MAINTENANCE')).toBe('Manutenção');
    expect(weekdayLabel('MONDAY')).toBe('Segunda-feira');
    setLocale('en-US');
    expect(reservationStatusLabel('CONFIRMED')).toBe('Confirmed');
    expect(paymentMethodLabel('CREDIT_CARD')).toBe('Credit card');
  });

  it('translates known API errors', () => {
    expect(
      translateError(
        Object.assign(new Error('conflict'), { code: 'SCHEDULE_CONFLICT' }),
      ),
    ).toBe('Este horário não está mais disponível. Escolha outro horário.');
    setLocale('en-US');
    expect(
      translateError(
        Object.assign(new Error('conflict'), { code: 'SCHEDULE_CONFLICT' }),
      ),
    ).toBe('This time is no longer available. Choose another time.');
  });

  it('formats money and dates using the selected locale', () => {
    expect(formatMoney(1234.56)).toContain('1.234,56');
    expect(formatDate('2024-05-06T12:00:00Z')).toBe('06/05/2024');
    setLocale('en-US');
    expect(formatMoney(1234.56)).toContain('1,234.56');
    expect(formatDate('2024-05-06T12:00:00Z')).toBe('05/06/2024');
  });
});
