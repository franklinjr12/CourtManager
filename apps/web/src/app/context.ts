import { ApiClient } from '../api.js';
import { clearSession, getSession, setSession } from '../auth.js';
import { timezoneFor } from '../core/dates.js';
import type { Session } from '../core/types.js';
import { Router } from '../router.js';

export type AppContext = {
  app: HTMLDivElement;
  api: ApiClient;
  router: Router;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  getSession: () => Session | null;
  setSession: (session: Session | null) => void;
  clearSession: () => void;
  timezone: () => string;
  navigate: (path: string) => void;
  renderRoute: () => Promise<void>;
  setRenderRoute: (renderRoute: () => Promise<void>) => void;
  screen: () => HTMLElement | null;
};

let current: AppContext | null = null;

export const createAppContext = (app: HTMLDivElement): AppContext => {
  let renderRoute = async () => {};
  const router = new Router();
  const context = {} as AppContext;
  const api = new ApiClient(
    import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787',
    () => getSession()?.token,
    () => {
      clearSession();
      context.navigate('/login');
    },
  );
  Object.assign(context, {
    app,
    api,
    router,
    request: <T>(path: string, init: RequestInit = {}) => api.request<T>(path, init),
    getSession,
    setSession,
    clearSession,
    timezone: () => timezoneFor(getSession()),
    navigate: (path: string) => {
      router.navigate(path);
      void renderRoute();
    },
    renderRoute: () => renderRoute(),
    setRenderRoute: (next: () => Promise<void>) => {
      renderRoute = next;
    },
    screen: () => app.querySelector<HTMLElement>('#screen'),
  });
  current = context;
  return context;
};

export const getAppContext = () => {
  if (!current) throw new Error('App context has not been initialized');
  return current;
};
