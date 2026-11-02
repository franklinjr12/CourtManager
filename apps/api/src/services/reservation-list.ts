import { dayKeyInTimezone, zonedDateTimeToIso } from '../domain.js';
import { AppError } from '../errors.js';

/**
 * Pure helpers for the staff reservation list: venue-local date ranges become
 * SK bounds on the `RESERVATION#<startAt>#<id>` index partitions, and paging
 * uses an opaque base64url cursor holding the last returned SK.
 */
const SK_PREFIX = 'RESERVATION#';
const CURSOR_PATTERN = /^RESERVATION#\d{4}-\d{2}-\d{2}T[^#]+#[^#]+$/;

const nextDate = (date: string) => {
  const [year = NaN, month = NaN, day = NaN] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
};

/** First instant of a venue-local date (midnight may be skipped by DST). */
const localDayStartIso = (date: string, timeZone: string) => {
  try {
    return zonedDateTimeToIso(date, '00:00', timeZone);
  } catch {
    return zonedDateTimeToIso(date, '01:00', timeZone);
  }
};

export type ReservationListRange = { from?: string; to?: string };

/**
 * Legacy `date` means from = to = date. Without `from` the range starts at
 * the venue's today, unless `openStart` (a customer's own bounded partition,
 * or an explicit all-time internal read) leaves it open.
 */
export const reservationListRange = (
  filters: { date?: unknown; from?: unknown; to?: unknown },
  timeZone: string,
  { openStart = false, nowIso = new Date().toISOString() } = {},
): ReservationListRange => {
  const value = (raw: unknown) => {
    if (raw === undefined || raw === '') return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw)))
      throw new AppError('VALIDATION_ERROR', 'Expected YYYY-MM-DD dates.');
    return String(raw);
  };
  const date = value(filters.date);
  const from = date ?? value(filters.from);
  const to = date ?? value(filters.to);
  if (from && to && from > to)
    throw new AppError('VALIDATION_ERROR', '`from` must not be after `to`.');
  const today = dayKeyInTimezone(nowIso, timeZone);
  // Only `to`: start today, or at `to` itself when it is already past.
  const start = from ?? (openStart ? undefined : to && to < today ? to : today);
  return { ...(start ? { from: start } : {}), ...(to ? { to } : {}) };
};

/** Inclusive SK bounds covering every reservation starting inside the range. */
export const reservationListBounds = (
  range: ReservationListRange,
  timeZone: string,
): [string, string] => [
  range.from
    ? `${SK_PREFIX}${localDayStartIso(range.from, timeZone)}`
    : SK_PREFIX,
  range.to
    ? `${SK_PREFIX}${localDayStartIso(nextDate(range.to), timeZone)}`
    : `${SK_PREFIX}~`,
];

export const encodeReservationCursor = (sk: string) =>
  Buffer.from(sk, 'utf8').toString('base64url');

export const decodeReservationCursor = (cursor: unknown) => {
  if (cursor === undefined || cursor === '') return undefined;
  const text = String(cursor);
  const sk = /^[A-Za-z0-9_-]+$/.test(text)
    ? Buffer.from(text, 'base64url').toString('utf8')
    : '';
  if (!CURSOR_PATTERN.test(sk))
    throw new AppError('VALIDATION_ERROR', 'Invalid reservation cursor.');
  return sk;
};
