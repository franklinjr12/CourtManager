import type { Context } from 'hono';
import type { Repository } from './db.js';
import { AppError } from './errors.js';
import { hashToken } from './security.js';

export type RateLimitRule = {
  name: string;
  limit: number;
  windowSeconds: number;
};

const rule = (name: string, limit: number, windowSeconds: number) => ({
  name,
  limit,
  windowSeconds,
});

export const RATE_LIMIT_RULES = {
  staffLoginFailuresPerIp: rule('staff-login-ip', 30, 900),
  staffLoginFailuresPerAccount: rule('staff-login-account', 5, 900),
  customerLoginFailuresPerIp: rule('customer-login-ip', 30, 900),
  customerLoginFailuresPerAccount: rule('customer-login-account', 5, 900),
  registrationPerIp: rule('registration-ip', 20, 3600),
  registrationPerVenue: rule('registration-venue', 200, 3600),
  passwordSetPerIp: rule('password-set-ip', 20, 900),
  passwordSetPerVenue: rule('password-set-venue', 200, 900),
  publicRequestPerIp: rule('public-request-ip', 20, 600),
  publicRequestPerVenue: rule('public-request-venue', 300, 3600),
} as const satisfies Record<string, RateLimitRule>;

export const clientAddress = (c: Context): string => {
  const env = c.env as
    { requestContext?: { http?: { sourceIp?: string } } } | undefined;
  const lambdaIp = env?.requestContext?.http?.sourceIp;
  if (lambdaIp) return lambdaIp;
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || 'local';
};

export const createRateLimiter = (
  repo: Repository,
  now: () => number = Date.now,
) => {
  const window = (r: RateLimitRule, subject: string) => {
    const windowStart =
      Math.floor(now() / 1000 / r.windowSeconds) * r.windowSeconds;
    return {
      key: {
        PK: `RATE#${r.name}#${hashToken(subject)}`,
        SK: `WINDOW#${windowStart}`,
      },
      expiresAt: windowStart + r.windowSeconds + 60,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil(windowStart + r.windowSeconds - now() / 1000),
      ),
    };
  };
  const limited = (retryAfterSeconds: number) =>
    new AppError('RATE_LIMITED', 'Too many attempts. Please try again later.', {
      retryAfterSeconds,
    });
  return {
    async check(r: RateLimitRule, subject: string) {
      const w = window(r, subject);
      const item = await repo.get(w.key);
      if (Number(item?.count ?? 0) >= r.limit)
        throw limited(w.retryAfterSeconds);
    },
    async hit(r: RateLimitRule, subject: string) {
      const w = window(r, subject);
      if ((await repo.increment(w.key, 'count', w.expiresAt)) > r.limit)
        throw limited(w.retryAfterSeconds);
    },
    async reset(r: RateLimitRule, subject: string) {
      await repo.delete(window(r, subject).key);
    },
  };
};
