export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: () => string | undefined,
    private readonly onUnauthorized: () => void = () => {},
  ) {}
  async request<T>(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(this.token() ? { Authorization: `Bearer ${this.token()}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    const payload = (await response.json()) as {
      data?: T;
      error?: { code: string; message: string };
    };
    if (response.status === 401) {
      this.onUnauthorized();
    }
    if (!response.ok)
      throw new ApiError(
        payload.error?.code ?? 'INTERNAL_ERROR',
        payload.error?.message ?? 'Request failed',
        response.status,
      );
    return payload.data as T;
  }
  get<T>(path: string, signal?: AbortSignal) {
    return this.request<T>(path, signal ? { signal } : {});
  }
  post<T>(path: string, data: unknown) {
    return this.request<T>(path, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
  patch<T>(path: string, data: unknown) {
    return this.request<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }
  delete<T>(path: string) {
    return this.request<T>(path, { method: 'DELETE' });
  }
}
