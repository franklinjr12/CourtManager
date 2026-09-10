import { AppError } from './errors.js';
import type { ReservationStatus } from './types.js';
export const allowedTransition = (
  from: ReservationStatus,
  to: ReservationStatus,
) => from === 'CONFIRMED' && ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(to);
export const assertTransition = (
  from: ReservationStatus,
  to: ReservationStatus,
) => {
  if (!allowedTransition(from, to))
    throw new AppError(
      'INVALID_STATE',
      `Cannot change reservation from ${from} to ${to}.`,
    );
};
export const normalizePhone = (phone: string) => phone.replace(/\D/g, '');
export const normalizeEmail = (email?: string) =>
  (email ?? '').trim().toLowerCase();
export const paymentStatus = (expected: number, paid: number) =>
  paid <= 0
    ? 'UNPAID'
    : paid < expected
      ? 'PARTIAL'
      : paid === expected
        ? 'PAID'
        : 'OVERPAID';
export const dayKey = (iso: string) => iso.slice(0, 10);
export const minutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
export const expandSlots = (
  start: string,
  end: string,
  slotMinutes: number,
) => {
  const result: string[] = [];
  for (let t = minutes(start); t < minutes(end); t += slotMinutes)
    result.push(
      `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`,
    );
  return result;
};
export const calculateDuration = (start: Date, end: Date) => {
  const value = (end.getTime() - start.getTime()) / 60000;
  if (value <= 0 || !Number.isInteger(value))
    throw new AppError(
      'VALIDATION_ERROR',
      'End time must be after start time.',
    );
  return value;
};
export const calculatePrice = (hourlyPrice: number, durationMinutes: number) =>
  Math.round(((hourlyPrice * durationMinutes) / 60) * 100) / 100;
const weekdays = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];
const formatterCache = new Map<string, Intl.DateTimeFormat>();
const zonedFormatter = (timeZone: string) => {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      weekday: 'long',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
};
export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
};
export const zonedParts = (date: Date, timeZone: string): ZonedParts => {
  const parts = Object.fromEntries(
    zonedFormatter(timeZone)
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: String(parts.weekday).toUpperCase(),
  };
};
export const assertTimeZone = (timeZone: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Expected a valid IANA timezone.');
  }
  return timeZone;
};
const timezoneOffsetMinutes = (date: Date, timeZone: string) => {
  const local = zonedParts(date, timeZone);
  return (
    (Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
    ) -
      date.getTime()) /
    60000
  );
};
/** Convert a venue-local calendar date/time into an instant. */
export const zonedDateTimeToDate = (
  date: string,
  time: string,
  timeZone: string,
) => {
  const [year = NaN, month = NaN, day = NaN] = date.split('-').map(Number);
  const [hour = NaN, minute = NaN] = time.split(':').map(Number);
  if (
    ![year, month, day, hour, minute].every(Number.isFinite) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  )
    throw new AppError('VALIDATION_ERROR', 'Invalid local date/time.');
  const wallTime = Date.UTC(year, month - 1, day, hour, minute);
  let instant = new Date(wallTime);
  for (let i = 0; i < 4; i += 1) {
    const candidate = new Date(
      wallTime - timezoneOffsetMinutes(instant, timeZone) * 60000,
    );
    if (candidate.getTime() === instant.getTime()) {
      instant = candidate;
      break;
    }
    instant = candidate;
  }
  const actual = zonedParts(instant, timeZone);
  if (
    actual.year !== year ||
    actual.month !== month ||
    actual.day !== day ||
    actual.hour !== hour ||
    actual.minute !== minute
  )
    throw new AppError(
      'VALIDATION_ERROR',
      'The requested local time does not exist in the venue timezone.',
    );
  return instant;
};
export const zonedDateTimeToIso = (
  date: string,
  time: string,
  timeZone: string,
) => zonedDateTimeToDate(date, time, timeZone).toISOString();
export const addLocalMinutes = (
  date: string,
  time: string,
  amount: number,
  timeZone: string,
) => {
  const [year = NaN, month = NaN, day = NaN] = date.split('-').map(Number);
  const [hour = NaN, minute = NaN] = time.split(':').map(Number);
  const local = new Date(
    Date.UTC(year, month - 1, day, hour, minute) + amount * 60000,
  );
  return zonedDateTimeToIso(
    local.toISOString().slice(0, 10),
    local.toISOString().slice(11, 16),
    timeZone,
  );
};
export const localTime = (date: Date, timeZone: string) => {
  const value = zonedParts(date, timeZone);
  return `${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}`;
};
export const dayKeyInTimezone = (iso: string, timeZone: string) => {
  const value = zonedParts(new Date(iso), timeZone);
  return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
};
export const weekdayName = (date: Date, timeZone = 'UTC') =>
  zonedParts(date, timeZone).weekday;
export const weekdayNameForDate = (date: string) => {
  const value = new Date(`${date}T12:00:00Z`).getUTCDay();
  return weekdays[value] ?? 'SUNDAY';
};
export const isWithinOpeningHours = (
  start: Date,
  end: Date,
  openingHours: Record<string, { open: string; close: string } | null>,
  slotMinutes: number,
  timeZone = 'UTC',
) => {
  const startLocal = zonedParts(start, timeZone);
  const endLocal = zonedParts(end, timeZone);
  const day = openingHours[startLocal.weekday];
  if (!day || day.open === day.close) return false;
  const startMinutes = startLocal.hour * 60 + startLocal.minute;
  const endMinutes = endLocal.hour * 60 + endLocal.minute;
  return (
    startLocal.year === endLocal.year &&
    startLocal.month === endLocal.month &&
    startLocal.day === endLocal.day &&
    startMinutes >= minutes(day.open) &&
    endMinutes <= minutes(day.close) &&
    startMinutes % slotMinutes === 0 &&
    endMinutes % slotMinutes === 0
  );
};
export const recurrenceDates = (
  startDate: string,
  untilDate: string,
  weekday: number,
  intervalWeeks = 1,
) => {
  const out: string[] = [];
  const current = new Date(`${startDate}T00:00:00Z`);
  const until = new Date(`${untilDate}T00:00:00Z`);
  while (current <= until) {
    if (current.getUTCDay() === weekday)
      out.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return out.filter((_, i) => i % intervalWeeks === 0);
};
