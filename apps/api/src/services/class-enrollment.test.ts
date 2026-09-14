import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { MemoryRepository } from '../db.js';
import { migrateClassDiscovery } from '../migrations/class-discovery.js';
import { classFixture } from '../testing/class-fixture.js';

describe('customer class discovery and shared enrollment', () => {
  it('projects active classes safely, charges self enrollment, preserves cancellation history and allows re-enrollment', async () => {
    const repo = new MemoryRepository();
    const { services, owner, ctx, classId } = await classFixture(repo);
    const scan = vi
      .spyOn(repo, 'scan')
      .mockRejectedValue(new Error('No request-time scans'));
    const [cls] = (await services.classes.customerClasses(ctx)).data;
    expect(cls).toMatchObject({
      name: 'Customer Tennis',
      sport: 'Tennis',
      coachName: 'Coach Maria',
      courtName: 'Discovery Court',
      pricePerParticipant: 40,
      enrolledCount: 0,
      capacity: 1,
      full: false,
      enrollment: null,
      timezone: 'America/Sao_Paulo',
    });
    expect(JSON.stringify(cls)).not.toMatch(
      /passwordHash|private-coach|Private management|coachId|customerId|organizationId/,
    );
    const enrolled = await services.classes.enrollSelf(ctx, classId);
    expect((await services.classes.customerClasses(ctx)).data[0]).toMatchObject(
      { full: true, enrolledCount: 1, enrollment: { status: 'ACTIVE' } },
    );
    const chargeKey = {
      PK: `CHARGE#class-${classId}-2099-01-05-${ctx.customerId}`,
      SK: 'META',
    };
    expect(await repo.get(chargeKey)).toMatchObject({
      status: 'ACTIVE',
      amount: 40,
      createdBy: ctx.customerAccountId,
    });
    await expect(
      services.classes.enrollSelf(ctx, classId),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await services.classes.leaveSelf(ctx, classId);
    expect(
      await repo.get({ PK: `ENROLLMENT#${enrolled.enrollmentId}`, SK: 'META' }),
    ).toMatchObject({
      status: 'CANCELLED',
      customerId: ctx.customerId,
      leftAt: expect.any(String),
    });
    expect(await repo.get(chargeKey)).toMatchObject({ status: 'VOID' });
    expect(
      (
        await services.customerActivities.list(ctx, {
          from: '2099-01-01T00:00:00.000Z',
          to: '2099-12-31T00:00:00.000Z',
          limit: 20,
        })
      ).data,
    ).toEqual([]);
    await services.classes.leaveSelf(ctx, classId);
    expect(
      (await services.classes.customerClasses(ctx)).data[0]?.enrolledCount,
    ).toBe(0);
    await services.classes.enrollSelf(ctx, classId);
    expect(await repo.get(chargeKey)).toMatchObject({ status: 'ACTIVE' });
    await services.classes.cancelEnrollment(
      owner,
      classId,
      enrolled.enrollmentId,
    );
    expect(await repo.get(chargeKey)).toMatchObject({ status: 'ACTIVE' });
    expect(scan).not.toHaveBeenCalled();
  });
  it('serializes last-place enrollment and keeps staff and coach authorization', async () => {
    const repo = new MemoryRepository();
    const { services, owner, ctx, ctx2, classId } = await classFixture(repo);
    const results = await Promise.allSettled([
      services.classes.enrollSelf(ctx, classId),
      services.classes.enroll(owner, classId, ctx2.customerId),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      (await services.classes.customerClasses(ctx)).data[0]?.enrolledCount,
    ).toBe(1);
    expect(
      (
        await services.classes.getDetail(
          { ...owner, role: 'COACH', userId: 'coach' },
          classId,
        )
      ).enrollments,
    ).toHaveLength(1);
    await expect(
      services.classes.enroll(
        { ...owner, role: 'COACH', userId: 'coach' },
        classId,
        ctx2.customerId,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      services.classes.getDetail(
        { ...owner, role: 'COACH', userId: 'other' },
        classId,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await services.classes.deactivate(owner, classId);
    expect((await services.classes.customerClasses(ctx)).data).toEqual([]);
    await expect(
      services.classes.enrollSelf(ctx2, classId),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
  it('enforces HTTP session ownership even with forged IDs, and hides cross-tenant classes', async () => {
    const repo = new MemoryRepository();
    const { services, ctx, ctx2, classId, slug } = await classFixture(repo);
    const app = createApp(repo);
    const login = await app.request('/customer-auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug,
        email: 'ana@example.test',
        password: 'class-password',
      }),
    });
    const token = (await login.json()).data.token;
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    expect(
      (
        await app.request(`/customer/classes/${classId}/enroll`, {
          method: 'POST',
        })
      ).status,
    ).toBe(401);
    const response = await app.request(`/customer/classes/${classId}/enroll`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        customerId: ctx2.customerId,
        organizationId: 'forged',
      }),
    });
    expect(response.status).toBe(201);
    expect((await response.json()).data.customerId).toBe(ctx.customerId);
    expect(
      (await services.classes.customerClasses(ctx2)).data[0]?.enrollment,
    ).toBeNull();
    await expect(
      services.classes.leaveSelf(ctx2, classId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      services.classes.enrollSelf(ctx2, classId),
    ).rejects.toMatchObject({ details: { action: 'JOIN_WAITLIST' } });
    const foreign = { ...ctx, organizationId: 'different-org' };
    expect((await services.classes.customerClasses(foreign)).data).toEqual([]);
    await expect(
      services.classes.enrollSelf(foreign, classId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      services.classes.leaveSelf(foreign, classId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      (
        await app.request(`/customer/classes/${classId}/leave`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ customerId: ctx2.customerId }),
        })
      ).status,
    ).toBe(200);
  });
  it('backfills legacy class access idempotently and pages without scanning', async () => {
    const repo = new MemoryRepository();
    const { services, ctx, classId } = await classFixture(repo);
    await services.classes.enrollSelf(ctx, classId);
    const key = { PK: `CLASS#${classId}`, SK: 'META' };
    const cls = (await repo.get(key))!;
    delete cls.enrolledCount;
    delete cls.sessionIds;
    await repo.put(cls);
    await migrateClassDiscovery(repo);
    const once = await repo.scan();
    await migrateClassDiscovery(repo);
    expect(await repo.scan()).toEqual(once);
    expect((await services.classes.customerClasses(ctx)).data[0]).toMatchObject(
      { enrolledCount: 1, enrollment: { status: 'ACTIVE' } },
    );
    for (let index = 0; index < 25; index++) {
      const id = `extra-${index}`;
      await repo.put({
        ...cls,
        PK: `CLASS#${id}`,
        classId: id,
        active: true,
        enrolledCount: 0,
      });
      await repo.put({
        PK: `ORG#${ctx.organizationId}#CLASSES`,
        SK: `CLASS#${id}`,
        classId: id,
      });
    }
    const first = await services.classes.customerClasses(ctx);
    const next = await services.classes.customerClasses(ctx, first.nextCursor!);
    expect(first.data.length + next.data.length).toBe(26);
    expect(
      new Set([...first.data, ...next.data].map((row) => row.classId)).size,
    ).toBe(26);
    await expect(
      services.classes.customerClasses(ctx, 'OTHER#org'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
  it('resumes interrupted materialization without a second enrollment or duplicate charges', async () => {
    const repo = new MemoryRepository();
    const { services, ctx, classId } = await classFixture(repo);
    const cls = (await repo.get({ PK: `CLASS#${classId}`, SK: 'META' }))!;
    const original = (await repo.get({
      PK: `CLASS_SESSION#${classId}-2099-01-05`,
      SK: 'META',
    }))!;
    const sessionIds: string[] = [];
    for (let index = 0; index < 52; index++) {
      const sessionId = `${classId}-retry-${index}`;
      sessionIds.push(sessionId);
      await repo.put({
        ...original,
        PK: `CLASS_SESSION#${sessionId}`,
        sessionId,
      });
    }
    await repo.put({ ...cls, sessionIds });
    const transact = repo.transactWrite.bind(repo);
    let failed = false;
    vi.spyOn(repo, 'transactWrite').mockImplementation(async (writes) => {
      if (!failed && writes[0]?.type === 'check') {
        failed = true;
        throw new Error('Simulated interruption');
      }
      return transact(writes);
    });
    await expect(services.classes.enrollSelf(ctx, classId)).rejects.toThrow(
      'Simulated interruption',
    );
    await services.classes.enrollSelf(ctx, classId);
    expect(await repo.scan((row) => row.entity === 'enrollment')).toHaveLength(
      1,
    );
    expect(
      await repo.scan(
        (row) => row.entity === 'charge' && row.status === 'ACTIVE',
      ),
    ).toHaveLength(52);
    expect(
      (await services.classes.customerClasses(ctx)).data[0]?.enrolledCount,
    ).toBe(1);
    await services.classes.leaveSelf(ctx, classId);
    expect(
      await repo.scan(
        (row) => row.entity === 'charge' && row.status === 'VOID',
      ),
    ).toHaveLength(52);
  });
});
