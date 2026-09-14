import type { BookingPolicy } from '@court-manager/contracts';

export const developmentBookingModes = [
  'STAFF_ONLY',
  'REQUEST_APPROVAL',
  'AUTO_CONFIRM',
] as const satisfies readonly BookingPolicy['reservationMode'][];

export const resolveDevelopmentBookingMode = (
  value = process.env.DEV_BOOKING_MODE,
): BookingPolicy['reservationMode'] => {
  const mode = (value?.trim() || 'REQUEST_APPROVAL').toUpperCase();
  if (
    !developmentBookingModes.includes(
      mode as (typeof developmentBookingModes)[number],
    )
  )
    throw new Error(
      `DEV_BOOKING_MODE must be one of ${developmentBookingModes.join(', ')}.`,
    );
  return mode as BookingPolicy['reservationMode'];
};
