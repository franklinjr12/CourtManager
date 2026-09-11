import { errorMessage } from '../core/presentation.js';
import { t } from '../i18n.js';
import { classDetail, classSession } from '../screens/class-operations.js';
import { classes } from '../screens/classes.js';
import { customerProfile } from '../screens/customer-profile.js';
import { customers } from '../screens/customers.js';
import { dashboard } from '../screens/dashboard.js';
import { finance } from '../screens/finance.js';
import { login } from '../screens/login.js';
import { publicBooking } from '../screens/public-booking.js';
import { reports } from '../screens/reports.js';
import { requests } from '../screens/requests.js';
import { reservations } from '../screens/reservations.js';
import { escapeText } from '../screens/runtime.js';
import { schedule } from '../screens/schedule.js';
import { settings } from '../screens/settings.js';
import { staff } from '../screens/staff.js';
import { today } from '../screens/today.js';
import type { AppContext } from './context.js';

export const registerRoutes = (context: AppContext) => {
  context.router
    .add('/login', () => login())
    .add('/', () => today())
    .add('/today', () => today())
    .add('/dashboard', () => dashboard())
    .add('/schedule', () => schedule())
    .add('/settings', () => settings())
    .add('/customers', () => customers())
    .add('/customers/:id', (params) => customerProfile(params.id ?? ''))
    .add('/reservations', () => reservations())
    .add('/requests', () => requests())
    .add('/finance', () => finance())
    .add('/classes', () => classes())
    .add('/classes/:id', (params) => classDetail(params.id ?? ''))
    .add('/class-sessions/:id', (params) => classSession(params.id ?? ''))
    .add('/staff', () => staff())
    .add('/reports', () => reports())
    .add('/book/:slug', (params) => publicBooking(params.slug ?? ''));
};

export const createRenderer = (context: AppContext) => async () => {
  const path = location.pathname;
  if (path.startsWith('/book/')) {
    const match = context.router.match(path);
    await (match?.handler ?? (() => publicBooking('')))(
      match?.params ?? {},
      new URLSearchParams(location.search),
    );
    return;
  }
  if (path === '/login' || !context.getSession()) {
    await login();
    return;
  }
  try {
    const match = context.router.match(path);
    await (match?.handler ?? dashboard)(
      match?.params ?? {},
      new URLSearchParams(location.search),
    );
  } catch (error) {
    const target = context.screen();
    if (target) {
      target.innerHTML = `<article class="card error-state"><h2>${t('errors.couldNotLoad')}</h2><p>${escapeText(errorMessage(error))}</p><button class="button" onclick="location.reload()">${t('common.tryAgain')}</button></article>`;
    }
  }
};
