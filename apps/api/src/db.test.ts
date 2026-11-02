import { describe, expect, it } from 'vitest';
import { MemoryRepository, type Write } from './db.js';

const item = (SK: string) => ({ PK: 'ORG#o', SK, entity: 'customer' }) as never;

describe('MemoryRepository.transactWrite duplicate guard', () => {
  it.each<[string, Write[]]>([
    [
      'two puts',
      [
        { type: 'put', item: item('A') },
        { type: 'put', item: item('A') },
      ],
    ],
    [
      'put and delete',
      [
        { type: 'put', item: item('A') },
        { type: 'delete', key: { PK: 'ORG#o', SK: 'A' } },
      ],
    ],
    [
      'check and put',
      [
        { type: 'check', key: { PK: 'ORG#o', SK: 'A' }, expected: {} },
        { type: 'put', item: item('A') },
      ],
    ],
  ])('rejects %s on the same key', async (_name, writes) => {
    const repo = new MemoryRepository();
    await expect(repo.transactWrite(writes)).rejects.toThrow(
      /multiple operations on one item/,
    );
  });

  it('accepts distinct keys', async () => {
    const repo = new MemoryRepository();
    await repo.transactWrite([
      { type: 'put', item: item('A') },
      { type: 'put', item: item('B') },
    ]);
    expect(await repo.get({ PK: 'ORG#o', SK: 'B' })).toBeTruthy();
  });

  it('reports the 100 actions message only for oversized transactions', async () => {
    const repo = new MemoryRepository();
    const big: Write[] = Array.from({ length: 101 }, (_, i) => ({
      type: 'put',
      item: item(`K${i}`),
    }));
    await expect(repo.transactWrite(big)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('100 actions'),
    });
    const dup = repo.transactWrite([
      { type: 'put', item: item('A') },
      { type: 'put', item: item('A') },
    ]);
    await expect(dup).rejects.toThrow(/multiple operations/);
    await expect(dup).rejects.not.toThrow(/100 actions/);
  });
});
