import { errorMessage } from '../core/presentation.js';
import { t } from '../i18n.js';
import { classDetail, classSession } from '../screens/class-operations.js';
import { classes } from '../screens/classes.js';
import { commercialOverview } from '../screens/commercial-overview.js';
import {
  customerLogin,
  customerPortal,
  customerPortalPage,
} from '../screens/customer-portal.js';
import { customerProfile } from '../screens/customer-profile.js';
import { customers } from '../screens/customers.js';
import { dashboard } from '../screens/dashboard.js';
import { finance } from '../screens/finance.js';
import { fixedCourtAgreements } from '../screens/fixed-court-agreements.js';
import { login } from '../screens/login.js';
import { memberships } from '../screens/memberships.js';
import { packages } from '../screens/packages.js';
import { plans } from '../screens/plans.js';
import { publicBooking } from '../screens/public-booking.js';
import { reports } from '../screens/reports.js';
import { requests } from '../screens/requests.js';
import { reservations } from '../screens/reservations.js';
import { escapeText } from '../screens/runtime.js';
import { schedule } from '../screens/schedule.js';
import { settings } from '../screens/settings.js';
import { staff } from '../screens/staff.js';
import { today } from '../screens/today.js';
import { waitlists } from '../screens/waitlists.js';
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
    .add('/waitlists', () => waitlists())
    .add('/finance', () => finance())
    .add('/commercial', () => commercialOverview())
    .add('/commercial/plans', () => plans())
    .add('/commercial/packages', () => packages())
    .add('/commercial/memberships', () => memberships())
    .add('/commercial/fixed-courts', () => fixedCourtAgreements())
    .add('/plans', () => plans())
    .add('/classes', () => classes())
    .add('/classes/:id', (params) => classDetail(params.id ?? ''))
    .add('/class-sessions/:id', (params) => classSession(params.id ?? ''))
    .add('/staff', () => staff())
    .add('/reports', () => reports())
    .add('/book/:slug', (params) => publicBooking(params.slug ?? ''))
    .add('/portal/:slug/login', (params) => customerLogin(params.slug ?? ''))
    .add('/portal/:slug/register', (params) =>
      customerPortal(params.slug ?? '', 'register'),
    )
    .add('/portal/:slug/activate', (params) =>
      customerPortal(params.slug ?? '', 'activate'),
    )
    .add('/portal/:slug/reset-password', (params) =>
      customerPortal(params.slug ?? '', 'reset-password'),
    )
    .add('/portal/:slug', (params) =>
      customerPortalPage(params.slug ?? '', 'home'),
    )
    .add('/portal/:slug/book', (params) =>
      customerPortalPage(params.slug ?? '', 'book'),
    )
    .add('/portal/:slug/reservations', (params) =>
      customerPortalPage(params.slug ?? '', 'reservations'),
    )
    .add('/portal/:slug/reservations/:id', (params) =>
      customerPortalPage(params.slug ?? '', 'reservations'),
    )
    .add('/portal/:slug/classes', (params) =>
      customerPortalPage(params.slug ?? '', 'classes'),
    )
    .add('/portal/:slug/waitlists', (params) =>
      customerPortalPage(params.slug ?? '', 'waitlists'),
    )
    .add('/portal/:slug/memberships/:id', (params) =>
      customerPortalPage(
        params.slug ?? '',
        'membership-detail',
        params.id ?? '',
      ),
    )
    .add('/portal/:slug/memberships', (params) =>
      customerPortalPage(params.slug ?? '', 'memberships'),
    )
    .add('/portal/:slug/packages/:id', (params) =>
      customerPortalPage(params.slug ?? '', 'package-detail', params.id ?? ''),
    )
    .add('/portal/:slug/credits', (params) =>
      customerPortalPage(params.slug ?? '', 'credits'),
    )
    .add('/portal/:slug/profile', (params) =>
      customerPortalPage(params.slug ?? '', 'profile'),
    );
};

export const createRenderer = (context: AppContext) => async () => {
  const path = location.pathname;
  if (path.startsWith('/book/') || path.startsWith('/portal/')) {
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
