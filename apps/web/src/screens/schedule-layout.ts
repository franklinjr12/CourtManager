import { localParts } from '../core/dates.js';
import type { ScheduleItem } from '../core/types.js';

const SLOT_MINUTES = 15;
const MINUTES_PER_DAY = 24 * 60;

const minutesFromIso = (value: string, zone: string) => {
  const parts = localParts(new Date(value), zone);
  return Number(parts.hour) * 60 + Number(parts.minute);
};

const roundDown = (value: number) =>
  Math.max(0, Math.floor(value / SLOT_MINUTES) * SLOT_MINUTES);

const roundUp = (value: number) =>
  Math.min(MINUTES_PER_DAY, Math.ceil(value / SLOT_MINUTES) * SLOT_MINUTES);

export type ScheduleTimeline = {
  startMinutes: number;
  endMinutes: number;
  slotCount: number;
};

export type ScheduleItemPosition = {
  rowStart: number;
  rowSpan: number;
};

export const scheduleTimeline = (
  items: ScheduleItem[],
  zone = 'UTC',
): ScheduleTimeline | null => {
  if (!items.length) return null;

  const startMinutes = roundDown(
    Math.min(...items.map((item) => minutesFromIso(item.startAt, zone))),
  );
  const endMinutes = Math.max(
    startMinutes + SLOT_MINUTES,
    roundUp(Math.max(...items.map((item) => minutesFromIso(item.endAt, zone)))),
  );

  return {
    startMinutes,
    endMinutes,
    slotCount: (endMinutes - startMinutes) / SLOT_MINUTES,
  };
};

export const scheduleItemPosition = (
  item: ScheduleItem,
  timeline: ScheduleTimeline,
  zone = 'UTC',
): ScheduleItemPosition => {
  const start = Math.max(
    timeline.startMinutes,
    minutesFromIso(item.startAt, zone),
  );
  const end = Math.max(start + SLOT_MINUTES, minutesFromIso(item.endAt, zone));

  return {
    rowStart: Math.floor((start - timeline.startMinutes) / SLOT_MINUTES) + 1,
    rowSpan: Math.max(1, Math.ceil((end - start) / SLOT_MINUTES)),
  };
};
