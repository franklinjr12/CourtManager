import { randomUUID } from 'node:crypto';
import {
  BlockInputSchema,
  collection,
  CourtInputSchema,
  CustomerInputSchema,
  DateSchema,
  ExpenseInputSchema,
  LoginInputSchema,
  ok,
  PaginationSchema,
  PaymentInputSchema,
  ReservationInputSchema,
  RequestInputSchema,
  RecurringReservationInputSchema,
  SportInputSchema,
  ClassInputSchema,
  StaffCreateInputSchema,
  StaffUpdateInputSchema,
  StaffPasswordResetInputSchema,
} from '@court-manager/contracts';
import type { AuthContext } from '@court-manager/contracts';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { z, type ZodType } from 'zod';
import type { Repository } from './db.js';
import { dayKeyInTimezone } from './domain.js';
import { AppError } from './errors.js';
import { buildServices } from './services/index.js';

type Variables = { auth: AuthContext; requestId: string };
type AppContext = Context<{ Variables: Variables }>;
const csv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0] ?? {});
  const quote = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => quote(row[h])).join(',')),
  ].join('\n');
};
const body = async <T>(
  c: { req: { json: () => Promise<unknown> } },
  schema: ZodType<T>,
) => {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    throw new AppError(
      'VALIDATION_ERROR',
      'Request validation failed.',
      parsed.error.flatten().fieldErrors,
    );
  return parsed.data;
};
const queryValue = <T>(value: unknown, schema: ZodType<T>) => {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new AppError(
      'VALIDATION_ERROR',
      'Request validation failed.',
      parsed.error.flatten().fieldErrors,
    );
  return parsed.data;
};

