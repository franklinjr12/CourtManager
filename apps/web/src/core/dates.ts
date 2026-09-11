import type { Session } from './types.js';

export const timezoneFor = (session: Session | null) =>
  session?.organization?.timezone ?? 'UTC';

export const today = (timezone: () => string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
};

export const localParts = (date: Date, zone = 'UTC') =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );

export const isoFromInputs = (date: string, time: string, zone = 'UTC') => {
  const [year = NaN, month = NaN, day = NaN] = date.split('-').map(Number);
  const [hour = NaN, minute = NaN] = time.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let instant = new Date(wall);
  for (let i = 0; i < 4; i += 1) {
    const parts = localParts(instant, zone);
    const localAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    const candidate = new Date(wall - (localAsUtc - instant.getTime()));
    if (candidate.getTime() === instant.getTime())
      return candidate.toISOString();
    instant = candidate;
  }
  return instant.toISOString();
};

export const endIsoFromInputs = (
  date: string,
  time: string,
  duration: number,
  zone = 'UTC',
) => {
  const [year = NaN, month = NaN, day = NaN] = date.split('-').map(Number);
  const [hour = NaN, minute = NaN] = time.split(':').map(Number);
  const local = new Date(
    Date.UTC(year, month - 1, day, hour, minute) + duration * 60000,
  );
  const parts = localParts(local, 'UTC');
  return isoFromInputs(
    `${parts.year}-${parts.month}-${parts.day}`,
    `${parts.hour}:${parts.minute}`,
    zone,
  );
};

export const timeValue = (date: string, zone = 'UTC') => {
  const value = localParts(new Date(date), zone);
  return `${value.hour}:${value.minute}`;
};

export const localDateKey = (date: string, zone = 'UTC') => {
  const value = localParts(new Date(date), zone);
  return `${value.year}-${value.month}-${value.day}`;
};
