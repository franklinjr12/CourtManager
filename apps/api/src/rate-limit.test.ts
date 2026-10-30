import { describe, expect, it } from 'vitest';
import { MemoryRepository } from './db.js';
import { AppError } from './errors.js';
import {
  createRateLimiter,
  guardLogin,
  type RateLimitRule,
} from './rate-limit.js';

const rule: RateLimitRule = { name: 'test', limit: 3, windowSeconds: 60 };
const setup = () => {
  const repo = new MemoryRepository();
  const clock = { ms: 1_000_000_000 };
  return { repo, clock, limiter: createRateLimiter(repo, () => clock.ms) };
};

describe('rate limiter', () => {
  it('allows up to the limit then rejects with RATE_LIMITED', async () => {
    const { limiter } = setup();
    for (let i = 0; i < 3; i++) await limiter.hit(rule, 'a');
    const error = await limiter.hit(rule, 'a').catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.status).toBe(429);
    expect(error.details.retryAfterSeconds).toBeGreaterThan(0);
  });
  it('check throws once the limit is reached', async () => {
    const { limiter } = setup();
    for (let i = 0; i < 2; i++) await limiter.hit(rule, 'a');
    await limiter.check(rule, 'a');
    await limiter.hit(rule, 'a');
    await expect(limiter.check(rule, 'a')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });
  it('allows again after the window passes', async () => {
    const { limiter, clock } = setup();
    for (let i = 0; i < 4; i++) await limiter.hit(rule, 'a').catch(() => {});
    clock.ms += 61_000;
    await limiter.check(rule, 'a');
    await limiter.hit(rule, 'a');
  });
  it('isolates subjects and rules', async () => {
    const { limiter } = setup();
    for (let i = 0; i < 3; i++) await limiter.hit(rule, 'a');
    await limiter.hit(rule, 'b');
    await limiter.hit({ ...rule, name: 'other' }, 'a');
  });
  it('reset clears the counter', async () => {
    const { limiter } = setup();
    for (let i = 0; i < 3; i++) await limiter.hit(rule, 'a');
    await limiter.reset(rule, 'a');
    await limiter.check(rule, 'a');
    await limiter.hit(rule, 'a');
  });
  it('does not store the raw subject', async () => {
    const { limiter, repo } = setup();
    await limiter.hit(rule, 'person@example.com');
    const items = await repo.scan();
    expect(items).toHaveLength(1);
    expect(items[0]?.PK).not.toContain('person@example.com');
    expect(items[0]?.PK.startsWith('RATE#test#')).toBe(true);
  });
});

describe('guardLogin', () => {
  const rules = {
    perIp: { name: 'g-ip', limit: 3, windowSeconds: 60 },
    perAccount: { name: 'g-acct', limit: 2, windowSeconds: 60 },
  };
  const subjects = { ip: '1.1.1.1', account: 'a' };
  const fail = () => Promise.reject(new AppError('UNAUTHORIZED', 'no'));
  it('counts only UNAUTHORIZED failures and resets on success', async () => {
    const repo = new MemoryRepository();
    const limiter = createRateLimiter(repo, () => 0);
    await expect(
      guardLogin(limiter, rules, subjects, () =>
        Promise.reject(new AppError('NOT_FOUND', 'x')),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      guardLogin(limiter, rules, subjects, fail),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(
      guardLogin(limiter, rules, subjects, () => Promise.resolve('ok')),
    ).resolves.toBe('ok');
    await expect(
      guardLogin(limiter, rules, subjects, fail),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(
      guardLogin(limiter, rules, subjects, fail),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(
      guardLogin(limiter, rules, subjects, () => Promise.resolve('ok')),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
