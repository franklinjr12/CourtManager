import {
  collection,
  CustomerAuthLoginInputSchema,
  CustomerAuthPasswordInputSchema,
  CustomerAuthRegistrationInputSchema,
  CustomerClassWaitlistInputSchema,
  CustomerCourtWaitlistInputSchema,
  CustomerProfileUpdateSchema,
  CustomerReservationInputSchema,
  CustomerSportPreferencesInputSchema,
  DateSchema,
  ok,
  ReservationParticipantInputSchema,
} from '@court-manager/contracts';
import { Hono } from 'hono';
import { z, type ZodType } from 'zod';
import type { Services } from '../services/index.js';
import type { AppContext, AppVariables } from './types.js';

type BodyParser = <T>(c: AppContext, schema: ZodType<T>) => Promise<T>;
type QueryParser = <T>(value: unknown, schema: ZodType<T>) => T;
type CustomerAuthMiddleware = (
  c: AppContext,
  next: () => Promise<void>,
) => Promise<void>;

type Dependencies = {
  services: Services;
  body: BodyParser;
  queryValue: QueryParser;
  customerAuth: (c: AppContext) => Promise<void>;
  customerCtx: (c: AppContext) => AppContext['var']['customerAuth'];
  customerProtectedRoute: CustomerAuthMiddleware;
};

