import { randomUUID } from 'node:crypto';
import {
  BlockInputSchema,
  collection,
  CourtInputSchema,
  CustomerInputSchema,
  CustomerPortalPasswordInputSchema,
  CustomerPortalRegistrationInputSchema,
  DateSchema,
  ExpenseInputSchema,
  FixedCourtAgreementActionInputSchema,
  FixedCourtAgreementBillingInputSchema,
  FixedCourtAgreementInputSchema,
  FixedCourtAgreementSlotChangeInputSchema,
  FixedCourtAgreementStatusSchema,
  LoginInputSchema,
  MembershipCancelInputSchema,
  MembershipInputSchema,
  MembershipRenewInputSchema,
  MembershipStatusSchema,
  MembershipUpdateInputSchema,
  ok,
  PaginationSchema,
  PaymentInputSchema,
  ReservationInputSchema,
  RequestInputSchema,
  RecurringReservationInputSchema,
  SportInputSchema,
  ClassInputSchema,
  OrganizationUpdateInputSchema,
  CustomerPackageInputSchema,
  CustomerPackageStatusSchema,
  CreditAdjustmentInputSchema,
  MakeupCreditInputSchema,
  PackageDefinitionInputSchema,
  PackageDefinitionStatusSchema,
  PlanInputSchema,
  PlanStatusSchema,
  PlanUpdateInputSchema,
  StaffCreateInputSchema,
  StaffUpdateInputSchema,
  StaffPasswordResetInputSchema,
} from '@court-manager/contracts';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z, type ZodType } from 'zod';
import type { Repository } from './db.js';
import { dayKeyInTimezone } from './domain.js';
import { AppError } from './errors.js';
import { registerCustomerPortalRoutes } from './routes/customer-portal.js';
import type { AppContext, AppVariables } from './routes/types.js';
import { buildServices } from './services/index.js';

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
  const app = new Hono<{ Variables: AppVariables }>();
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
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
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
  const customerAuth = async (c: AppContext) => {
    const header = c.req.header('Authorization');
    if (!header?.startsWith('Bearer '))
      throw new AppError('UNAUTHORIZED', 'Customer authentication required.');
    c.set(
      'customerAuth',
      await services.customerAuth.authenticate(header.slice(7)),
    );
  };
  const customerCtx = (c: AppContext) => c.get('customerAuth');
  const customerProtectedRoute = async (
    c: AppContext,
    next: () => Promise<void>,
  ) => {
    await customerAuth(c);
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
  registerCustomerPortalRoutes(app, {
    services,
    body,
    queryValue,
    customerAuth,
    customerCtx,
    customerProtectedRoute,
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
  app.post('/public/venues/:slug/portal/register', async (c) =>
    c.json(
      ok(
        await services.customerAccounts.register(
          c.req.param('slug'),
          await body(c, CustomerPortalRegistrationInputSchema),
        ),
      ),
      201,
    ),
  );
  app.post('/public/venues/:slug/portal/activate', async (c) =>
    c.json(
      ok(
        await services.customerAccounts.setPassword(
          c.req.param('slug'),
          await body(c, CustomerPortalPasswordInputSchema),
          'ACTIVATION',
        ),
      ),
    ),
  );
  app.post('/public/venues/:slug/portal/reset-password', async (c) =>
    c.json(
      ok(
        await services.customerAccounts.setPassword(
          c.req.param('slug'),
          await body(c, CustomerPortalPasswordInputSchema),
          'RESET',
        ),
      ),
    ),
  );
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
  app.use('/waitlists/*', protectedRoute);
  app.use('/coaches', protectedRoute);
  app.use('/today', protectedRoute);
  app.use('/charges/*', protectedRoute);
  app.use('/finance/*', protectedRoute);
  app.use('/dashboard', protectedRoute);
  app.use('/reports/*', protectedRoute);
  app.use('/exports/*', protectedRoute);
  app.use('/plans/*', protectedRoute);
  app.use('/memberships/*', protectedRoute);
  app.use('/fixed-court-agreements/*', protectedRoute);
  app.use('/package-definitions/*', protectedRoute);
  app.use('/customer-packages/*', protectedRoute);
  app.use('/customer-packages', protectedRoute);
  app.use('/makeup-credits/*', protectedRoute);
  app.use('/credit-adjustments/*', protectedRoute);
  app.use('/credit-adjustments', protectedRoute);
  app.get('/organization', async (c) =>
    c.json(ok(await services.organizations.get(ctx(c)))),
  );
  app.patch('/organization', async (c) =>
    c.json(
      ok(
        await services.organizations.update(
          ctx(c),
          await body(c, OrganizationUpdateInputSchema),
        ),
      ),
    ),
  );
  app.get('/plans', async (c) => {
    const query = c.req.query();
    const pagination = queryValue(query, PaginationSchema);
    const limit = pagination.limit ?? 50;
    const status = query.status
      ? queryValue(query.status, PlanStatusSchema)
      : undefined;
    return c.json(
      collection(
        await services.plans.list(
          ctx(c),
          status === undefined ? { limit } : { status, limit },
        ),
      ),
    );
  });
  app.post('/plans', async (c) =>
    c.json(
      ok(await services.plans.create(ctx(c), await body(c, PlanInputSchema))),
      201,
    ),
  );
  app.get('/plans/:id', async (c) =>
    c.json(ok(await services.plans.get(ctx(c), c.req.param('id')))),
  );
  app.patch('/plans/:id', async (c) =>
    c.json(
      ok(
        await services.plans.update(
          ctx(c),
          c.req.param('id')!,
          await body(c, PlanUpdateInputSchema),
        ),
      ),
    ),
  );
  app.post('/plans/:id/archive', async (c) =>
    c.json(ok(await services.plans.archive(ctx(c), c.req.param('id')))),
  );
  app.get('/memberships', async (c) => {
    const query = c.req.query();
    const pagination = queryValue(query, PaginationSchema);
    const windowDays = query.windowDays
      ? queryValue(query.windowDays, z.coerce.number().int().min(0).max(365))
      : 30;
    const flag = (name: string) => query[name] === 'true';
    const status = query.status
      ? queryValue(query.status, MembershipStatusSchema)
      : undefined;
    const identifier = z.string().min(1).max(128);
    const renewalFrom = query.renewalFrom
      ? queryValue(query.renewalFrom, DateSchema)
      : undefined;
    const renewalTo = query.renewalTo
      ? queryValue(query.renewalTo, DateSchema)
      : undefined;
    return c.json(
      collection(
        await services.memberships.list(ctx(c), {
          ...(pagination.limit === undefined
            ? {}
            : { limit: pagination.limit }),
          ...(status ? { status } : {}),
          ...(query.planId
            ? { planId: queryValue(query.planId, identifier) }
            : {}),
          ...(query.customerId
            ? { customerId: queryValue(query.customerId, identifier) }
            : {}),
          ...(renewalFrom ? { renewalFrom } : {}),
          ...(renewalTo ? { renewalTo } : {}),
          ...(flag('renewalDue') ? { renewalDue: true } : {}),
          ...(flag('overdue') ? { overdue: true } : {}),
          ...(flag('expiringSoon') ? { expiringSoon: true } : {}),
          ...(query.windowDays ? { windowDays } : {}),
        }),
      ),
    );
  });
  app.get('/memberships/renewals-due', async (c) => {
    const query = c.req.query();
    const pagination = queryValue(query, PaginationSchema);
    const windowDays = query.windowDays
      ? queryValue(query.windowDays, z.coerce.number().int().min(0).max(365))
      : 30;
    return c.json(
      collection(
        await services.memberships.list(ctx(c), {
          renewalDue: true,
          windowDays,
          ...(pagination.limit === undefined
            ? {}
            : { limit: pagination.limit }),
        }),
      ),
    );
  });
  app.get('/memberships/overdue', async (c) => {
    const query = c.req.query();
    const pagination = queryValue(query, PaginationSchema);
    return c.json(
      collection(
        await services.memberships.list(ctx(c), {
          overdue: true,
          ...(pagination.limit === undefined
            ? {}
            : { limit: pagination.limit }),
        }),
      ),
    );
  });
  app.get('/memberships/expiring-soon', async (c) => {
    const query = c.req.query();
    const pagination = queryValue(query, PaginationSchema);
    const windowDays = query.windowDays
      ? queryValue(query.windowDays, z.coerce.number().int().min(0).max(365))
      : 30;
    return c.json(
      collection(
        await services.memberships.list(ctx(c), {
          expiringSoon: true,
          windowDays,
          ...(pagination.limit === undefined
            ? {}
            : { limit: pagination.limit }),
        }),
      ),
    );
  });
  app.post('/memberships', async (c) =>
    c.json(
      ok(
        await services.memberships.create(
          ctx(c),
          await body(c, MembershipInputSchema),
        ),
      ),
      201,
    ),
  );
  app.get('/memberships/:id', async (c) =>
    c.json(ok(await services.memberships.get(ctx(c), c.req.param('id')))),
  );
  app.get('/memberships/:id/periods', async (c) =>
    c.json(
      collection(await services.memberships.periods(ctx(c), c.req.param('id'))),
    ),
  );
  app.patch('/memberships/:id', async (c) =>
    c.json(
      ok(
        await services.memberships.update(
          ctx(c),
          c.req.param('id'),
          await body(c, MembershipUpdateInputSchema),
        ),
      ),
    ),
  );
  app.post('/memberships/:id/activate', async (c) =>
    c.json(ok(await services.memberships.activate(ctx(c), c.req.param('id')))),
  );
  app.post('/memberships/:id/pause', async (c) =>
    c.json(ok(await services.memberships.pause(ctx(c), c.req.param('id')))),
  );
  app.post('/memberships/:id/resume', async (c) =>
    c.json(ok(await services.memberships.resume(ctx(c), c.req.param('id')))),
  );
  app.post('/memberships/:id/cancel', async (c) =>
    c.json(
      ok(
        await services.memberships.cancel(
          ctx(c),
          c.req.param('id'),
          await body(c, MembershipCancelInputSchema),
        ),
      ),
    ),
  );
  app.post('/memberships/:id/renew', async (c) =>
    c.json(
      ok(
        await services.memberships.renew(
          ctx(c),
          c.req.param('id'),
          await body(c, MembershipRenewInputSchema),
        ),
      ),
    ),
  );
  app.get('/fixed-court-agreements', async (c) => {
    const query = c.req.query();
    const pagination = queryValue(query, PaginationSchema);
    const identifier = z.string().min(1).max(128);
    const status = query.status
      ? queryValue(query.status, FixedCourtAgreementStatusSchema)
      : undefined;
    return c.json(
      collection(
        await services.fixedCourtAgreements.list(ctx(c), {
          ...(status ? { status } : {}),
          ...(query.customerId
            ? { customerId: queryValue(query.customerId, identifier) }
            : {}),
          ...(pagination.limit === undefined
            ? {}
            : { limit: pagination.limit }),
        }),
      ),
    );
  });
  app.post('/fixed-court-agreements', async (c) =>
    c.json(
      ok(
        await services.fixedCourtAgreements.create(
          ctx(c),
          await body(c, FixedCourtAgreementInputSchema),
        ),
      ),
      201,
    ),
  );
  app.get('/fixed-court-agreements/:id', async (c) =>
    c.json(
      ok(await services.fixedCourtAgreements.get(ctx(c), c.req.param('id'))),
    ),
  );
  app.get('/fixed-court-agreements/:id/occurrences', async (c) =>
    c.json(
      collection(
        await services.fixedCourtAgreements.occurrences(
          ctx(c),
          c.req.param('id')!,
        ),
      ),
    ),
  );
  app.post('/fixed-court-agreements/:id/pause', async (c) =>
    c.json(
      ok(
        await services.fixedCourtAgreements.pause(
          ctx(c),
          c.req.param('id'),
          await body(c, FixedCourtAgreementActionInputSchema),
        ),
      ),
    ),
  );
  app.post('/fixed-court-agreements/:id/resume', async (c) =>
    c.json(
      ok(
        await services.fixedCourtAgreements.resume(
          ctx(c),
          c.req.param('id'),
          await body(c, FixedCourtAgreementActionInputSchema),
        ),
      ),
    ),
  );
  app.post('/fixed-court-agreements/:id/cancel', async (c) =>
    c.json(
      ok(
        await services.fixedCourtAgreements.cancel(
          ctx(c),
          c.req.param('id'),
          await body(c, FixedCourtAgreementActionInputSchema),
        ),
      ),
    ),
  );
  const changeFixedCourtSlot = async (c: AppContext) =>
    c.json(
      ok(
        await services.fixedCourtAgreements.changeSlot(
          ctx(c),
          c.req.param('id')!,
          await body(c, FixedCourtAgreementSlotChangeInputSchema),
        ),
      ),
    );
  app.post('/fixed-court-agreements/:id/change-slot', changeFixedCourtSlot);
  app.patch('/fixed-court-agreements/:id/slot', changeFixedCourtSlot);
  app.post('/fixed-court-agreements/:id/bill', async (c) =>
    c.json(
      ok(
        await services.fixedCourtAgreements.bill(
          ctx(c),
          c.req.param('id'),
          await body(c, FixedCourtAgreementBillingInputSchema),
        ),
      ),
    ),
  );
  app.get('/package-definitions', async (c) => {
    const query = c.req.query();
    const pagination = queryValue(query, PaginationSchema);
    const status = query.status
      ? queryValue(query.status, PackageDefinitionStatusSchema)
      : undefined;
    return c.json(
      collection(
        await services.packages.listDefinitions(ctx(c), {
          ...(status ? { status } : {}),
          ...(pagination.limit === undefined
            ? {}
            : { limit: pagination.limit }),
        }),
      ),
    );
  });
  app.post('/package-definitions', async (c) =>
    c.json(
      ok(
        await services.packages.createDefinition(
          ctx(c),
          await body(c, PackageDefinitionInputSchema),
        ),
      ),
      201,
    ),
  );
  app.get('/package-definitions/:id', async (c) =>
    c.json(
      ok(await services.packages.getDefinition(ctx(c), c.req.param('id'))),
    ),
  );
  app.patch('/package-definitions/:id', async (c) =>
    c.json(
      ok(
        await services.packages.updateDefinition(
          ctx(c),
          c.req.param('id'),
          await body(c, PackageDefinitionInputSchema.partial()),
        ),
      ),
    ),
  );
  app.post('/package-definitions/:id/archive', async (c) =>
    c.json(
      ok(await services.packages.archiveDefinition(ctx(c), c.req.param('id'))),
    ),
  );
  app.get('/customers/:customerId/packages', async (c) => {
    const query = c.req.query();
    const pagination = queryValue(query, PaginationSchema);
    return c.json(
      collection(
        await services.packages.listCustomerPackages(
          ctx(c),
          c.req.param('customerId'),
          {
            ...(pagination.limit === undefined
              ? {}
              : { limit: pagination.limit }),
            ...(query.activeOnly === 'true' ? { activeOnly: true } : {}),
          },
        ),
      ),
    );
  });
  app.get('/customer-packages', async (c) => {
    const query = c.req.query();
    const pagination = queryValue(query, PaginationSchema);
    const windowDays = query.windowDays
      ? queryValue(query.windowDays, z.coerce.number().int().min(0).max(365))
      : 30;
    const identifier = z.string().min(1).max(128);
    const date = (value: string | undefined) =>
      value ? queryValue(value, DateSchema) : undefined;
    const number = (value: string | undefined) =>
      value === undefined
        ? undefined
        : queryValue(value, z.coerce.number().nonnegative());
    const expirationFrom = date(query.expirationFrom);
    const expirationTo = date(query.expirationTo);
    const remainingMin = number(query.remainingMin);
    const remainingMax = number(query.remainingMax);
    const status = query.status
      ? queryValue(query.status, CustomerPackageStatusSchema)
      : undefined;
    return c.json(
      collection(
        await services.packages.list(ctx(c), {
          ...(pagination.limit === undefined
            ? {}
            : { limit: pagination.limit }),
          ...(status ? { status } : {}),
          ...(query.packageDefinitionId
            ? {
                packageDefinitionId: queryValue(
                  query.packageDefinitionId,
                  identifier,
                ),
              }
            : {}),
          ...(query.customerId
            ? { customerId: queryValue(query.customerId, identifier) }
            : {}),
          ...(expirationFrom ? { expirationFrom } : {}),
          ...(expirationTo ? { expirationTo } : {}),
          ...(remainingMin !== undefined ? { remainingMin } : {}),
          ...(remainingMax !== undefined ? { remainingMax } : {}),
          ...(query.expiringSoon === 'true' ? { expiringSoon: true } : {}),
          ...(query.windowDays ? { windowDays } : {}),
        }),
      ),
    );
  });
  app.get('/customer-packages/expiring-soon', async (c) => {
    const query = c.req.query();
    const pagination = queryValue(query, PaginationSchema);
    const windowDays = query.windowDays
      ? queryValue(query.windowDays, z.coerce.number().int().min(0).max(365))
      : 30;
    return c.json(
      collection(
        await services.packages.list(ctx(c), {
          expiringSoon: true,
          windowDays,
          ...(pagination.limit === undefined
            ? {}
            : { limit: pagination.limit }),
        }),
      ),
    );
  });
  app.post('/customers/:customerId/packages', async (c) =>
    c.json(
      ok(
        await services.packages.issue(
          ctx(c),
          c.req.param('customerId'),
          await body(c, CustomerPackageInputSchema),
        ),
      ),
      201,
    ),
  );
  app.get('/customer-packages/:id', async (c) =>
    c.json(
      ok(await services.packages.getCustomerPackage(ctx(c), c.req.param('id'))),
    ),
  );
  app.get('/customer-packages/:id/transactions', async (c) =>
    c.json(
      collection(
        await services.packages.transactions(ctx(c), c.req.param('id')),
      ),
    ),
  );
  app.post('/customer-packages/:id/cancel', async (c) =>
    c.json(ok(await services.packages.cancel(ctx(c), c.req.param('id')))),
  );
  app.post('/credit-adjustments', async (c) =>
    c.json(
      ok(
        await (async () => {
          const input = await body(c, CreditAdjustmentInputSchema);
          const {
            membershipPeriodId,
            benefitId,
            benefitPeriodKey,
            occurredAt,
            ...required
          } = input;
          return services.entitlements.adjust(ctx(c), {
            ...required,
            ...(membershipPeriodId ? { membershipPeriodId } : {}),
            ...(benefitId ? { benefitId } : {}),
            ...(benefitPeriodKey ? { benefitPeriodKey } : {}),
            ...(occurredAt ? { occurredAt } : {}),
          });
        })(),
      ),
      201,
    ),
  );
  app.get('/customers/:customerId/makeup-credits', async (c) =>
    c.json(
      collection(
        await services.makeupCredits.list(ctx(c), c.req.param('customerId')),
      ),
    ),
  );
  app.post('/customers/:customerId/makeup-credits', async (c) =>
    c.json(
      ok(
        await services.makeupCredits.issue(
          ctx(c),
          c.req.param('customerId'),
          await body(c, MakeupCreditInputSchema),
        ),
      ),
      201,
    ),
  );
  app.post('/makeup-credits/:id/expire', async (c) =>
    c.json(ok(await services.makeupCredits.expire(ctx(c), c.req.param('id')))),
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
  app.get('/customers/:id/activities', async (c) => {
    const query = c.req.query();
    const to = queryValue(
      query.to ?? new Date().toISOString(),
      z.string().datetime({ offset: true }),
    );
    const from = queryValue(
      query.from ?? new Date(Date.now() - 365 * 86400000).toISOString(),
      z.string().datetime({ offset: true }),
    );
    const activities = await services.customerActivities.listForStaff(
      ctx(c),
      c.req.param('id'),
      {
        from,
        to,
        limit: queryValue(
          query.limit ?? '50',
          z.coerce.number().int().min(1).max(100),
        ),
        ...(query.cursor ? { cursor: query.cursor } : {}),
      },
    );
    return c.json(collection(activities.data, activities.nextCursor));
  });
  app.get('/customers/:id/commercial-summary', async (c) =>
    c.json(
      ok(
        await services.customerCommercialBalance.get(ctx(c), c.req.param('id')),
      ),
    ),
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
  app.post('/customers/:id/portal-access', async (c) =>
    c.json(
      ok(await services.customerAccounts.enable(ctx(c), c.req.param('id'))),
    ),
  );
  app.post('/customers/:id/portal-reset', async (c) =>
    c.json(
      ok(await services.customerAccounts.reset(ctx(c), c.req.param('id'))),
    ),
  );
  app.post('/customers/:id/portal-disable', async (c) =>
    c.json(
      ok(await services.customerAccounts.disable(ctx(c), c.req.param('id'))),
    ),
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
    c.json(collection(await services.payments.list(ctx(c), c.req.query()))),
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
  app.get('/waitlists', async (c) =>
    c.json(collection(await services.waitlists.staffList(ctx(c)))),
  );
  app.post('/waitlists/:id/fulfill', async (c) =>
    c.json(ok(await services.waitlists.fulfill(ctx(c), c.req.param('id')))),
  );
  app.post('/waitlists/:id/expire', async (c) =>
    c.json(ok(await services.waitlists.expire(ctx(c), c.req.param('id')))),
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
  app.post('/class-sessions/:id/makeup-credits', async (c) => {
    const input = await body(c, MakeupCreditInputSchema);
    if (!input.customerId)
      throw new AppError(
        'VALIDATION_ERROR',
        'A customer is required for a makeup credit.',
      );
    return c.json(
      ok(
        await services.makeupCredits.issue(ctx(c), input.customerId, {
          ...input,
          originSessionId: c.req.param('id'),
        }),
      ),
      201,
    );
  });
  app.post('/class-sessions/:id/cancel', async (c) => {
    const input = await body(
      c,
      z.object({
        reason: z.string().optional(),
        issueMakeupCredits: z.boolean().optional(),
      }),
    );
    return c.json(
      ok(
        await services.classes.cancelSession(
          ctx(c),
          c.req.param('id'),
          input.reason,
          input.issueMakeupCredits === true,
        ),
      ),
    );
  });
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
