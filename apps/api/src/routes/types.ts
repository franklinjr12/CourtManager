import type {
  AuthContext,
  CustomerAuthContext,
} from '@court-manager/contracts';
import type { Context } from 'hono';

export type AppVariables = {
  auth: AuthContext;
  customerAuth: CustomerAuthContext;
  requestId: string;
};

export type AppContext = Context<{ Variables: AppVariables }>;
