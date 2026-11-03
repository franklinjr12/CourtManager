import { describe, expect, it } from 'vitest';
import { MemoryRepository, queryCursor, type Write } from './db.js';

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

describe('MemoryRepository.query startAfter cursor', () => {
  async function seeded() {
    const repo = new MemoryRepository();
    for (const sk of ['A#1', 'R#01', 'R#02', 'R#03', 'R#04', 'Z#1'])
      await repo.put({ PK: 'P', SK: sk });
    await repo.put({ PK: 'OTHER', SK: 'R#05' });
    return repo;
  }
  const sks = (rows: { SK: string }[]) => rows.map((row) => row.SK);

  it('returns only items after the exclusive cursor in SK order', async () => {
    const repo = await seeded();
    expect(sks(await repo.query('P', { startAfter: 'R#02' }))).toEqual([
      'R#03',
      'R#04',
      'Z#1',
    ]);
    // A cursor that is not an existing SK still works as a bound.
    expect(sks(await repo.query('P', { startAfter: 'R#025' }))).toEqual([
      'R#03',
      'R#04',
      'Z#1',
    ]);
  });

  it('combines with beginsWith, between and limit for paging', async () => {
    const repo = await seeded();
    const first = await repo.query('P', { beginsWith: 'R#', limit: 2 });
    expect(sks(first)).toEqual(['R#01', 'R#02']);
    const second = await repo.query('P', {
      beginsWith: 'R#',
      limit: 2,
      startAfter: first.at(-1)!.SK,
    });
    expect(sks(second)).toEqual(['R#03', 'R#04']);
    expect(
      await repo.query('P', { beginsWith: 'R#', startAfter: 'R#04' }),
    ).toEqual([]);
    expect(
      sks(
        await repo.query('P', {
          between: ['R#01', 'R#04'],
          startAfter: 'R#01',
          limit: 2,
        }),
      ),
    ).toEqual(['R#02', 'R#03']);
    expect(
      sks(
        await repo.query('P', { between: ['R#02', 'R#03'], startAfter: 'A' }),
      ),
    ).toEqual(['R#02', 'R#03']);
    expect(
      await repo.query('P', { between: ['R#01', 'R#03'], startAfter: 'R#03' }),
    ).toEqual([]);
  });

  it('matches the DynamoDB cursor clamp for out-of-range cursors', () => {
    expect(queryCursor({ beginsWith: 'R#', startAfter: 'A' })).toBeUndefined();
    expect(queryCursor({ beginsWith: 'R#', startAfter: 'Z' })).toBe('EMPTY');
    expect(queryCursor({ beginsWith: 'R#', startAfter: 'R#02' })).toBe('R#02');
    expect(queryCursor({ between: ['B', 'D'], startAfter: 'A' })).toBe(
      undefined,
    );
    expect(queryCursor({ between: ['B', 'D'], startAfter: 'D' })).toBe('EMPTY');
    expect(queryCursor({ between: ['B', 'D'], startAfter: 'C' })).toBe('C');
  });
});