/** Register customer auth and portal HTTP adapters. Domain rules stay in services. */
export const registerCustomerPortalRoutes = (
  app: Hono<{ Variables: AppVariables }>,
  {
    services,
    body,
    queryValue,
    customerAuth,
    customerCtx,
    customerProtectedRoute,
  }: Dependencies,
) => {
  app.post('/customer-auth/login', async (c) => {
    const input = await body(c, CustomerAuthLoginInputSchema);
    return c.json(
      ok(
        await services.customerAuth.login(
          input.slug,
          input.email,
          input.password,
        ),
      ),
    );
  });
  app.post('/customer-auth/logout', async (c) => {
    await customerAuth(c);
    const token = c.req.header('Authorization')?.slice(7);
    if (token) await services.customerAuth.logout(token);
    return c.json(ok({ loggedOut: true }));
  });
  app.post('/customer-auth/register', async (c) => {
    const input = await body(c, CustomerAuthRegistrationInputSchema);
    const { slug, ...registration } = input;
    return c.json(
      ok(await services.customerAccounts.register(slug, registration)),
      201,
    );
  });
  app.post('/customer-auth/activate', async (c) => {
    const input = await body(c, CustomerAuthPasswordInputSchema);
    const { slug, ...password } = input;
    return c.json(
      ok(
        await services.customerAccounts.setPassword(
          slug,
          password,
          'ACTIVATION',
        ),
      ),
    );
  });
  app.post('/customer-auth/reset-password', async (c) => {
    const input = await body(c, CustomerAuthPasswordInputSchema);
    const { slug, ...password } = input;
    return c.json(
      ok(await services.customerAccounts.setPassword(slug, password, 'RESET')),
    );
  });
  app.get('/customer-auth/session', async (c) => {
    await customerAuth(c);
    return c.json(ok(await services.customerAuth.session(customerCtx(c))));
  });

  app.use('/customer/*', customerProtectedRoute);
  app.get('/customer/me', async (c) =>
    c.json(ok(await services.customerAuth.session(customerCtx(c)))),
  );
  app.patch('/customer/me', async (c) =>
    c.json(
      ok(
        await services.customerSelfProfile.update(
          customerCtx(c),
          await body(c, CustomerProfileUpdateSchema),
        ),
      ),
    ),
  );
  app.get('/customer/me/sports', async (c) =>
    c.json(ok(await services.customerSelfProfile.sports(customerCtx(c)))),
  );
  app.put('/customer/me/sports', async (c) =>
    c.json(
      ok(
        await services.customerSelfProfile.updateSports(
          customerCtx(c),
          await body(c, CustomerSportPreferencesInputSchema),
        ),
      ),
    ),
  );
  app.get('/customer/classes', async (c) =>
    c.json(
      ok(
        await services.classes.customerClasses(
          customerCtx(c),
          c.req.query('cursor'),
        ),
      ),
    ),
  );
  app.post('/customer/classes/:id/enroll', async (c) =>
    c.json(
      ok(await services.classes.enrollSelf(customerCtx(c), c.req.param('id'))),
      201,
    ),
  );
  app.post('/customer/classes/:id/leave', async (c) =>
    c.json(
      ok(await services.classes.leaveSelf(customerCtx(c), c.req.param('id'))),
    ),
  );
  app.get('/customer/waitlists', async (c) =>
    c.json(collection(await services.waitlists.list(customerCtx(c)))),
  );
  app.post('/customer/waitlists/court', async (c) =>
    c.json(
      ok(
        await services.waitlists.joinCourt(
          customerCtx(c),
          await body(c, CustomerCourtWaitlistInputSchema),
        ),
      ),
      201,
    ),
  );
  app.post('/customer/waitlists/class', async (c) =>
    c.json(
      ok(
        await services.waitlists.joinClass(
          customerCtx(c),
          await body(c, CustomerClassWaitlistInputSchema),
        ),
      ),
      201,
    ),
  );
  app.post('/customer/classes/:id/waitlist', async (c) =>
    c.json(
      ok(
        await services.waitlists.joinClass(customerCtx(c), {
          classId: c.req.param('id'),
        }),
      ),
      201,
    ),
  );
  app.delete('/customer/waitlists/:id', async (c) =>
    c.json(
      ok(await services.waitlists.leave(customerCtx(c), c.req.param('id'))),
    ),
  );
  app.get('/customer/booking-policy', async (c) =>
    c.json(ok(await services.customerBookings.policy(customerCtx(c)))),
  );
  app.get('/customer/availability', async (c) => {
    const query = c.req.query();
    return c.json(
      ok(
        await services.customerBookings.availability(customerCtx(c), {
          ...(query.courtId ? { courtId: query.courtId } : {}),
          ...(query.sport ? { sport: query.sport } : {}),
          date: queryValue(query.date ?? '', DateSchema),
          durationMinutes: queryValue(
            query.durationMinutes ?? '',
            z.coerce.number().int().positive(),
          ),
        }),
      ),
    );
  });
  app.post('/customer/reservations', async (c) =>
    c.json(
      ok(
        await services.customerBookings.create(
          customerCtx(c),
          await body(c, CustomerReservationInputSchema),
        ),
      ),
      201,
    ),
  );
  app.post('/customer/reservations/:id/cancel', async (c) =>
    c.json(
      ok(
        await services.customerReservations.cancel(
          customerCtx(c),
          c.req.param('id'),
        ),
      ),
    ),
  );
  app.get('/customer/reservations/upcoming', async (c) =>
    c.json(
      ok(
        await services.customerReservations.upcoming(
          customerCtx(c),
          queryValue(
            c.req.query('limit') ?? '20',
            z.coerce.number().int().min(1).max(100),
          ),
        ),
      ),
    ),
  );
  app.get('/customer/reservations/history', async (c) => {
    const history = await services.customerReservations.history(
      customerCtx(c),
      queryValue(
        c.req.query('limit') ?? '20',
        z.coerce.number().int().min(1).max(100),
      ),
      c.req.query('cursor'),
    );
    return c.json(collection(history.data, history.nextCursor));
  });
  app.get('/customer/reservations/:id/rebook', async (c) =>
    c.json(
      ok(
        await services.customerReservations.rebookingDraft(
          customerCtx(c),
          c.req.param('id'),
        ),
      ),
    ),
  );
  app.get('/customer/reservations/:id', async (c) =>
    c.json(
      ok(
        await services.customerReservations.detail(
          customerCtx(c),
          c.req.param('id'),
        ),
      ),
    ),
  );
  app.get('/customer/reservations/:id/participants', async (c) =>
    c.json(
      ok(
        await services.reservationParticipants.list(
          customerCtx(c),
          c.req.param('id'),
          c.req.query('cursor'),
        ),
      ),
    ),
  );
  app.put('/customer/reservations/:id/participants/:participantId', async (c) =>
    c.json(
      ok(
        await services.reservationParticipants.save(
          customerCtx(c),
          c.req.param('id'),
          c.req.param('participantId'),
          await body(c, ReservationParticipantInputSchema),
        ),
      ),
    ),
  );
  app.delete(
    '/customer/reservations/:id/participants/:participantId',
    async (c) =>
      c.json(
        ok(
          await services.reservationParticipants.remove(
            customerCtx(c),
            c.req.param('id'),
            c.req.param('participantId'),
          ),
        ),
      ),
  );
  app.get('/customer/activities', async (c) => {
    const query = c.req.query();
    const from = queryValue(
      query.from ?? new Date().toISOString(),
      z.string().datetime({ offset: true }),
    );
    const to = queryValue(
      query.to ?? new Date(Date.now() + 90 * 86400000).toISOString(),
      z.string().datetime({ offset: true }),
    );
    const activities = await services.customerActivities.list(customerCtx(c), {
      from,
      to,
      limit: queryValue(
        query.limit ?? '20',
        z.coerce.number().int().min(1).max(100),
      ),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    return c.json(collection(activities.data, activities.nextCursor));
  });
};
