import { describe, expect, it } from 'vitest';
import { journey, slot } from '../testing/journey-fixture.js';

describe('Phase 3 regression around non-commercial customers', () => {
  it('keeps ordinary reservation charging for customers without commercial relationships', async () => {
    const { services, venue, customer } = await journey({
      reservationMode: 'AUTO_CONFIRM',
      bookAheadDays: 30,
    });
    const createdCustomer = await customer({ name: 'No commercial customer' });
    const reservation = await services.reservations.create(venue.owner, {
      ...slot(venue.courts.tennis, 3, '18:00', 60),
      customerId: createdCustomer.customerId,
      source: 'STAFF',
    });
    expect(reservation.expectedAmount).toBeGreaterThan(0);
    const charges = await services.charges.list(venue.owner, {
      sourceType: 'RESERVATION',
    });
    expect(charges).toEqual([
      expect.objectContaining({
        reservationId: reservation.reservationId,
        outstanding: reservation.expectedAmount,
      }),
    ]);
  });
});
