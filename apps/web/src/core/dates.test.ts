import { describe, expect, it } from 'vitest';
import {
  endIsoFromInputs,
  isoFromInputs,
  localDateKey,
  timeValue,
} from './dates.js';

describe('web date helpers', () => {
  it('converts local wall-clock input into an instant for a timezone', () => {
    expect(isoFromInputs('2024-05-06', '09:30', 'America/Sao_Paulo')).toBe(
      '2024-05-06T12:30:00.000Z',
    );
  });

  it('adds duration before converting the local end time', () => {
    expect(
      endIsoFromInputs('2024-05-06', '23:30', 60, 'America/Sao_Paulo'),
    ).toBe('2024-05-07T03:30:00.000Z');
  });

  it('formats instants using the requested local timezone', () => {
    expect(timeValue('2024-05-06T12:30:00.000Z', 'America/Sao_Paulo')).toBe(
      '09:30',
    );
    expect(localDateKey('2024-05-07T02:30:00.000Z', 'America/Sao_Paulo')).toBe(
      '2024-05-06',
    );
  });
});
