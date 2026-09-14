import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { dynamo, ensureTable } from '../db.js';
import { ReservationParticipantService } from '../services/reservation-participants.js';
process.env.DYNAMODB_ENDPOINT = 'http://localhost:8120';
process.env.DYNAMODB_TABLE = 'court-manager-integration';
process.env.AWS_REGION = 'us-east-1';

describe('DynamoDB reservation participants', () => {
  it('persists participants, checks parent state and rejects stale revisions atomically', async () => {
    await ensureTable();
    const repo = dynamo();
    const service = new ReservationParticipantService(repo);
    const reservationId = randomUUID();
    const ctx = {
      actorType: 'CUSTOMER' as const,
      organizationId: randomUUID(),
      customerId: 'owner',
      customerAccountId: 'account',
    };
    const reservation = {
      PK: `RESERVATION#${reservationId}`,
      SK: 'META',
      organizationId: ctx.organizationId,
      customerId: ctx.customerId,
      status: 'BOOKED',
      startAt: '2099-01-01T12:00:00.000Z',
    };
    await repo.put(reservation);
    const id = randomUUID();
    await service.save(ctx, reservationId, id, { name: 'Maria' });
    await service.save(ctx, reservationId, id, { name: 'Maria Updated' });
    const key = {
      PK: `RESERVATION_PARTICIPANTS#${ctx.organizationId}#${reservationId}`,
      SK: `PARTICIPANT#${id}`,
    };
    const stored = (await repo.get(key))!;
    await expect(
      repo.transactWrite([
        {
          type: 'put',
          item: { ...stored, name: 'Stale' },
          expected: { revision: 'stale' },
        },
      ]),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await repo.put({ ...reservation, status: 'CANCELLED' });
    await expect(
      repo.transactWrite([
        {
          type: 'check',
          key: { PK: reservation.PK, SK: reservation.SK },
          expected: { status: 'BOOKED' },
        },
        {
          type: 'put',
          item: { ...stored, name: 'Racing cancellation' },
          expected: { revision: stored.revision },
        },
      ]),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await service.list(ctx, reservationId)).participants[0]?.name).toBe(
      'Maria Updated',
    );
    await expect(service.remove(ctx, reservationId, id)).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    await repo.put(reservation);
    await service.remove(ctx, reservationId, id);
    expect((await repo.get(key))?.status).toBe('REMOVED');
    await repo.put({ ...reservation, status: 'COMPLETED' });
    expect(
      (await service.list(ctx, reservationId)).participants[0]?.status,
    ).toBe('REMOVED');
  });
});
