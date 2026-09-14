import { randomUUID } from 'node:crypto';
import type { CustomerAuthContext } from '@court-manager/contracts';
import type { Repository } from '../db.js';
import { buildServices } from '../services/index.js';

export async function classFixture(repo: Repository, capacity = 1) {
  const organizationId = randomUUID();
  const slug = `classes-${organizationId}`;
  const owner = { organizationId, userId: 'owner', role: 'OWNER' as const };
  const services = buildServices(repo);
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: 'META',
    entity: 'organization',
    organizationId,
    name: 'Class Arena',
    slug,
    timezone: 'America/Sao_Paulo',
    currency: 'BRL',
    active: true,
    features: { classes: true, finance: true },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await repo.put({
    PK: `ORG#${organizationId}`,
    SK: 'USER#coach',
    entity: 'user',
    organizationId,
    userId: 'coach',
    role: 'COACH',
    name: 'Coach Maria',
    email: 'private-coach@example.test',
    passwordHash: 'private-hash',
    active: true,
  });
  const court = await services.courts.create(owner, {
    name: 'Discovery Court',
    sport: 'Tennis',
    slotMinutes: 30,
    defaultHourlyPrice: 80,
    active: true,
    openingHours: Object.fromEntries(
      [
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
        'SATURDAY',
        'SUNDAY',
      ].map((day) => [day, { open: '07:00', close: '23:00' }]),
    ),
  });
  const cls = await services.classes.create(owner, {
    name: 'Customer Tennis',
    sport: 'Tennis',
    coachId: 'coach',
    courtId: court.courtId,
    capacity,
    pricePerParticipant: 40,
    scheduleType: 'SINGLE',
    startDate: '2099-01-05',
    startTime: '10:00',
    durationMinutes: 60,
    notes: 'Private management note',
  });
  const customer = await services.customerAccounts.register(slug, {
    name: 'Ana',
    email: 'ana@example.test',
    phone: '41999990001',
    password: 'class-password',
  });
  const customer2 = await services.customerAccounts.register(slug, {
    name: 'Bea',
    email: 'bea@example.test',
    phone: '41999990002',
    password: 'class-password',
  });
  const ctx: CustomerAuthContext = {
    actorType: 'CUSTOMER',
    organizationId,
    customerId: String(customer.customer.customerId),
    customerAccountId: customer.account.customerAccountId,
  };
  const ctx2: CustomerAuthContext = {
    ...ctx,
    customerId: String(customer2.customer.customerId),
    customerAccountId: customer2.account.customerAccountId,
  };
  return { services, owner, ctx, ctx2, classId: String(cls.classId), slug };
}
