import { describe, expect, it } from 'vitest';
import { dynamo, ensureTable } from '../db.js';
process.env.DYNAMODB_ENDPOINT = 'http://localhost:8120';
process.env.DYNAMODB_TABLE = 'court-manager-integration';
process.env.AWS_REGION = 'us-east-1';
describe('DynamoDB Local repository contract', () => {
  it('writes, queries, preserves TTL and enforces conditional transactions', async () => {
    await ensureTable();
    const repo = dynamo(),
      id = `${Date.now()}`;
    await repo.put({
      PK: `ORG#${id}`,
      SK: 'META',
      expiresAt: 123,
      entity: 'organization',
    });
    await repo.put({ PK: `ORG#${id}`, SK: 'COURT#1', entity: 'court' });
    expect((await repo.get({ PK: `ORG#${id}`, SK: 'META' }))?.expiresAt).toBe(
      123,
    );
    expect(
      await repo.query(`ORG#${id}`, { beginsWith: 'COURT#' }),
    ).toHaveLength(1);
    const lock = { PK: `SCHEDULE#${id}`, SK: 'LOCK#18:00' };
    await expect(
      Promise.all([
        repo.transactWrite([
          { type: 'put', item: lock, condition: 'attribute_not_exists(PK)' },
        ]),
        repo.transactWrite([
          { type: 'put', item: lock, condition: 'attribute_not_exists(PK)' },
        ]),
      ]),
    ).rejects.toThrow();
  });
});
