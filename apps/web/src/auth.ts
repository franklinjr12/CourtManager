import type { Session } from './core/types.js';

export type WebSession = Session;
export const SESSION_STORAGE_KEY = 'court-manager-session';

export const getSession = () =>
  JSON.parse(
    localStorage.getItem(SESSION_STORAGE_KEY) ?? 'null',
  ) as WebSession | null;

export const setSession = (session: WebSession | null) => {
  if (session)
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  else clearSession();
};

export const clearSession = () => localStorage.removeItem(SESSION_STORAGE_KEY);
