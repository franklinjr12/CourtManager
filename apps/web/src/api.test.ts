import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from './api.js';

describe('ApiClient', () => {
  it('serializes JSON requests and applies the session token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const api = new ApiClient('https://api.example', () => 'token');

    await expect(api.post('/example', { value: 1 })).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example/example',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ value: 1 }),
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('invokes unauthorized handling and exposes structured API errors', async () => {
    const onUnauthorized = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: 'EXPIRED', message: 'Expired' } }),
          {
            status: 401,
          },
        ),
      ),
    );
    const api = new ApiClient(
      'https://api.example',
      () => undefined,
      onUnauthorized,
    );

    await expect(api.get('/private')).rejects.toMatchObject({
      code: 'EXPIRED',
      status: 401,
      message: 'Expired',
    } satisfies Partial<ApiError>);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});
