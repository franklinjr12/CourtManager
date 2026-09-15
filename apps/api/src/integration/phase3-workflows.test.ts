import { randomUUID } from 'node:crypto';
import { expect, describe, it } from 'vitest';
import { createApp } from '../app.js';
import { dynamo, ensureTable } from '../db.js';
import { Phase3Repository } from '../persistence/phase3-repository.js';
import { hashPassword } from '../security.js';

process.env.DYNAMODB_ENDPOINT = 'http://localhost:8120';
process.env.DYNAMODB_TABLE = 'court-manager-integration';
process.env.AWS_REGION = 'us-east-1';

type ApiBody<T> = { data?: T; error?: { code?: string; message?: string } };
type Api = ReturnType<typeof createApp>;

const password = 'phase3-workflow-password';

const dateAfter = (days: number, from = new Date()) => {
  const value = new Date(from);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const nextWednesday = () => {
  const today = new Date();
  const day = today.getUTCDay();
  return dateAfter((3 - day + 7) % 7 || 7, today);
};

const openingHours = Object.fromEntries(
  [
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
    'SATURDAY',
    'SUNDAY',
  ].map((day) => [day, { open: '07:00', close: '23:00' }]),
);

async function request<T>(
  app: Api,
  method: string,
  path: string,
  token?: string,
  input?: unknown,
) {
  const response = await app.request(path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(input === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  return {
    status: response.status,
    body: (await response.json().catch(() => ({}))) as ApiBody<T>,
  };
}

function result<T>(response: Awaited<ReturnType<typeof request<T>>>) {
  if (response.status >= 300 || response.body.data === undefined)
    throw new Error(
      `Expected a successful API response, got ${response.status}: ${JSON.stringify(response.body)}`,
    );
  return response.body.data;
}

async function workflowFixture() {
  await ensureTable();
  const repo = dynamo();
  const organizationId = `workflow-${randomUUID()}`;
  const ownerId = `owner-${organizationId}`;
  const ownerEmail = `${ownerId}@phase3.test`;
  const timestamp = new Date().toISOString();
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: 'META',
    entity: 'organization',
    organizationId,
    name: 'Phase 3 Workflow Arena',
    slug: organizationId,
    timezone: 'UTC',
    currency: 'BRL',
    active: true,
    features: { classes: true, finance: true },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: `USER#${ownerId}`,
    entity: 'user',
    organizationId,
    userId: ownerId,
    name: 'Phase 3 Owner',
    email: ownerEmail,
    role: 'OWNER',
    active: true,
    passwordHash: await hashPassword(password),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: 'USER#coach',
    entity: 'user',
    organizationId,
    userId: 'coach',
    name: 'Phase 3 Coach',
    email: `coach-${organizationId}@phase3.test`,
    role: 'COACH',
    active: true,
    passwordHash: 'unused',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const app = createApp(repo);
  const login = result<{ token: string }>(
    await request(app, 'POST', '/auth/login', undefined, {
      email: ownerEmail,
      password,
    }),
  );
  const token = login.token;
  const court = result<{ courtId: string }>(
    await request(app, 'POST', '/courts', token, {
      name: `Workflow Court ${organizationId.slice(-6)}`,
      sport: 'Tennis',
      slotMinutes: 30,
      defaultHourlyPrice: 80,
      publiclyRequestable: true,
      active: true,
      openingHours,
    }),
  );
  const customer = async (name: string) =>
    result<{ customerId: string }>(
      await request(app, 'POST', '/customers', token, {
        name,
        phone: `419${Date.now().toString().slice(-8)}`,
      }),
    );
  return {
    app,
    repo,
    token,
    ownerId,
    organizationId,
    courtId: court.courtId,
    customer,
  };
}

async function packageBalance(
  app: Api,
  token: string,
  customerPackageId: string,
) {
  const data = result<{
    creditBalances: Array<{
      remainingQuantity: number;
      expiredQuantity: number;
    }>;
  }>(
    await request(app, 'GET', `/customer-packages/${customerPackageId}`, token),
  );
  return data.creditBalances[0]!;
}

describe('Phase 3 HTTP workflows on DynamoDB Local', () => {
  it('covers a monthly class membership, enforces the limit, and resets on renewal', async () => {
    const fixture = await workflowFixture();
    const customer = await fixture.customer('Carlos Membership');
    const plan = result<{ planId: string }>(
      await request(fixture.app, 'POST', '/plans', fixture.token, {
        name: '8 Classes / Month',
        basePrice: 280,
        benefits: [
          {
            benefitId: 'monthly-class-attendance',
            type: 'CLASS_ATTENDANCE',
            period: 'MONTH',
            quantityType: 'FINITE',
            quantity: 8,
            unit: 'SESSION',
          },
        ],
      }),
    );
    const membership = result<{
      membershipId: string;
      currentPeriodId: string;
    }>(
      await request(fixture.app, 'POST', '/memberships', fixture.token, {
        customerId: customer.customerId,
        planId: plan.planId,
        startDate: dateAfter(0),
      }),
    );
    const sessionIds: string[] = [];
    for (let index = 1; index <= 9; index += 1) {
      const classDate = dateAfter(index);
      const classRecord = result<{ classId: string }>(
        await request(fixture.app, 'POST', '/classes', fixture.token, {
          name: `Membership Class ${index}`,
          sport: 'Tennis',
          coachId: 'coach',
          courtId: fixture.courtId,
          capacity: 1,
          pricePerParticipant: 35,
          scheduleType: 'SINGLE',
          startDate: classDate,
          startTime: '10:00',
          durationMinutes: 60,
        }),
      );
      result(
        await request(
          fixture.app,
          'POST',
          `/classes/${classRecord.classId}/enroll`,
          fixture.token,
          {
            customerId: customer.customerId,
          },
        ),
      );
      sessionIds.push(`${classRecord.classId}-${classDate}`);
    }
    for (const sessionId of sessionIds.slice(0, 8))
      result(
        await request(
          fixture.app,
          'POST',
          `/class-sessions/${sessionId}/participants/${customer.customerId}/check-in`,
          fixture.token,
        ),
      );

    const ninth = await request(
      fixture.app,
      'POST',
      `/class-sessions/${sessionIds[8]}/participants/${customer.customerId}/check-in`,
      fixture.token,
    );
    expect(ninth.status).toBe(409);
    expect(ninth.body.error?.code).toBe('CONFLICT');

    const commercial = new Phase3Repository(fixture.repo);
    const beforeRenewal = await commercial.listCreditBalancesBySource(
      fixture.organizationId,
      'MEMBERSHIP',
      membership.membershipId,
      100,
    );
    expect(beforeRenewal).toEqual([
      expect.objectContaining({
        membershipPeriodId: membership.currentPeriodId,
        issuedQuantity: 8,
        consumedQuantity: 8,
        remainingQuantity: 0,
      }),
    ]);

    result(
      await request(
        fixture.app,
        'POST',
        `/memberships/${membership.membershipId}/renew`,
        fixture.token,
        {
          idempotencyKey: `renew-${randomUUID()}`,
        },
      ),
    );
    const periods = result<Array<{ status: string; periodNumber: number }>>(
      await request(
        fixture.app,
        'GET',
        `/memberships/${membership.membershipId}/periods`,
        fixture.token,
      ),
    );
    expect(periods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ periodNumber: 1, status: 'COMPLETED' }),
        expect.objectContaining({ periodNumber: 2, status: 'ACTIVE' }),
      ]),
    );
    const afterRenewal = await commercial.listCreditBalancesBySource(
      fixture.organizationId,
      'MEMBERSHIP',
      membership.membershipId,
      100,
    );
    expect(afterRenewal).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ consumedQuantity: 8, remainingQuantity: 0 }),
        expect.objectContaining({
          issuedQuantity: 8,
          consumedQuantity: 0,
          remainingQuantity: 8,
        }),
      ]),
    );
  });

  it('consumes and restores court-hour package credits through reservation cancellation', async () => {
    const fixture = await workflowFixture();
    const customer = await fixture.customer('Maria Package');
    const definition = result<{ packageDefinitionId: string }>(
      await request(
        fixture.app,
        'POST',
        '/package-definitions',
        fixture.token,
        {
          name: '10 Court Hours',
          price: 700,
          validityDays: 90,
          benefits: [
            {
              benefitId: 'court-hours',
              type: 'COURT_TIME',
              period: 'PACKAGE_LIFETIME',
              quantityType: 'FINITE',
              quantity: 600,
              unit: 'COURT_MINUTES',
            },
          ],
        },
      ),
    );
    const customerPackage = result<{ customerPackageId: string }>(
      await request(
        fixture.app,
        'POST',
        `/customers/${customer.customerId}/packages`,
        fixture.token,
        {
          packageDefinitionId: definition.packageDefinitionId,
          idempotencyKey: `maria-${randomUUID()}`,
        },
      ),
    );
    const first = result<{ reservationId: string }>(
      await request(fixture.app, 'POST', '/reservations', fixture.token, {
        courtId: fixture.courtId,
        customerId: customer.customerId,
        startAt: `${dateAfter(1)}T18:00:00.000Z`,
        endAt: `${dateAfter(1)}T20:00:00.000Z`,
        source: 'STAFF',
      }),
    );
    expect(
      (
        await packageBalance(
          fixture.app,
          fixture.token,
          customerPackage.customerPackageId,
        )
      ).remainingQuantity,
    ).toBe(480);
    const second = result<{ reservationId: string }>(
      await request(fixture.app, 'POST', '/reservations', fixture.token, {
        courtId: fixture.courtId,
        customerId: customer.customerId,
        startAt: `${dateAfter(2)}T18:00:00.000Z`,
        endAt: `${dateAfter(2)}T19:00:00.000Z`,
        source: 'STAFF',
      }),
    );
    expect(
      (
        await packageBalance(
          fixture.app,
          fixture.token,
          customerPackage.customerPackageId,
        )
      ).remainingQuantity,
    ).toBe(420);
    result(
      await request(
        fixture.app,
        'POST',
        `/reservations/${second.reservationId}/cancel`,
        fixture.token,
      ),
    );
    expect(
      (
        await packageBalance(
          fixture.app,
          fixture.token,
          customerPackage.customerPackageId,
        )
      ).remainingQuantity,
    ).toBe(480);
    expect(first.reservationId).not.toBe(second.reservationId);
  });

  it('partially covers a reservation and leaves an ordinary direct charge for the uncovered amount', async () => {
    const fixture = await workflowFixture();
    const customer = await fixture.customer('Partial Coverage Customer');
    const definition = result<{ packageDefinitionId: string }>(
      await request(
        fixture.app,
        'POST',
        '/package-definitions',
        fixture.token,
        {
          name: '60 Court Minutes',
          price: 80,
          validityDays: 90,
          benefits: [
            {
              benefitId: 'partial-court-time',
              type: 'COURT_TIME',
              period: 'PACKAGE_LIFETIME',
              quantityType: 'FINITE',
              quantity: 60,
              unit: 'COURT_MINUTES',
            },
          ],
        },
      ),
    );
    const customerPackage = result<{ customerPackageId: string }>(
      await request(
        fixture.app,
        'POST',
        `/customers/${customer.customerId}/packages`,
        fixture.token,
        {
          packageDefinitionId: definition.packageDefinitionId,
        },
      ),
    );
    const reservation = result<{
      reservationId: string;
      expectedAmount: number;
    }>(
      await request(fixture.app, 'POST', '/reservations', fixture.token, {
        courtId: fixture.courtId,
        customerId: customer.customerId,
        startAt: `${dateAfter(3)}T18:00:00.000Z`,
        endAt: `${dateAfter(3)}T20:00:00.000Z`,
        source: 'STAFF',
      }),
    );
    expect(reservation.expectedAmount).toBe(80);
    expect(
      (
        await packageBalance(
          fixture.app,
          fixture.token,
          customerPackage.customerPackageId,
        )
      ).remainingQuantity,
    ).toBe(0);
    const charges = result<
      Array<{ reservationId: string; amount: number; outstanding: number }>
    >(
      await request(
        fixture.app,
        'GET',
        `/charges?sourceType=RESERVATION&customerId=${customer.customerId}`,
        fixture.token,
      ),
    );
    expect(charges).toEqual([
      expect.objectContaining({
        reservationId: reservation.reservationId,
        amount: 80,
        outstanding: 80,
      }),
    ]);
  });

  it('creates fixed recurring occurrences with one monthly commercial charge and no reservation charges', async () => {
    const fixture = await workflowFixture();
    const customer = await fixture.customer('Joao Fixed Court');
    const startDate = nextWednesday();
    const agreement = result<{ agreementId: string; occurrences: unknown[] }>(
      await request(
        fixture.app,
        'POST',
        '/fixed-court-agreements',
        fixture.token,
        {
          customerId: customer.customerId,
          courtId: fixture.courtId,
          weekday: 'WEDNESDAY',
          startTime: '19:00',
          durationMinutes: 120,
          startDate,
          endDate: dateAfter(21, new Date(`${startDate}T00:00:00.000Z`)),
          intervalWeeks: 1,
          monthlyPrice: 600,
          timezone: 'UTC',
        },
      ),
    );
    expect(agreement.occurrences).toHaveLength(4);
    const reservations = result<Array<{ expectedAmount: number }>>(
      await request(
        fixture.app,
        'GET',
        `/reservations?customerId=${customer.customerId}`,
        fixture.token,
      ),
    );
    expect(reservations).toHaveLength(4);
    expect(
      reservations.every((reservation) => reservation.expectedAmount === 0),
    ).toBe(true);
    const fixedCharges = result<Array<{ amount: number; sourceId: string }>>(
      await request(
        fixture.app,
        'GET',
        `/charges?sourceType=FIXED_COURT_AGREEMENT&customerId=${customer.customerId}`,
        fixture.token,
      ),
    );
    expect(fixedCharges).toEqual([
      expect.objectContaining({ amount: 600, sourceId: agreement.agreementId }),
    ]);
    expect(
      result<unknown[]>(
        await request(
          fixture.app,
          'GET',
          `/charges?sourceType=RESERVATION&customerId=${customer.customerId}`,
          fixture.token,
        ),
      ),
    ).toHaveLength(0);
  });

  it('settles a membership renewal with an externally recorded PIX payment', async () => {
    const fixture = await workflowFixture();
    const customer = await fixture.customer('External Payment Customer');
    const plan = result<{ planId: string }>(
      await request(fixture.app, 'POST', '/plans', fixture.token, {
        name: 'Paid Membership',
        basePrice: 280,
        benefits: [
          {
            type: 'CLASS_ATTENDANCE',
            period: 'MONTH',
            quantityType: 'FINITE',
            quantity: 8,
            unit: 'SESSION',
          },
        ],
      }),
    );
    const membership = result<{
      membershipId: string;
      currentPeriodId: string;
    }>(
      await request(fixture.app, 'POST', '/memberships', fixture.token, {
        customerId: customer.customerId,
        planId: plan.planId,
        startDate: dateAfter(0),
      }),
    );
    const charges = result<Array<{ chargeId: string; amount: number }>>(
      await request(
        fixture.app,
        'GET',
        `/charges?sourceType=MEMBERSHIP&customerId=${customer.customerId}`,
        fixture.token,
      ),
    );
    expect(charges).toEqual([expect.objectContaining({ amount: 280 })]);
    result(
      await request(fixture.app, 'POST', '/payments', fixture.token, {
        chargeId: charges[0]!.chargeId,
        customerId: customer.customerId,
        amount: 280,
        method: 'PIX',
        paidAt: new Date().toISOString(),
      }),
    );
    const renewed = result<{ currentPeriodId: string }>(
      await request(
        fixture.app,
        'POST',
        `/memberships/${membership.membershipId}/renew`,
        fixture.token,
        { idempotencyKey: `external-renewal-${randomUUID()}` },
      ),
    );
    expect(renewed.currentPeriodId).not.toBe(membership.currentPeriodId);
    const renewalCharges = result<
      Array<{ chargeId: string; amount: number; sourceId: string }>
    >(
      await request(
        fixture.app,
        'GET',
        `/charges?sourceType=MEMBERSHIP&customerId=${customer.customerId}`,
        fixture.token,
      ),
    );
    const renewalCharge = renewalCharges.find(
      (charge) => charge.sourceId === renewed.currentPeriodId,
    );
    expect(renewalCharge).toMatchObject({ amount: 280 });
    result(
      await request(fixture.app, 'POST', '/payments', fixture.token, {
        chargeId: renewalCharge!.chargeId,
        customerId: customer.customerId,
        amount: 280,
        method: 'PIX',
        paidAt: new Date().toISOString(),
      }),
    );
    const summary = result<{
      balance: { outstandingAmount: number };
      memberships: Array<{ membershipId: string }>;
    }>(
      await request(
        fixture.app,
        'GET',
        `/customers/${customer.customerId}/commercial-summary`,
        fixture.token,
      ),
    );
    expect(summary.balance.outstandingAmount).toBe(0);
    expect(summary.memberships).toEqual([
      expect.objectContaining({ membershipId: membership.membershipId }),
    ]);
    const payment = result<Array<{ chargeId?: string; amount: number }>>(
      await request(
        fixture.app,
        'GET',
        `/payments?customerId=${customer.customerId}`,
        fixture.token,
      ),
    );
    expect(payment).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chargeId: renewalCharge!.chargeId,
          amount: 280,
        }),
      ]),
    );
  });

  it('expires old package credits, keeps the ledger history, and does not cover a new reservation', async () => {
    const fixture = await workflowFixture();
    const customer = await fixture.customer('Expired Package Customer');
    const definition = result<{ packageDefinitionId: string }>(
      await request(
        fixture.app,
        'POST',
        '/package-definitions',
        fixture.token,
        {
          name: 'Expiring Court Credit',
          price: 80,
          validityDays: 1,
          benefits: [
            {
              benefitId: 'expiring-court-time',
              type: 'COURT_TIME',
              period: 'PACKAGE_LIFETIME',
              quantityType: 'FINITE',
              quantity: 60,
              unit: 'COURT_MINUTES',
            },
          ],
        },
      ),
    );
    const customerPackage = result<{ customerPackageId: string }>(
      await request(
        fixture.app,
        'POST',
        `/customers/${customer.customerId}/packages`,
        fixture.token,
        {
          packageDefinitionId: definition.packageDefinitionId,
          issuedAt: '2020-09-01T00:00:00.000Z',
          startsAt: '2020-09-01T00:00:00.000Z',
        },
      ),
    );
    const expired = await packageBalance(
      fixture.app,
      fixture.token,
      customerPackage.customerPackageId,
    );
    expect(expired).toMatchObject({
      remainingQuantity: 0,
      expiredQuantity: 60,
    });
    const transactions = result<
      Array<{ transactionType: string; quantity: number }>
    >(
      await request(
        fixture.app,
        'GET',
        `/customer-packages/${customerPackage.customerPackageId}/transactions`,
        fixture.token,
      ),
    );
    expect(transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ transactionType: 'ISSUED', quantity: 60 }),
        expect.objectContaining({ transactionType: 'EXPIRED', quantity: -60 }),
      ]),
    );
    const reservation = result<{
      reservationId: string;
      expectedAmount: number;
    }>(
      await request(fixture.app, 'POST', '/reservations', fixture.token, {
        courtId: fixture.courtId,
        customerId: customer.customerId,
        startAt: `${dateAfter(4)}T18:00:00.000Z`,
        endAt: `${dateAfter(4)}T19:00:00.000Z`,
        source: 'STAFF',
      }),
    );
    expect(reservation.expectedAmount).toBe(80);
    const detail = result<{ entitlementAllocations: unknown[] }>(
      await request(
        fixture.app,
        'GET',
        `/reservations/${reservation.reservationId}`,
        fixture.token,
      ),
    );
    expect(detail.entitlementAllocations).toHaveLength(0);
  });
});