export const createApp = (repo: Repository) => {
  const services = buildServices(repo);
  const app = new Hono<{ Variables: Variables }>();
  const publicRequests = new Map<string, { started: number; count: number }>();
  app.onError((error, c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    if (error instanceof AppError)
      return c.json(
        {
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
            requestId,
          },
        },
        error.status as 400,
      );
    console.error(
      JSON.stringify({ requestId, error: error.message, route: c.req.path }),
    );
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred.',
          details: {},
          requestId,
        },
      },
      500,
    );
  });
  app.use('*', async (c, next) => {
    const requestId = randomUUID();
    c.set('requestId', requestId);
    const started = Date.now();
    await next();
    console.info(
      JSON.stringify({
        requestId,
        route: c.req.path,
        method: c.req.method,
        status: c.res.status,
        duration: Date.now() - started,
        organizationId: c.get('auth')?.organizationId,
        userId: c.get('auth')?.userId,
      }),
    );
  });
  app.use(
    '*',
    cors({
      origin: '*',
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );
  app.use('/public/*', async (c, next) => {
    if (Number(c.req.header('Content-Length') ?? 0) > 65536)
      throw new AppError('VALIDATION_ERROR', 'Request body is too large.');
    if (c.req.method === 'POST') {
      const address = c.req.header('x-forwarded-for') ?? 'local';
      const current = publicRequests.get(address);
      const timestamp = Date.now();
      if (!current || timestamp - current.started > 60000)
        publicRequests.set(address, { started: timestamp, count: 1 });
      else {
        current.count += 1;
        if (current.count > 30)
          throw new AppError('RATE_LIMITED', 'Too many public requests.');
      }
    }
    await next();
  });
  const auth = async (c: AppContext) => {
    const header = c.req.header('Authorization');
    if (!header?.startsWith('Bearer '))
      throw new AppError('UNAUTHORIZED', 'Authentication required.');
    const context = await services.auth.authenticate(header.slice(7));
    c.set('auth', context);
  };
  const ctx = (c: AppContext) => c.get('auth');
  const protectedRoute = async (c: AppContext, next: () => Promise<void>) => {
    await auth(c);
    await next();
  };
  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.post('/auth/login', async (c) => {
    const input = await body(c, LoginInputSchema);
    return c.json(ok(await services.auth.login(input.email, input.password)));
  });
  app.post('/auth/logout', async (c) => {
    await auth(c);
    const token = c.req.header('Authorization')?.slice(7);
    if (token) await services.auth.logout(token);
    return c.json(ok({ loggedOut: true }));
  });
  app.get('/public/venues/:slug', async (c) =>
    c.json(ok(await services.requests.publicVenue(c.req.param('slug')))),
  );
  app.get('/public/venues/:slug/availability', async (c) => {
    const query = c.req.query();
    const date = queryValue(query.date ?? '', DateSchema);
    const durationMinutes = queryValue(
      query.durationMinutes ?? '30',
      z.coerce.number().int().positive(),
    );
    const result = await services.requests.publicAvailability(
      c.req.param('slug'),
      query.courtId ?? '',
      date,
      durationMinutes,
    );
    return c.json(ok(result));
  });
  app.post('/public/venues/:slug/requests', async (c) => {
    const input = await body(c, RequestInputSchema);
    return c.json(
      ok(await services.requests.createPublic(c.req.param('slug'), input)),
      201,
    );
  });
  app.use('/organization/*', protectedRoute);
  app.use('/courts/*', protectedRoute);
  app.use('/sports/*', protectedRoute);
  app.use('/customers/*', protectedRoute);
  app.use('/reservations/*', protectedRoute);
  app.use('/schedule', protectedRoute);
  app.use('/availability', protectedRoute);
  app.use('/requests/*', protectedRoute);
  app.use('/payments/*', protectedRoute);
  app.use('/expenses/*', protectedRoute);
  app.use('/blocks/*', protectedRoute);
  app.use('/classes/*', protectedRoute);
  app.use('/class-sessions/*', protectedRoute);
  app.use('/staff/*', protectedRoute);
  app.use('/coaches', protectedRoute);
  app.use('/today', protectedRoute);
  app.use('/charges/*', protectedRoute);
  app.use('/finance/*', protectedRoute);
  app.use('/dashboard', protectedRoute);
  app.use('/reports/*', protectedRoute);
  app.use('/exports/*', protectedRoute);
  app.get('/organization', async (c) =>
    c.json(ok(await services.organizations.get(ctx(c)))),
  );
  app.patch('/organization', async (c) =>
    c.json(
      ok(
        await services.organizations.update(
          ctx(c),
          await body(c, z.record(z.unknown())),
        ),
      ),
    ),
  );
  app.get('/courts', async (c) =>
    c.json(
      collection(
        await services.courts.list(
          ctx(c),
          c.req.query('includeArchived') === 'true',
        ),
      ),
    ),
  );
  app.post('/courts', async (c) =>
    c.json(
      ok(await services.courts.create(ctx(c), await body(c, CourtInputSchema))),
      201,
    ),
  );
  app.get('/courts/:id', async (c) =>
    c.json(ok(await services.courts.get(ctx(c), c.req.param('id')))),
  );
  app.patch('/courts/:id', async (c) =>
    c.json(
      ok(
        await services.courts.update(
          ctx(c),
          c.req.param('id'),
          await body(c, CourtInputSchema.partial()),
        ),
      ),
    ),
  );
  app.post('/courts/:id/archive', async (c) =>
    c.json(ok(await services.courts.archive(ctx(c), c.req.param('id')))),
  );
  app.post('/courts/:id/restore', async (c) =>
    c.json(ok(await services.courts.restore(ctx(c), c.req.param('id')))),
  );
  app.get('/sports', async (c) =>
    c.json(
      collection(
        await services.sports.list(
          ctx(c),
          c.req.query('includeInactive') === 'true',
        ),
      ),
    ),
  );
  app.post('/sports', async (c) =>
    c.json(
      ok(await services.sports.create(ctx(c), await body(c, SportInputSchema))),
      201,
    ),
  );
  app.get('/sports/:id', async (c) =>
    c.json(ok(await services.sports.get(ctx(c), c.req.param('id')))),
  );
  app.patch('/sports/:id', async (c) =>
    c.json(
      ok(
        await services.sports.update(
          ctx(c),
          c.req.param('id'),
          await body(c, SportInputSchema.partial()),
        ),
      ),
    ),
  );
  app.delete('/sports/:id', async (c) => {
    await services.sports.remove(ctx(c), c.req.param('id'));
    return c.json(ok({ deleted: true }));
  });
  app.get('/customers', async (c) => {
    const q = c.req.query(),
      p = PaginationSchema.parse(q);
    const data = await services.customers.list(
      ctx(c),
      q.search,
      q.archived === 'true',
    );
    return c.json(collection(data.slice(0, p.limit), null));
  });
  app.post('/customers', async (c) =>
    c.json(
      ok(
        await services.customers.create(
          ctx(c),
          await body(c, CustomerInputSchema),
        ),
      ),
      201,
    ),
  );
  app.get('/customers/:id', async (c) =>
    c.json(ok(await services.customers.get(ctx(c), c.req.param('id')))),
  );
  app.get('/customers/:id/profile', async (c) =>
    c.json(ok(await services.customerProfiles.get(ctx(c), c.req.param('id')))),
  );
  app.patch('/customers/:id', async (c) =>
    c.json(
      ok(
        await services.customers.update(
          ctx(c),
          c.req.param('id'),
          await body(c, CustomerInputSchema.partial()),
        ),
      ),
    ),
  );
  app.post('/customers/:id/archive', async (c) =>
    c.json(ok(await services.customers.archive(ctx(c), c.req.param('id')))),
  );
  app.get('/customers/duplicates', async (c) =>
    c.json(ok(await services.customers.duplicates(ctx(c), c.req.query()))),
  );
  app.get('/reservations', async (c) => {
    const q = c.req.query(),
      p = PaginationSchema.parse(q);
    return c.json(
      collection(
        (await services.reservations.list(ctx(c), q)).slice(0, p.limit),
        null,
      ),
    );
  });
  app.post('/reservations', async (c) =>
    c.json(
      ok(
        await services.reservations.create(
          ctx(c),
          await body(c, ReservationInputSchema),
        ),
      ),
      201,
    ),
  );
  app.post('/reservations/recurring', async (c) =>
    c.json(
      ok(
        await services.reservations.recurring(
          ctx(c),
          await body(c, RecurringReservationInputSchema),
        ),
      ),
      201,
    ),
  );
  app.get('/reservations/:id', async (c) =>
    c.json(ok(await services.reservations.detail(ctx(c), c.req.param('id')))),
  );
  app.patch('/reservations/:id', async (c) =>
    c.json(
      ok(
        await services.reservations.update(
          ctx(c),
          c.req.param('id'),
          await body(c, ReservationInputSchema.partial()),
        ),
      ),
    ),
  );
  app.post('/reservations/:id/complete', async (c) =>
    c.json(
      ok(
        await services.reservations.transition(
          ctx(c),
          c.req.param('id'),
          'COMPLETED',
        ),
      ),
    ),
  );
  app.post('/reservations/:id/check-in', async (c) =>
    c.json(
      ok(
        await services.reservations.transition(
          ctx(c),
          c.req.param('id'),
          'CHECKED_IN',
        ),
      ),
    ),
  );
  app.post('/reservations/:id/cancel', async (c) =>
    c.json(
      ok(
        await services.reservations.transition(
          ctx(c),
          c.req.param('id'),
          'CANCELLED',
        ),
      ),
    ),
  );
  app.post('/reservations/:id/no-show', async (c) =>
    c.json(
      ok(
        await services.reservations.transition(
          ctx(c),
          c.req.param('id'),
          'NO_SHOW',
        ),
      ),
    ),
  );
  app.get('/schedule', async (c) => {
    const q = c.req.query();
    if (
      q.from &&
      q.to &&
      new Date(q.to).getTime() - new Date(q.from).getTime() > 7 * 86400000
    )
      throw new AppError(
        'VALIDATION_ERROR',
        'Schedule range cannot exceed seven days.',
      );
    const organization = await services.organizations.get(ctx(c));
    const date =
      q.date ??
      q.from ??
      dayKeyInTimezone(new Date().toISOString(), String(organization.timezone));
    const reservations =
      ctx(c).role === 'COACH'
        ? []
        : await services.reservations.list(ctx(c), { date });
    const scheduledReservations = reservations.filter(
      (reservation) => reservation.status !== 'CANCELLED',
    );
    const blocks = await services.blocks.list(ctx(c), date);
    const classes = await services.classes.occurrences(ctx(c), date);
    const items = [...scheduledReservations, ...blocks, ...classes] as {
      courtId?: string;
    }[];
    const allCourts = await services.courts.list(ctx(c), true);
    const courts = allCourts.filter(
      (court) =>
        (court.active === true && !court.archivedAt) ||
        items.some((item) => item.courtId === court.courtId),
    );
    return c.json(ok({ date, courts, items }));
  });
  app.get('/availability', async (c) => {
    const q = c.req.query();
    const date = queryValue(q.date ?? '', DateSchema);
    const durationMinutes = queryValue(
      q.durationMinutes ?? '30',
      z.coerce.number().int().positive(),
    );
    const court = await services.courts.get(ctx(c), q.courtId ?? '');
    return c.json(
      ok({
        available: await services.schedule.availability(
          ctx(c),
          court as Parameters<typeof services.schedule.availability>[1],
          date,
          durationMinutes,
        ),
      }),
    );
  });
  app.get('/blocks', async (c) =>
    c.json(collection(await services.blocks.list(ctx(c)))),
  );
  app.post('/blocks', async (c) =>
    c.json(
      ok(await services.blocks.create(ctx(c), await body(c, BlockInputSchema))),
      201,
    ),
  );
  app.post('/blocks/:id/cancel', async (c) =>
    c.json(ok(await services.blocks.cancel(ctx(c), c.req.param('id')))),
  );
  app.get('/requests', async (c) =>
    c.json(collection(await services.requests.list(ctx(c)))),
  );
  app.get('/requests/:id', async (c) => {
    const request = (
      (await services.requests.list(ctx(c))) as Record<string, unknown>[]
    ).find((item) => String(item['requestId']) === c.req.param('id'));
    if (!request) throw new AppError('NOT_FOUND', 'Request was not found.');
    return c.json(ok(request));
  });
  app.post('/requests/:id/confirm', async (c) => {
    const input = await body(
      c,
      z.object({ customerId: z.string().optional() }),
    );
    return c.json(
      ok(
        await services.requests.confirm(
          ctx(c),
          c.req.param('id'),
          input.customerId,
        ),
      ),
    );
  });
  app.post('/requests/:id/reject', async (c) => {
    const input = await body(c, z.object({ reason: z.string().optional() }));
    return c.json(
      ok(
        await services.requests.reject(ctx(c), c.req.param('id'), input.reason),
      ),
    );
  });
  app.get('/payments', async (c) =>
    c.json(collection(await services.payments.list(ctx(c)))),
  );
  app.post('/payments', async (c) =>
    c.json(
      ok(
        await services.payments.create(
          ctx(c),
          await body(c, PaymentInputSchema),
        ),
      ),
      201,
    ),
  );
  app.delete('/payments/:id', async (c) => {
    await services.payments.remove(ctx(c), c.req.param('id'));
    return c.json(ok({ deleted: true }));
  });
  app.get('/charges', async (c) =>
    c.json(collection(await services.charges.list(ctx(c), c.req.query()))),
  );
  app.get('/charges/:id', async (c) =>
    c.json(ok(await services.charges.get(ctx(c), c.req.param('id')))),
  );
  app.get('/finance/summary', async (c) =>
    c.json(ok(await services.finance.summary(ctx(c), c.req.query()))),
  );
  app.get('/finance/balances', async (c) =>
    c.json(collection(await services.finance.balances(ctx(c)))),
  );
  app.get('/expenses', async (c) =>
    c.json(collection(await services.expenses.list(ctx(c)))),
  );
  app.post('/expenses', async (c) =>
    c.json(
      ok(
        await services.expenses.create(
          ctx(c),
          await body(c, ExpenseInputSchema),
        ),
      ),
      201,
    ),
  );
  app.delete('/expenses/:id', async (c) => {
    await services.expenses.remove(ctx(c), c.req.param('id'));
    return c.json(ok({ deleted: true }));
  });
  app.get('/staff', async (c) =>
    c.json(collection(await services.staff.list(ctx(c)))),
  );
  app.get('/coaches', async (c) =>
    c.json(collection(await services.staff.coaches(ctx(c)))),
  );
  app.post('/staff', async (c) =>
    c.json(
      ok(
        await services.staff.create(
          ctx(c),
          await body(c, StaffCreateInputSchema),
        ),
      ),
      201,
    ),
  );
  app.patch('/staff/:id', async (c) =>
    c.json(
      ok(
        await services.staff.update(
          ctx(c),
          c.req.param('id'),
          await body(c, StaffUpdateInputSchema),
        ),
      ),
    ),
  );
  app.post('/staff/:id/reset-password', async (c) =>
    c.json(
      ok(
        await services.staff.resetPassword(
          ctx(c),
          c.req.param('id'),
          (await body(c, StaffPasswordResetInputSchema)).password,
        ),
      ),
    ),
  );
  app.get('/classes', async (c) =>
    c.json(collection(await services.classes.list(ctx(c)))),
  );
  app.post('/classes', async (c) =>
    c.json(
      ok(
        await services.classes.create(ctx(c), await body(c, ClassInputSchema)),
      ),
      201,
    ),
  );
  app.get('/classes/:id', async (c) =>
    c.json(ok(await services.classes.getDetail(ctx(c), c.req.param('id')))),
  );
  app.get('/classes/:id/enrollments', async (c) =>
    c.json(
      collection(await services.classes.enrollments(ctx(c), c.req.param('id'))),
    ),
  );
  app.post('/classes/:id/deactivate', async (c) =>
    c.json(ok(await services.classes.deactivate(ctx(c), c.req.param('id')))),
  );
  app.post('/classes/:id/enrollments/:enrollmentId/cancel', async (c) =>
    c.json(
      ok(
        await services.classes.cancelEnrollment(
          ctx(c),
          c.req.param('id'),
          c.req.param('enrollmentId'),
        ),
      ),
    ),
  );
  app.post('/classes/:id/enroll', async (c) => {
    const input = await body(c, z.object({ customerId: z.string() }));
    return c.json(
      ok(
        await services.classes.enroll(
          ctx(c),
          c.req.param('id'),
          input.customerId,
        ),
      ),
      201,
    );
  });
  app.post('/classes/attendance', async (c) =>
    c.json(
      ok(
        await services.classes.attendance(
          ctx(c),
          await body(c, z.record(z.unknown())),
        ),
      ),
      201,
    ),
  );
  app.get('/class-sessions/:id/roster', async (c) =>
    c.json(ok(await services.classes.roster(ctx(c), c.req.param('id')))),
  );
  app.post(
    '/class-sessions/:sessionId/participants/:customerId/check-in',
    async (c) =>
      c.json(
        ok(
          await services.classes.participantTransition(
            ctx(c),
            c.req.param('sessionId'),
            c.req.param('customerId'),
            'CHECKED_IN',
          ),
        ),
      ),
  );
  app.post(
    '/class-sessions/:sessionId/participants/:customerId/complete',
    async (c) =>
      c.json(
        ok(
          await services.classes.participantTransition(
            ctx(c),
            c.req.param('sessionId'),
            c.req.param('customerId'),
            'COMPLETED',
          ),
        ),
      ),
  );
  app.post(
    '/class-sessions/:sessionId/participants/:customerId/no-show',
    async (c) =>
      c.json(
        ok(
          await services.classes.participantTransition(
            ctx(c),
            c.req.param('sessionId'),
            c.req.param('customerId'),
            'NO_SHOW',
          ),
        ),
      ),
  );
  app.post('/class-sessions/:id/complete', async (c) =>
    c.json(
      ok(await services.classes.completeSession(ctx(c), c.req.param('id'))),
    ),
  );
  app.post('/class-sessions/:id/cancel', async (c) =>
    c.json(
      ok(
        await services.classes.cancelSession(
          ctx(c),
          c.req.param('id'),
          (await body(c, z.object({ reason: z.string().optional() }))).reason,
        ),
      ),
    ),
  );
  app.get('/today', async (c) =>
    c.json(
      ok(
        await services.today.get(
          ctx(c),
          c.req.query('at') ? new Date(c.req.query('at')!) : new Date(),
        ),
      ),
    ),
  );
  app.get('/dashboard', async (c) => {
    const q = c.req.query(),
      organization = await services.organizations.get(ctx(c)),
      date =
        q.date ??
        dayKeyInTimezone(
          new Date().toISOString(),
          String(organization.timezone),
        ),
      reservations = await services.reservations.list(ctx(c), { date }),
      requests = await services.requests.list(ctx(c)),
      payments = await services.payments.list(ctx(c));
    const expected = reservations.reduce(
        (n, r) => n + Number(r.expectedAmount),
        0,
      ),
      paid = payments
        .filter((p) =>
          reservations.some((r) => r.reservationId === p.reservationId),
        )
        .reduce((n, p) => n + Number(p.amount), 0);
    return c.json(
      ok({
        date,
        reservationsToday: reservations.length,
        pendingRequests: requests.filter((r) => r.status === 'REQUESTED')
          .length,
        expectedRevenue: expected,
        recordedPayments: paid,
        outstanding: Math.max(0, expected - paid),
        upcoming: reservations,
      }),
    );
  });
  app.get('/reports/summary', async (c) => {
    const reservations = await services.reservations.list(
        ctx(c),
        c.req.query(),
      ),
      payments = await services.payments.list(ctx(c));
    return c.json(
      ok({
        reservationCount: reservations.length,
        expectedRevenue: reservations.reduce(
          (n, r) => n + Number(r.expectedAmount),
          0,
        ),
        recordedPayments: payments.reduce((n, p) => n + Number(p.amount), 0),
        sources: Object.fromEntries(
          [
            'PUBLIC_REQUEST',
            'WHATSAPP',
            'PHONE',
            'WALK_IN',
            'STAFF',
            'OTHER',
          ].map((s) => [s, reservations.filter((r) => r.source === s).length]),
        ),
      }),
    );
  });
  app.get('/reports/operations', async (c) =>
    c.json(ok(await services.reports.operations(ctx(c), c.req.query()))),
  );
  for (const entity of [
    'customers',
    'reservations',
    'payments',
    'expenses',
  ] as const)
    app.get(`/exports/${entity}`, async (c) => {
      const data =
        entity === 'customers'
          ? await services.customers.list(ctx(c))
          : entity === 'reservations'
            ? await services.reservations.list(ctx(c), c.req.query())
            : entity === 'payments'
              ? await services.payments.list(ctx(c))
              : await services.expenses.list(ctx(c));
      return new Response(csv(data as Record<string, unknown>[]), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename=${entity}.csv`,
        },
      });
    });
  return app;
};
