import { getAppContext } from '../app/context.js';
import { escapeHtml } from '../dom.js';

export const app = new Proxy({} as HTMLDivElement, {
  get: (_target, property: keyof HTMLDivElement) => {
    const value = getAppContext().app[property];
    return typeof value === 'function'
      ? value.bind(getAppContext().app)
      : value;
  },
  set: (_target, property: keyof HTMLDivElement, value: unknown) => {
    (getAppContext().app[property] as unknown) = value;
    return true;
  },
});
export const escapeText = escapeHtml;
export const request = <T>(path: string, init: RequestInit = {}) =>
  getAppContext().request<T>(path, init);
export const session = () => getAppContext().getSession();
export const setSession = (
  session: Parameters<ReturnType<typeof getAppContext>['setSession']>[0],
) => getAppContext().setSession(session);
export const timezone = () => getAppContext().timezone();
export const navigate = (path: string) => getAppContext().navigate(path);
export const renderRoute = () => getAppContext().renderRoute();
export const screen = () => getAppContext().screen();
