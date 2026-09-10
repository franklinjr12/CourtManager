import type { Page } from '@playwright/test';

export const apiBase = 'http://localhost:8787';

export async function api(page: Page, path: string, init: RequestInit = {}) {
  return page.evaluate(
    async ({ apiBase, path, init }) => {
      const current = JSON.parse(
        localStorage.getItem('court-manager-session') ?? 'null',
      );
      const response = await fetch(`${apiBase}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${current.token}`,
          ...(init.headers ?? {}),
        },
      });
      return {
        status: response.status,
        body: await response.json().catch(() => ({})),
      };
    },
    { apiBase, path, init },
  );
}
