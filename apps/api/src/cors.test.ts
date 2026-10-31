import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { DEFAULT_DEV_ORIGINS, parseAllowedOrigins } from './cors-config.js';
import { MemoryRepository } from './db.js';

const allowed = 'https://app.example.com';
const evil = 'https://evil.example.com';
const header = 'access-control-allow-origin';

describe('parseAllowedOrigins', () => {
  it('trims, drops empty entries and trailing slashes', () => {
    expect(
      parseAllowedOrigins(' https://a.example.com/ ,, https://b.example.com '),
    ).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('falls back to dev origins when unset or empty', () => {
    expect(parseAllowedOrigins(undefined)).toEqual(DEFAULT_DEV_ORIGINS);
    expect(parseAllowedOrigins(' , ')).toEqual(DEFAULT_DEV_ORIGINS);
  });

  it('ignores the wildcard', () => {
    expect(parseAllowedOrigins('*,https://a.example.com')).toEqual([
      'https://a.example.com',
    ]);
    expect(parseAllowedOrigins('*')).toEqual(DEFAULT_DEV_ORIGINS);
  });
});

describe('API CORS', () => {
  afterEach(() => vi.unstubAllEnvs());

  const app = () =>
    createApp(new MemoryRepository(), { allowedOrigins: [allowed] });

  it('allows configured origins and rejects others', async () => {
    const ok = await app().request('/health', { headers: { Origin: allowed } });
    expect(ok.headers.get(header)).toBe(allowed);
    const bad = await app().request('/health', { headers: { Origin: evil } });
    expect(bad.headers.get(header)).toBeNull();
  });

  it('handles preflight per origin', async () => {
    const preflight = (origin: string) =>
      app().request('/health', {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
      });
    expect((await preflight(allowed)).headers.get(header)).toBe(allowed);
    expect((await preflight(evil)).headers.get(header)).toBeNull();
  });

  it('defaults to local dev origins', async () => {
    vi.stubEnv('CORS_ALLOWED_ORIGINS', '');
    const res = await createApp(new MemoryRepository()).request('/health', {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(res.headers.get(header)).toBe('http://localhost:5173');
  });
});
