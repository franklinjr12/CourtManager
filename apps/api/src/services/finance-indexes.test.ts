import { expect, it } from 'vitest';
import { MemoryRepository } from '../db.js';
import { operationalKeys } from '../persistence/operational-keys.js';
import { buildServices } from './index.js';

const owner = { organizationId: 'org1', userId: 'o', role: 'OWNER' as const };

const seed = async (repo: MemoryRepository) => {
  await repo.put({
    PK: 'ORG#org1',
    SK: 'CUSTOMER#cu',
    entity: 'customer',
    organizationId: 'org1',
    customerId: 'cu',
    name: 'Davi',
  });
  await repo.put({
    PK: 'RESERVATION#re',
    SK: 'META',
    entity: 'reservation',
    organizationId: 'org1',
    reservationId: 're',
    courtId: 'co',
    customerId: 'cu',
    startAt: '2026-10-05T13:00:00.000Z',
    endAt: '2026-10-05T14:00:00.000Z',
  });
};

it('writes and deletes the organization payment index with the payment', async () => {
  const repo = new MemoryRepository();
  await seed(repo);
  const services = buildServices(repo);
  const payment = (await services.payments.create(owner, {
    customerId: 'cu',
    reservationId: 're',
    amount: 30,
    paidAt: '2026-10-05T15:00:00.000Z',
  })) as { paymentId: string };

  const partition = operationalKeys.organizationPayments('org1');
  const rows = await repo.query(partition.PK, { beginsWith: partition.SK });
  expect(rows).toMatchObject([
    {
      SK: `PAYMENT#2026-10-05T15:00:00.000Z#${payment.paymentId}`,
      entity: 'organizationPaymentIndex',
      organizationId: 'org1',
      amount: 30,
    },
  ]);

  await services.payments.remove(owner, payment.paymentId);
  expect(await repo.query(partition.PK, { beginsWith: partition.SK })).toEqual(
    [],
  );
});

it('writes and deletes the organization expense index with the expense', async () => {
  const repo = new MemoryRepository();
  const services = buildServices(repo);
  const expense = (await services.expenses.create(owner, {
    description: 'Redes',
    amount: 90,
    date: '2026-10-04',
  })) as { expenseId: string };

  const partition = operationalKeys.organizationExpenses('org1');
  expect(
    await repo.query(partition.PK, { beginsWith: partition.SK }),
  ).toMatchObject([
    {
      SK: `EXPENSE#2026-10-04#${expense.expenseId}`,
      entity: 'organizationExpenseIndex',
      amount: 90,
    },
  ]);

  await services.expenses.remove(owner, expense.expenseId);
  expect(await repo.query(partition.PK, { beginsWith: partition.SK })).toEqual(
    [],
  );
  expect(await services.expenses.list(owner)).toEqual([]);
});
