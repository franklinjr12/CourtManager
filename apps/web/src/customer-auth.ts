import { ApiClient } from './api.js';
import type { Customer } from './core/types.js';

export type CustomerWebSession = {
  token: string;
  organizationId: string;
  customerId: string;
  customerAccountId: string;
  customer: Customer;
};

export const CUSTOMER_SESSION_STORAGE_KEY = 'court-manager-customer-session';

export const getCustomerSession = () =>
  JSON.parse(
    localStorage.getItem(CUSTOMER_SESSION_STORAGE_KEY) ?? 'null',
  ) as CustomerWebSession | null;

export const setCustomerSession = (session: CustomerWebSession | null) => {
  if (session)
    localStorage.setItem(CUSTOMER_SESSION_STORAGE_KEY, JSON.stringify(session));
  else clearCustomerSession();
};

export const clearCustomerSession = () =>
  localStorage.removeItem(CUSTOMER_SESSION_STORAGE_KEY);

const customerApi = new ApiClient(
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787',
  () => getCustomerSession()?.token,
  clearCustomerSession,
);

export const customerRequest = <T>(path: string, init: RequestInit = {}) =>
  customerApi.request<T>(path, init);
