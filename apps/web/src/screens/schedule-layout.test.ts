import { describe, expect, it } from 'vitest';
import type { ScheduleItem } from '../core/types.js';
import { scheduleItemPosition, scheduleTimeline } from './schedule-layout.js';

const item = (startAt: string, endAt: string): ScheduleItem =>
  ({
    startAt,
    endAt,
    courtId: 'court',
    reservationId: startAt,
  }) as ScheduleItem;

describe('schedule timeline layout', () => {
  it('aligns items from different courts by start and end time', () => {
    const timeline = scheduleTimeline([
      item('2026-09-11T12:00:00Z', '2026-09-11T13:00:00Z'),
      item('2026-09-11T15:00:00Z', '2026-09-11T16:00:00Z'),
      item('2026-09-11T20:00:00Z', '2026-09-11T21:00:00Z'),
    ]);

    expect(timeline).toEqual({
      startMinutes: 720,
      endMinutes: 1260,
      slotCount: 36,
    });
    expect(
      scheduleItemPosition(
        item('2026-09-11T15:00:00Z', '2026-09-11T16:00:00Z'),
        timeline!,
      ),
    ).toEqual({ rowStart: 13, rowSpan: 4 });
    expect(
      scheduleItemPosition(
        item('2026-09-11T20:00:00Z', '2026-09-11T21:00:00Z'),
        timeline!,
      ),
    ).toEqual({ rowStart: 33, rowSpan: 4 });
  });
});
