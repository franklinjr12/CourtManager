import { describe, expect, it } from 'vitest';
import {
  call,
  dateAhead,
  journey,
  slot,
  tokenFromLink,
} from '../testing/journey-fixture.js';

describe('journey: staff and customer share the same records', () => {
  it('shows staff-created bookings in the portal and reflects staff cancellations', async () => {
    const { app, repo, venue, staffLogin, customerLogin } = await journey({
      reservationMode: 'REQUEST_APPROVAL',
    });
    const staff = await staffLogin();
    const created = await call(app, 'POST', '/customers', staff, {
      name: 'Phone Booker',
      phone: '41933334444',
      email: 'phone@journey.test',
    });
    const customerId = created.body.data.customerId as string;
    const reservation = await call(app, 'POST', '/reservations', staff, {
      ...slot(venue.courts.tennis, 4, '11:00'),
      customerId,
    });
    expect(reservation.status).toBe(201);
    const reservationId = reservation.body.data.reservationId as string;

    const access = await call(
      app,
      'POST',
      `/customers/${customerId}/portal-access`,
      staff,
    );
    await call(
      app,
      'POST',
      `/public/venues/${venue.slug}/portal/activate`,
      undefined,
      { token: tokenFromLink(access.body.data.link), password: 'phone-pass' },
    );
    const login = await customerLogin('phone@journey.test', 'phone-pass');
    const token = login.body.data.token;
    expect(login.body.data.customerId).toBe(customerId);

    const upcoming = await call(
      app,
      'GET',
      '/customer/reservations/upcoming',
      token,
    );
    expect(upcoming.body.data.reservations).toEqual([
      expect.objectContaining({ reservationId, status: 'BOOKED', source: 'STAFF' }),
    ]);
    // Exactly one customer and one reservation exist: no parallel records.
    expect(
      await repo.scan(
        (item) =>
          item.entity === 'customer' &&
          item.organizationId === venue.organizationId,
      ),
    ).toHaveLength(1);
    expect(
      await repo.scan((item) => item.entity === 'reservation'),
    ).toHaveLength(1);

    expect(
      (await call(app, 'POST', `/reservations/${reservationId}/cancel`, staff))
        .status,
    ).toBe(200);
    expect(
      (await call(app, 'GET', `/customer/reservations/${reservationId}`, token))
        .body.data.status,
    ).toBe('CANCELLED');
    expect(
      (await call(app, 'GET', '/customer/reservations/upcoming', token)).body
        .data.reservations,
    ).toEqual([]);
    expect(
      (await call(app, 'GET', '/customer/reservations/history', token)).body
        .data,
    ).toEqual([expect.objectContaining({ reservationId, status: 'CANCELLED' })]);
  });

  it('shows customer bookings and enrollments in staff views, and staff enrollments in the portal', async () => {
    const { app, venue, staffLogin, customer } = await journey({
      reservationMode: 'AUTO_CONFIRM',
    });
    const staff = await staffLogin();
    const ana = await customer({ name: 'Portal Ana' });
    const booked = await call(
      app,
      'POST',
      '/customer/reservations',
      ana.token,
      slot(venue.courts.tennis, 2),
    );
    const reservationId = booked.body.data.reservationId as string;
    const staffDetail = await call(
      app,
      'GET',
      `/reservations/${reservationId}`,
      staff,
    );
    expect(staffDetail.status).toBe(200);
    expect(staffDetail.body.data).toMatchObject({
      customerId: ana.customerId,
      source: 'CUSTOMER_PORTAL',
    });
    const customers = await call(app, 'GET', '/customers?search=Portal', staff);
    expect(customers.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ customerId: ana.customerId }),
      ]),
    );

    const cls = await call(app, 'POST', '/classes', staff, {
      name: 'Staff enrolled clinic',
      sport: 'Tennis',
      coachId: 'coach',
      courtId: venue.courts.padel,
      capacity: 2,
      pricePerParticipant: 25,
      scheduleType: 'SINGLE',
      startDate: dateAhead(3),
      startTime: '07:00',
      durationMinutes: 60,
    });
    const enrollment = await call(
      app,
      'POST',
      `/classes/${cls.body.data.classId}/enroll`,
      staff,
      { customerId: ana.customerId },
    );
    expect(enrollment.status).toBe(201);
    const activities = await call(app, 'GET', '/customer/activities', ana.token);
    expect(activities.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activityType: 'CLASS',
          title: 'Staff enrolled clinic',
        }),
        expect.objectContaining({ activityType: 'RESERVATION', sourceId: reservationId }),
      ]),
    );
    const classes = await call(app, 'GET', '/customer/classes', ana.token);
    expect(
      (classes.body.data.data as { classId: string; enrollment: unknown }[]).find(
        (item) => item.classId === cls.body.data.classId,
      )?.enrollment,
    ).toMatchObject({ status: 'ACTIVE' });

    // Staff cancel the enrollment; the customer's activity disappears.
    await call(
      app,
      'POST',
      `/classes/${cls.body.data.classId}/enrollments/${enrollment.body.data.enrollmentId}/cancel`,
      staff,
    );
    expect(
      (
        (await call(app, 'GET', '/customer/activities', ana.token)).body
          .data as { activityType: string }[]
      ).map((item) => item.activityType),
    ).toEqual(['RESERVATION']);
  });
});
