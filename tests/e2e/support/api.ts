import type { Page } from '@playwright/test';

export const apiBase = 'http://localhost:8787';

async function sessionFetch(
  page: Page,
  storageKey: string,
  path: string,
  init: RequestInit = {},
) {
  return page.evaluate(
    async ({ apiBase, storageKey, path, init }) => {
      const current = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
      const response = await fetch(`${apiBase}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${current?.token ?? ''}`,
          ...(init.headers ?? {}),
        },
      });
      return {
        status: response.status,
        body: await response.json().catch(() => ({})),
      };
    },
    { apiBase, storageKey, path, init },
  );
}

export async function api(page: Page, path: string, init: RequestInit = {}) {
  return sessionFetch(page, 'court-manager-session', path, init);
}

export async function customerApi(
  page: Page,
  path: string,
  init: RequestInit = {},
) {
  return sessionFetch(page, 'court-manager-customer-session', path, init);
}
