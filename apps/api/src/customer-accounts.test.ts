import type { AuthContext } from '@court-manager/contracts';
import { describe, expect, it } from 'vitest';
import { MemoryRepository } from './db.js';
import { AppError } from './errors.js';
import { buildServices } from './services/index.js';

const staff: AuthContext = {
  organizationId: 'org-1',
  userId: 'staff-1',
  role: 'STAFF',
};
const organization = (organizationId: string, slug: string) => ({
  PK: `ORG#${organizationId}`,
  SK: 'META',
  entity: 'organization' as const,
  organizationId,
  slug,
  name: slug,
  timezone: 'UTC',
  currency: 'BRL',
  active: true,
  features: { classes: false, finance: false },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
const tokenFrom = (link: string) =>
  new URL(`https://court.test${link}`).searchParams.get('token')!;

async function setup() {
  const repo = new MemoryRepository();
  await repo.put(organization('org-1', 'arena-one'));
  await repo.put(organization('org-2', 'arena-two'));
  return { repo, services: buildServices(repo) };
}

describe('customer account service', () => {
  it('registers one new customer and account, normalizing identity', async () => {
    const { repo, services } = await setup();
    const result = await services.customerAccounts.register('arena-one', {
      name: 'Ana',
      email: ' ANA@Example.Test ',
      phone: '(41) 99999-1234',
      password: 'secret',
    });
    expect(result.customer).toMatchObject({
      normalizedEmail: 'ana@example.test',
      normalizedPhone: '41999991234',
    });
    expect(result.account).not.toHaveProperty('passwordHash');
    expect(
      await repo.query('ORG#org-1', { beginsWith: 'CUSTOMER#' }),
    ).toHaveLength(1);
    expect(
      await repo.query('ORG#org-1', { beginsWith: 'CUSTOMER_ACCOUNT#' }),
    ).toHaveLength(1);
  });

  it('rejects duplicate account and existing customer identity claims', async () => {
    const { services } = await setup();
    await services.customerAccounts.register('arena-one', {
      name: 'Ana',
      email: 'ana@example.test',
      phone: '41999991234',
      password: 'secret',
    });
    await expect(
      services.customerAccounts.register('arena-one', {
        name: 'Ana 2',
        email: 'ANA@example.test',
        phone: '41999990000',
        password: 'secret',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const customer = await services.customers.create(
      { ...staff, role: 'OWNER' },
      {
        name: 'Existing',
        email: 'existing@example.test',
        phone: '41999990001',
      },
    );
    expect(customer.customerId).toBeTruthy();
    await expect(
      services.customerAccounts.register('arena-one', {
        name: 'Imposter',
        email: 'existing@example.test',
        phone: '41999990002',
        password: 'secret',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('activates existing customer once and scopes token to venue', async () => {
    const { services } = await setup();
    const customer = await services.customers.create(
      { ...staff, role: 'OWNER' },
      {
        name: 'Existing',
        email: 'existing@example.test',
        phone: '41999990001',
      },
    );
    const activation = await services.customerAccounts.enable(
      staff,
      String(customer.customerId),
    );
    const token = tokenFrom(activation.link);
    await expect(
      services.customerAccounts.setPassword(
        'arena-two',
        { token, password: 'new-secret' },
        'ACTIVATION',
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(
      services.customerAccounts.setPassword(
        'arena-one',
        { token, password: 'new-secret' },
        'ACTIVATION',
      ),
    ).resolves.toMatchObject({ activated: true });
    await expect(
      services.customerAccounts.setPassword(
        'arena-one',
        { token, password: 'again' },
        'ACTIVATION',
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('expires activation tokens and generates reset links only for accounts', async () => {
    const { repo, services } = await setup();
    const customer = await services.customers.create(
      { ...staff, role: 'OWNER' },
      {
        name: 'Existing',
        email: 'existing@example.test',
        phone: '41999990001',
      },
    );
    const activation = await services.customerAccounts.enable(
      staff,
      String(customer.customerId),
    );
    const token = tokenFrom(activation.link);
    const tokenRecord = (
      await repo.query('ORG#org-1', { beginsWith: 'CUSTOMER_ACCOUNT_TOKEN#' })
    )[0]!;
    await repo.put({ ...tokenRecord, expiresAt: 1 });
    await expect(
      services.customerAccounts.setPassword(
        'arena-one',
        { token, password: 'new-secret' },
        'ACTIVATION',
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(
      services.customerAccounts.reset(staff, String(customer.customerId)),
    ).resolves.toMatchObject({
      link: expect.stringContaining('/reset-password?token='),
    });
    await expect(
      services.customerAccounts.reset(staff, 'unknown'),
    ).rejects.toBeInstanceOf(AppError);
  });
});
