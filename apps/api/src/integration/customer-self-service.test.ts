import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { dynamo, ensureTable } from '../db.js';
import { phase2Keys } from '../persistence/phase2-keys.js';

process.env.DYNAMODB_ENDPOINT = 'http://localhost:8120';
process.env.DYNAMODB_TABLE = 'court-manager-integration';
process.env.AWS_REGION = 'us-east-1';

describe('DynamoDB Local customer self-service access patterns', () => {
  it('queries customer account, reservation, request, preference, and waitlist partitions', async () => {
    await ensureTable();
    const repo = dynamo();
    const organizationId = randomUUID();
    const customerId = randomUUID();
    const accountId = randomUUID();
    const reservationId = randomUUID();
    const requestId = randomUUID();
    const waitlistId = randomUUID();
    const email = `${randomUUID()}@example.test`;
    const first = '2099-01-05T12:00:00.000Z';

    await repo.put({
      ...phase2Keys.customerAccount(organizationId, accountId),
      entity: 'customerAccount',
      organizationId,
      customerId,
      customerAccountId: accountId,
      normalizedEmail: email,
      status: 'ACTIVE',
    });
    await repo.put({
      ...phase2Keys.customerAccountByEmail(organizationId, email),
      entity: 'customerAccount',
      organizationId,
      customerId,
      customerAccountId: accountId,
    });
    await repo.put({
      ...phase2Keys.customerAccountByCustomer(organizationId, customerId),
      entity: 'customerAccount',
      organizationId,
      customerId,
      customerAccountId: accountId,
    });
    expect(
      await repo.query(`ORG#${organizationId}`, {
        beginsWith: 'CUSTOMER_ACCOUNT',
      }),
    ).toHaveLength(3);
    expect(
      await repo.get(phase2Keys.customerAccountByEmail(organizationId, email)),
    ).toMatchObject({ customerId, customerAccountId: accountId });

    await repo.put({
      ...phase2Keys.customerReservation(
        organizationId,
        customerId,
        first,
        reservationId,
      ),
      entity: 'customerReservationIndex',
      reservationId,
      customerId,
      status: 'BOOKED',
      startAt: first,
    });
    await repo.put({
      ...phase2Keys.customerReservationHistory(
        organizationId,
        customerId,
        '2099-01-06T12:00:00.000Z',
        reservationId,
      ),
      entity: 'customerReservationHistoryIndex',
      reservationId,
      customerId,
      status: 'CANCELLED',
    });
    await repo.put({
      ...phase2Keys.customerReservationRequest(
        organizationId,
        customerId,
        '2099-01-04T12:00:00.000Z',
        requestId,
      ),
      entity: 'customerReservationRequestIndex',
      requestId,
      customerId,
      status: 'REQUESTED',
    });
    const customerPartition = await repo.query(
      phase2Keys.customerReservations(organizationId, customerId).PK,
    );
    expect(customerPartition).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reservationId, status: 'BOOKED' }),
        expect.objectContaining({ reservationId, status: 'CANCELLED' }),
        expect.objectContaining({ requestId, status: 'REQUESTED' }),
      ]),
    );

    const sportId = randomUUID();
    await repo.put({
      ...phase2Keys.customerSportPreferences(organizationId, customerId),
      entity: 'customerSportPreferences',
      customerId,
      sportIds: [sportId],
      preferredSportId: sportId,
    });
    await repo.put({
      ...phase2Keys.customerBySportPreference(
        organizationId,
        sportId,
        customerId,
      ),
      entity: 'customerSportPreference',
      customerId,
      sportId,
      preferred: true,
    });
    expect(
      await repo.get(
        phase2Keys.customerSportPreferences(organizationId, customerId),
      ),
    ).toMatchObject({ sportIds: [sportId], preferredSportId: sportId });
    expect(
      await repo.query(
        phase2Keys.customersBySportPreference(organizationId, sportId).PK,
        { beginsWith: 'CUSTOMER#' },
      ),
    ).toEqual([expect.objectContaining({ customerId, preferred: true })]);

    await repo.put({
      ...phase2Keys.customerWaitlist(
        organizationId,
        customerId,
        '2099-01-04T12:00:00.000Z',
        waitlistId,
      ),
      entity: 'waitlist',
      waitlistId,
      customerId,
      status: 'ACTIVE',
    });
    expect(
      await repo.query(
        phase2Keys.customerWaitlists(organizationId, customerId).PK,
        { beginsWith: 'WAITLIST#ACTIVE#' },
      ),
    ).toEqual([expect.objectContaining({ waitlistId, status: 'ACTIVE' })]);
  });
});
