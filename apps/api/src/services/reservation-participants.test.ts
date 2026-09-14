import { randomUUID } from 'node:crypto';
import { ReservationParticipantInputSchema } from '@court-manager/contracts';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRepository } from '../db.js';
import { ReservationParticipantService } from './reservation-participants.js';

const ctx = {
  actorType: 'CUSTOMER' as const,
  organizationId: 'one',
  customerId: 'owner',
  customerAccountId: 'account',
};
async function setup() {
  const repo = new MemoryRepository();
  const reservation = {
    PK: 'RESERVATION#booking',
    SK: 'META',
    organizationId: 'one',
    customerId: 'owner',
    status: 'BOOKED',
    startAt: '2099-01-01T12:00:00.000Z',
  };
  await repo.put(reservation);
  return {
    repo,
    reservation,
    service: new ReservationParticipantService(repo),
  };
}

describe('reservation participants', () => {
  it('adds, edits, retries and soft removes unresolved participants without adding the owner', async () => {
    const { repo, service } = await setup();
    expect((await service.list(ctx, 'booking')).participants).toEqual([]);
    const id = randomUUID();
    const added = await service.save(ctx, 'booking', id, {
      name: ' Maria ',
      phone: '123',
    });
    expect(added).toEqual({
      participantId: id,
      name: 'Maria',
      phone: '123',
      status: 'ACTIVE',
    });
    await service.save(ctx, 'booking', id, { name: 'Maria', phone: '123' });
    expect((await service.list(ctx, 'booking')).participants).toHaveLength(1);
    await service.save(ctx, 'booking', id, { name: 'Maria Silva' });
    expect(
      (await service.list(ctx, 'booking')).participants[0],
    ).not.toHaveProperty('phone');
    await service.remove(ctx, 'booking', id);
    await service.remove(ctx, 'booking', id);
    const records = await repo.query('RESERVATION_PARTICIPANTS#one#booking');
    expect(records[0]).toMatchObject({
      name: 'Maria Silva',
      status: 'REMOVED',
      createdByActorType: 'CUSTOMER',
    });
    expect(records[0]?.removedAt).toBeTruthy();
  });

  it('links exact contacts internally, ignores stale/foreign lookups and exposes identical editable shapes', async () => {
    const { repo, service } = await setup();
    await repo.put({
      PK: 'ORG#one',
      SK: 'CUSTOMER#maria',
      organizationId: 'one',
      customerId: 'maria',
      email: 'maria@example.test',
      phone: '123',
    });
    await repo.put({
      PK: 'CUSTOMER_ACCOUNT_EMAIL#one#maria@example.test',
      SK: 'META',
      organizationId: 'one',
      customerId: 'maria',
    });
    await repo.put({
      PK: 'CUSTOMER_IDENTITY_PHONE#one#123',
      SK: 'META',
      organizationId: 'one',
      customerId: 'maria',
    });
    const id = randomUUID();
    const linked = await service.save(ctx, 'booking', id, {
      name: 'Guest',
      email: 'MARIA@example.test',
    });
    const unresolved = await service.save(ctx, 'booking', randomUUID(), {
      name: 'Guest',
      email: 'nobody@example.test',
    });
    expect(Object.keys(linked)).toEqual(Object.keys(unresolved));
    expect(JSON.stringify(await service.list(ctx, 'booking'))).not.toContain(
      'customerId',
    );
    expect(
      (await repo.query('RESERVATION_PARTICIPANTS#one#booking')).find(
        (r) => r.participantId === id,
      )?.customerId,
    ).toBe('maria');
    await service.save(ctx, 'booking', id, { name: 'Edited', phone: '123' });
    await repo.put({
      PK: 'ORG#one',
      SK: 'CUSTOMER#maria',
      organizationId: 'one',
      customerId: 'maria',
      phone: '456',
    });
    await service.save(ctx, 'booking', id, { name: 'Edited', phone: '123' });
    expect(
      (await repo.query('RESERVATION_PARTICIPANTS#one#booking')).find(
        (r) => r.participantId === id,
      ),
    ).not.toHaveProperty('customerId');
    await repo.put({
      PK: 'CUSTOMER_ACCOUNT_EMAIL#one#foreign@example.test',
      SK: 'META',
      organizationId: 'two',
      customerId: 'maria',
    });
    await service.save(ctx, 'booking', id, {
      name: 'Guest',
      email: 'foreign@example.test',
    });
    expect(
      (await repo.query('RESERVATION_PARTICIPANTS#one#booking')).find(
        (r) => r.participantId === id,
      ),
    ).not.toHaveProperty('customerId');
  });

  it.each(['CANCELLED', 'COMPLETED', 'NO_SHOW', 'CHECKED_IN'])(
    'preserves history and blocks mutation in %s',
    async (status) => {
      const { repo, reservation, service } = await setup();
      const id = randomUUID();
      await service.save(ctx, 'booking', id, { name: 'Maria' });
      await repo.put({ ...reservation, status });
      expect(await service.list(ctx, 'booking')).toMatchObject({
        mutable: false,
        participants: [{ name: 'Maria' }],
      });
      await expect(
        service.save(ctx, 'booking', id, { name: 'Changed' }),
      ).rejects.toMatchObject({ code: 'INVALID_STATE' });
      await expect(service.remove(ctx, 'booking', id)).rejects.toMatchObject({
        code: 'INVALID_STATE',
      });
    },
  );

  it('blocks started bookings and other owners/organizations on every operation', async () => {
    const { repo, reservation, service } = await setup();
    const id = randomUUID();
    await service.save(ctx, 'booking', id, { name: 'Maria' });
    for (const foreign of [
      { ...ctx, organizationId: 'two' },
      { ...ctx, customerId: 'other' },
    ]) {
      await expect(service.list(foreign, 'booking')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(
        service.save(foreign, 'booking', id, { name: 'X' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        service.remove(foreign, 'booking', id),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    await repo.put({ ...reservation, startAt: '2000-01-01T00:00:00Z' });
    await expect(
      service.save(ctx, 'booking', id, { name: 'X' }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('rejects a write racing cancellation atomically', async () => {
    const { repo, reservation, service } = await setup();
    const original = repo.transactWrite.bind(repo);
    vi.spyOn(repo, 'transactWrite').mockImplementationOnce(async (writes) => {
      await repo.put({ ...reservation, status: 'CANCELLED' });
      return original(writes);
    });
    await expect(
      service.save(ctx, 'booking', randomUUID(), { name: 'Maria' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await service.list(ctx, 'booking')).participants).toEqual([]);
  });

  it('paginates durable records and rejects directory identifiers and blank names', async () => {
    const { service } = await setup();
    for (let i = 0; i < 52; i++)
      await service.save(ctx, 'booking', randomUUID(), { name: `Guest ${i}` });
    const first = await service.list(ctx, 'booking');
    const second = await service.list(ctx, 'booking', first.nextCursor!);
    expect(first.participants).toHaveLength(50);
    expect(second.participants).toHaveLength(2);
    expect(
      new Set(
        [...first.participants, ...second.participants].map(
          (p) => p.participantId,
        ),
      ).size,
    ).toBe(52);
    expect(
      ReservationParticipantInputSchema.safeParse({ name: ' ' }).success,
    ).toBe(false);
    expect(
      ReservationParticipantInputSchema.safeParse({
        name: 'Maria',
        customerId: 'arbitrary',
      }).success,
    ).toBe(false);
  });
});
