/** UTC midnight of now's UTC date + daysAhead days + hourUtc hours. */
export function utcSlotStart(
  now: Date,
  daysAhead: number,
  hourUtc: number,
): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + daysAhead,
      hourUtc,
    ),
  );
}
