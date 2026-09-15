import type {
  CustomerAvailability,
  CustomerRebookingDraft,
  CustomerPortalCredit,
  CustomerPortalMembership,
  CustomerPortalMembershipDetail,
  CustomerPortalPackageDetail,
  Waitlist,
} from '@court-manager/contracts';
import {
  endIsoFromInputs,
  errorMessage,
  isoFromInputs,
} from '../core/presentation.js';
import {
  clearCustomerSession,
  customerRequest,
  getCustomerSession,
  setCustomerSession,
  type CustomerWebSession,
} from '../customer-auth.js';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  reservationStatusLabel,
  t,
} from '../i18n.js';
import { formData, setBusy } from '../ui/forms.js';
import {
  languageSelector,
  wireLanguageSelector,
} from '../ui/language-selector.js';
import { mountCustomerClasses } from './customer-classes.js';
import { wireReservationParticipants } from './reservation-participants.js';
import { app, escapeText, request } from './runtime.js';

const slugFromPath = () => location.pathname.split('/')[2] ?? '';
const portalPath = (slug: string, suffix = '') =>
  `/portal/${encodeURIComponent(slug)}${suffix}`;

export async function customerPortal(
  slug: string,
  action: 'register' | 'activate' | 'reset-password',
) {
  const activating = action !== 'register';
  const title =
    action === 'register'
      ? t('portal.createAccount')
      : action === 'activate'
        ? t('portal.activateAccount')
        : t('portal.resetPassword');
  app.innerHTML = `<main class="login"><form id="portal-form" class="card" novalidate><div class="public-head"><h1>${escapeText(title)}</h1>${languageSelector()}</div>${activating ? '' : `<label>${t('common.name')}<input name="name" required maxlength="160" autocomplete="name"></label><label>${t('common.email')}<input name="email" type="email" required autocomplete="email"></label><label>${t('common.phone')}<input name="phone" required maxlength="40" autocomplete="tel"></label>`}<label>${t('login.password')}<input name="password" type="password" required maxlength="200" autocomplete="${activating ? 'new-password' : 'new-password'}"></label><button class="button primary">${activating ? t('portal.setPassword') : t('portal.register')}</button><p id="portal-result" role="status" aria-live="polite"></p></form></main>`;
  wireLanguageSelector();
  app
    .querySelector<HTMLFormElement>('#portal-form')
    ?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const values = formData(form);
      const token = new URLSearchParams(location.search).get('token');
      const payload = activating
        ? { token, password: values.password }
        : {
            name: values.name,
            email: values.email,
            phone: values.phone,
            password: values.password,
          };
      const result = app.querySelector('#portal-result')!;
      if (!form.reportValidity()) {
        result.className = 'error';
        result.textContent = t('portal.validationError');
        return;
      }
      setBusy(form, true);
      try {
        await request(
          `/public/venues/${encodeURIComponent(slug)}/portal/${action}`,
          { method: 'POST', body: JSON.stringify(payload) },
        );
        result.className = 'success';
        result.textContent = activating ? t('portal.passwordSet') : '';
        if (!activating) {
          result.replaceChildren(
            `${t('portal.accountCreated')} `,
            Object.assign(document.createElement('a'), {
              href: portalPath(slug, '/login'),
              textContent: t('portal.signIn'),
            }),
          );
        }
        form.reset();
      } catch (error) {
        result.className = 'error';
        result.textContent = errorMessage(error);
      } finally {
        setBusy(form, false);
      }
    });
}

export function customerLogin(slug: string) {
  app.innerHTML = `<main class="login portal-login"><form id="portal-login-form" class="card" novalidate><div class="public-head"><h1>${t('portal.title')}</h1>${languageSelector()}</div><p class="muted">${t('portal.signInHint')}</p><label>${t('common.email')}<input name="email" type="email" required autocomplete="email"></label><label>${t('login.password')}<input name="password" type="password" required autocomplete="current-password"></label><button class="button primary">${t('portal.signIn')}</button><a class="portal-text-link" href="${portalPath(slug, '/register')}">${t('portal.createAccountLink')}</a><p id="portal-login-error" class="error" role="alert" aria-live="polite"></p></form></main>`;
  wireLanguageSelector();
  app
    .querySelector<HTMLFormElement>('#portal-login-form')
    ?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const result = app.querySelector('#portal-login-error')!;
      if (!form.reportValidity()) {
        result.textContent = t('portal.validationError');
        return;
      }
      setBusy(form, true);
      try {
        const data = await request<CustomerWebSession>('/customer-auth/login', {
          method: 'POST',
          body: JSON.stringify({ slug, ...formData(form) }),
        });
        setCustomerSession(data);
        location.href = portalPath(slug);
      } catch (error) {
        result.textContent = errorMessage(error);
      } finally {
        setBusy(form, false);
      }
    });
}

type PortalPage =
  | 'home'
  | 'book'
  | 'reservations'
  | 'classes'
  | 'waitlists'
  | 'profile'
  | 'memberships'
  | 'membership-detail'
  | 'credits'
  | 'package-detail';

type CustomerMakeupCredit = {
  originClassId: string;
  originSessionId: string;
  reason: 'VENUE_CANCELLED' | 'EXCUSED_ABSENCE' | 'STAFF_GRANTED' | 'OTHER';
  issuedAt: string;
  expiresAt?: string;
  status: string;
  remainingQuantity: number;
};

type CustomerActivity = {
  activityId: string;
  activityType: 'RESERVATION' | 'CLASS' | 'EVENT' | 'OPEN_GAME' | 'COMMERCIAL';
  title: string;
  subtitle?: string;
  startAt: string;
  endAt: string;
  status: string;
  eventType?: string;
  sourceType?: string;
  sourceId?: string;
  court?: { name: string };
  sport?: string;
  actions: string[];
};

const activityTime = (activity: Pick<CustomerActivity, 'startAt'>) =>
  formatDateTime(activity.startAt);

const activityTypeLabel = (type: CustomerActivity['activityType']) =>
  type === 'COMMERCIAL'
    ? t('portal.commercialActivity')
    : type === 'CLASS'
      ? t('portal.class')
      : type === 'RESERVATION'
        ? t('portal.reservation')
        : type === 'EVENT'
          ? t('portal.event')
          : t('portal.openGame');

const activityCard = (activity: CustomerActivity, next = false) =>
  `<article class="portal-activity${next ? ' portal-next-activity' : ''}"><div><p class="portal-activity-time">${escapeText(activityTime(activity))}</p><h3>${escapeText(activity.title)}</h3><p>${escapeText([activity.subtitle, activity.court?.name, activity.sport].filter(Boolean).join(' · '))}</p></div><div class="portal-activity-meta"><span class="status-badge">${escapeText(reservationStatusLabel(activity.status))}</span><span>${escapeText(activityTypeLabel(activity.activityType))}</span>${activity.actions.includes('CANCEL') ? `<span>${t('portal.cancellationEligible')}</span>` : ''}</div></article>`;

type CustomerReservation = {
  itemType: 'RESERVATION';
  reservationId: string;
  court: { name: string; sport: string };
  startAt: string;
  endAt: string;
  durationMinutes: number;
  status: string;
  cancellationEligibility: {
    eligible: boolean;
    cutoffAt: string;
    reason?: string;
  };
  entitlementAllocations?: Array<{
    sourceType: string;
    sourceId: string;
    sourceName?: string;
    quantity: number;
    unit: string;
  }>;
};
type CustomerReservationRequest = {
  itemType: 'REQUEST';
  requestId: string;
  court: { name: string; sport: string };
  startAt: string;
  endAt: string;
  status: string;
};

const reservationCard = (
  item: CustomerReservation | CustomerReservationRequest,
  historical = false,
  slug = slugFromPath(),
) => {
  const requested = item.itemType === 'REQUEST';
  const cancellation = requested
    ? `<p class="portal-request-note">${t('portal.requestedExplanation')}</p><button class="button small" data-cancel-customer-reservation="${escapeText(item.requestId)}">${t('portal.withdrawRequest')}</button>`
    : item.cancellationEligibility.eligible
      ? `<p class="muted">${t('portal.cancellationUntil', { date: activityTime({ startAt: item.cancellationEligibility.cutoffAt }) })}</p><button class="button small danger" data-cancel-customer-reservation="${escapeText(item.reservationId)}">${t('portal.cancelReservation')}</button>`
      : `<p class="muted">${escapeText(item.cancellationEligibility.reason ?? t('portal.cancellationUnavailable'))}</p>`;
  const coverage =
    !requested && item.entitlementAllocations?.length
      ? `<p class="portal-covered"><strong>${t('portal.coveredBy')}</strong> ${item.entitlementAllocations.map((allocation) => `${escapeText(allocation.sourceName ?? t(`plans.type.${allocation.sourceType}` as never))} · ${allocation.quantity} ${escapeText(t(`plans.unit.${allocation.unit}` as never))}`).join(' · ')}</p>`
      : '';
  return `<article class="portal-activity${requested ? ' portal-request-card' : ''}"><div><p class="portal-activity-time">${escapeText(activityTime(item))}</p><h3>${escapeText(item.court.name)}</h3><p>${escapeText(item.court.sport)} · ${escapeText(t('common.minutes', { count: Math.round((new Date(item.endAt).getTime() - new Date(item.startAt).getTime()) / 60000) }))}</p>${coverage}</div><div class="portal-activity-meta"><span class="status-badge">${escapeText(requested ? t('portal.requestedNotConfirmed') : reservationStatusLabel(item.status))}</span><span>${requested ? t('portal.bookingRequest') : t('portal.reservation')}</span>${cancellation}${item.itemType === 'RESERVATION' && historical ? `<a class="button small" href="${portalPath(slug, `/book?rebook=${encodeURIComponent(item.reservationId)}`)}">${t('portal.bookAgain')}</a>` : ''}${item.itemType === 'RESERVATION' ? `<button class="button small" data-reservation-participants="${escapeText(item.reservationId)}" aria-expanded="false">${t('portal.participants')}</button>` : ''}</div>${item.itemType === 'RESERVATION' ? `<section class="full" data-participants-panel hidden aria-label="${t('portal.reservationParticipants')}"></section>` : ''}</article>`;
};

const homeContent = (
  session: CustomerWebSession,
  activities: CustomerActivity[],
) => {
  const slug = slugFromPath();
  const [next, ...upcoming] = activities;
  return `<div class="portal-hero"><p class="portal-eyebrow">${t('portal.welcomeBack')}</p><h2>${escapeText(session.customer.name)}</h2><p>${next ? t('portal.nextActivityReady') : t('portal.noUpcomingActivities')}</p><a class="button primary" href="${portalPath(slug, '/book')}">${t('portal.bookCourt')}</a></div><section class="portal-activities"><h2>${t('portal.nextActivity')}</h2>${next ? activityCard(next, true) : `<p class="card empty">${t('portal.noUpcomingActivities')} ${t('portal.bookCourt')}</p>`}</section><section class="portal-activities"><div class="portal-section-heading"><h2>${t('portal.upcomingActivities')}</h2><a href="${portalPath(slug, '/reservations')}">${t('portal.viewAll')}</a></div>${upcoming.length ? upcoming.map((activity) => activityCard(activity)).join('') : `<p class="muted">${t('portal.nothingElseScheduled')}</p>`}</section>`;
};

const pageContent: Record<PortalPage, (session: CustomerWebSession) => string> =
  {
    home: (session) => homeContent(session, []),
    book: () =>
      `<section class="card portal-booking-card"><div class="portal-section-heading"><div><h2>${t('portal.bookCourt')}</h2><p class="muted">${t('portal.bookCourtHint')}</p></div></div><div id="portal-booking-policy" class="notice" hidden aria-live="polite"></div><form id="portal-booking-form" class="form-grid" novalidate><label>${t('portal.date')}<input name="date" type="date" required></label><label>${t('portal.sport')}<select name="sport"><option value="">${t('portal.allSports')}</option></select></label><label>${t('portal.duration')}<select name="durationMinutes" required></select></label><label>${t('portal.desiredStartTime')}<input name="desiredStartTime" type="time" step="1800"></label><div class="form-actions full"><button class="button" type="submit">${t('portal.findAvailability')}</button></div><fieldset class="full"><legend>${t('portal.availableCourtsTimes')}</legend><div id="portal-booking-slots" aria-live="polite">${t('portal.chooseDateDuration')}</div></fieldset><label class="full">${t('portal.notesOptional')}<textarea name="notes" maxlength="4000"></textarea></label><div class="form-actions full"><p id="portal-booking-confirmation" class="notice full">${t('portal.confirmationReview')}</p><button class="button primary" id="portal-booking-confirm" type="button" disabled>${t('portal.confirmBooking')}</button></div><p id="portal-booking-result" role="status" aria-live="polite"></p></form></section>`,
    reservations: () =>
      `<section class="portal-activities"><h2>${t('portal.myActivities')}</h2><p class="muted">${t('portal.reservationsHint')}</p><div data-reservation-content><p class="loading" role="status">${t('common.loading')}</p></div></section>`,
    classes: () =>
      `<section class="portal-activities"><h2>${t('portal.classes')}</h2></section>`,
    waitlists: () =>
      `<section class="portal-activities"><div class="portal-section-heading"><div><h2>${t('portal.waitlists')}</h2><p class="muted">${t('portal.waitlistsHint')}</p></div></div><div data-waitlist-list><p class="loading" role="status">${t('common.loading')}</p></div></section>`,
    profile: (session) =>
      `<section class="card"><h2>${t('portal.profileTitle')}</h2><p class="muted">${t('portal.profileHint')}</p><form id="portal-profile-form" class="form-grid" novalidate><label>${t('common.name')}<input name="name" required maxlength="160" autocomplete="name" value="${escapeText(session.customer.name)}"></label><label>${t('common.email')}<input name="email" type="email" required maxlength="254" autocomplete="email" value="${escapeText(session.customer.email ?? '')}"></label><label>${t('common.phone')}<input name="phone" required maxlength="40" autocomplete="tel" value="${escapeText(session.customer.phone ?? '')}"></label><div class="form-actions full"><button class="button primary" type="submit">${t('portal.saveProfile')}</button></div><p class="form-error full" role="alert"></p><p class="success full" role="status" aria-live="polite"></p></form></section><section class="card" id="portal-makeup-credits"><h2>${t('portal.makeupCredits')}</h2><p class="loading" role="status">${t('common.loading')}</p></section>`,
    memberships: () =>
      `<section class="portal-activities"><div class="portal-section-heading"><div><h2>${t('portal.memberships')}</h2><p class="muted">${t('portal.membershipsHint')}</p></div></div><div id="portal-memberships"><p class="loading" role="status">${t('common.loading')}</p></div></section>`,
    'membership-detail': () =>
      `<section id="portal-membership-detail"><p class="loading" role="status">${t('common.loading')}</p></section>`,
    credits: () =>
      `<section class="portal-activities"><div class="portal-section-heading"><div><h2>${t('portal.credits')}</h2><p class="muted">${t('portal.creditsHint')}</p></div></div><div id="portal-credits"><p class="loading" role="status">${t('common.loading')}</p></div></section>`,
    'package-detail': () =>
      `<section id="portal-package-detail"><p class="loading" role="status">${t('common.loading')}</p></section>`,
  };

const waitlistCard = (waitlist: Waitlist) => {
  const activity =
    waitlist.type === 'CLASS'
      ? t('portal.waitlistClass', { classId: waitlist.classId ?? '' })
      : t('portal.waitlistCourt', {
          court: waitlist.courtId ?? '',
          date: waitlist.desiredDate ?? '',
          time: waitlist.desiredStartTime ?? '',
          minutes: waitlist.durationMinutes ?? 0,
        });
  return `<article class="card portal-waitlist-card"><h3>${escapeText(activity)}</h3><p class="muted">${escapeText(t('portal.joinedOn', { date: activityTime({ startAt: waitlist.joinedAt }) }))}</p><button class="button small" data-leave-waitlist="${escapeText(waitlist.waitlistId)}">${t('portal.leaveWaitlist')}</button></article>`;
};

export async function customerPortalPage(
  slug: string,
  page: PortalPage,
  detailId?: string,
) {
  let stored = getCustomerSession();
  if (!stored) {
    location.href = portalPath(slug, '/login');
    return;
  }
  try {
    const profile =
      await customerRequest<Omit<CustomerWebSession, 'token'>>('/customer/me');
    stored = { ...profile, token: stored.token };
    setCustomerSession(stored);
  } catch (error) {
    if ((error as { status?: number }).status === 401) {
      clearCustomerSession();
      location.href = portalPath(slug, '/login');
      return;
    }
    app.innerHTML = `<main class="login"><article class="card error-state"><h1>${t('portal.title')}</h1><p class="error" role="alert">${escapeText(errorMessage(error))}</p><a class="button" href="${portalPath(slug)}">${t('common.tryAgain')}</a></article></main>`;
    return;
  }
  let content = pageContent[page](stored);
  if (page === 'home') {
    try {
      const activities = await customerRequest<CustomerActivity[]>(
        '/customer/activities?limit=6',
      );
      content = homeContent(stored, activities);
    } catch (error) {
      content = `${homeContent(stored, [])}<p class="error" role="alert">${escapeText(errorMessage(error))}</p>`;
    }
  }
  const links: Array<[PortalPage, string, string]> = [
    ['home', 'portal.home', ''],
    ['book', 'portal.book', '/book'],
    ['reservations', 'portal.activities', '/reservations'],
    ['classes', 'portal.classes', '/classes'],
    ['waitlists', 'portal.waitlists', '/waitlists'],
    ['memberships', 'portal.memberships', '/memberships'],
    ['credits', 'portal.credits', '/credits'],
    ['profile', 'portal.profile', '/profile'],
  ];
  app.innerHTML = `<div class="portal-shell"><header class="portal-header"><a class="portal-brand" href="${portalPath(slug)}">CourtOS</a><button id="portal-logout" class="link-button">${t('portal.logout')}</button></header><main class="portal-main">${content}</main><nav class="portal-nav" aria-label="${t('portal.customerNavigation')}">${links.map(([key, label, suffix]) => `<a href="${portalPath(slug, suffix)}"${key === page || (key === 'memberships' && page === 'membership-detail') || (key === 'credits' && page === 'package-detail') ? ' aria-current="page"' : ''}>${t(label as never)}</a>`).join('')}</nav></div>`;
  app.querySelector('#portal-logout')?.addEventListener('click', async () => {
    try {
      await customerRequest('/customer-auth/logout', { method: 'POST' });
    } finally {
      clearCustomerSession();
      location.href = portalPath(slug, '/login');
    }
  });
  if (page === 'profile') {
    wireProfileForm(stored);
    void mountCustomerMakeupCredits();
  }
  if (page === 'reservations') {
    const target = app.querySelector<HTMLElement>(
      '[data-reservation-content]',
    )!;
    try {
      const [upcoming, history] = await Promise.all([
        customerRequest<{
          reservations: CustomerReservation[];
          requests: CustomerReservationRequest[];
        }>('/customer/reservations/upcoming'),
        customerRequest<CustomerReservation[]>(
          '/customer/reservations/history?limit=20',
        ),
      ]);
      target.innerHTML = `<section><h3>${t('portal.upcomingReservations')}</h3>${upcoming.reservations.length ? upcoming.reservations.map((item) => reservationCard(item, false, slug)).join('') : `<p class="card empty">${t('portal.noUpcomingReservations')}</p>`}</section><section class="portal-activities"><h3>${t('portal.pendingRequests')}</h3>${upcoming.requests.length ? upcoming.requests.map((item) => reservationCard(item, false, slug)).join('') : `<p class="card empty">${t('portal.noPendingRequests')}</p>`}</section><section class="portal-activities"><h3>${t('portal.reservationHistory')}</h3>${history.length ? history.map((item) => reservationCard(item, true, slug)).join('') : `<p class="card empty">${t('portal.noReservationHistory')}</p>`}</section>`;
    } catch (error) {
      target.innerHTML = `<p class="error" role="alert">${escapeText(errorMessage(error))}</p>`;
    }
    app
      .querySelectorAll<HTMLButtonElement>('[data-cancel-customer-reservation]')
      .forEach((button) => {
        button.addEventListener('click', async () => {
          if (!window.confirm(t('portal.cancelBookingPrompt'))) return;
          button.disabled = true;
          try {
            await customerRequest(
              `/customer/reservations/${encodeURIComponent(button.dataset.cancelCustomerReservation ?? '')}/cancel`,
              { method: 'POST' },
            );
            await customerPortalPage(slug, 'reservations');
          } catch (error) {
            button.disabled = false;
            const message = document.createElement('p');
            message.className = 'error';
            message.setAttribute('role', 'alert');
            message.textContent = errorMessage(error);
            button.closest('.portal-activity')?.append(message);
          }
        });
      });
    wireReservationParticipants(app);
  }
  if (page === 'classes')
    await mountCustomerClasses(app.querySelector<HTMLElement>('.portal-main')!);
  if (page === 'waitlists') {
    const list = app.querySelector<HTMLElement>('[data-waitlist-list]')!;
    try {
      const result = await customerRequest<Waitlist[]>('/customer/waitlists');
      list.innerHTML = result.length
        ? result.map(waitlistCard).join('')
        : `<p class="card empty">${t('portal.noActiveWaitlists')}</p>`;
      list
        .querySelectorAll<HTMLButtonElement>('[data-leave-waitlist]')
        .forEach((button) => {
          button.addEventListener('click', async () => {
            if (!window.confirm(t('portal.leaveWaitlistPrompt'))) return;
            button.disabled = true;
            try {
              await customerRequest(
                `/customer/waitlists/${encodeURIComponent(button.dataset.leaveWaitlist ?? '')}`,
                { method: 'DELETE' },
              );
              await customerPortalPage(slug, 'waitlists');
            } catch (error) {
              button.disabled = false;
              const message = document.createElement('p');
              message.className = 'error';
              message.setAttribute('role', 'alert');
              message.textContent = errorMessage(error);
              button.closest('article')?.append(message);
            }
          });
        });
    } catch (error) {
      list.innerHTML = `<p class="error" role="alert">${escapeText(errorMessage(error))}</p>`;
    }
  }
  if (page === 'book') void wireBooking(slug);
  if (page === 'memberships') await mountCustomerMemberships(slug);
  if (page === 'membership-detail' && detailId)
    await mountCustomerMembershipDetail(slug, detailId);
  if (page === 'credits') await mountCustomerCredits(slug);
  if (page === 'package-detail' && detailId)
    await mountCustomerPackageDetail(slug, detailId);
}

type CustomerBenefitUsage = CustomerPortalMembership['benefits'][number];

const benefitLabel = (benefit: CustomerBenefitUsage) =>
  benefit.label ?? t(`plans.type.${benefit.type}` as never);

const benefitUsage = (benefit: CustomerBenefitUsage) =>
  benefit.quantityType === 'UNLIMITED'
    ? t('portal.unlimited')
    : `${benefit.consumedQuantity} / ${benefit.issuedQuantity} · ${t('portal.remaining')}: ${benefit.remainingQuantity} ${t(`plans.unit.${benefit.unit}` as never)}`;

const membershipCard = (membership: CustomerPortalMembership, slug: string) =>
  `<article class="card portal-commercial-card"><div class="portal-card-heading"><div><h3>${escapeText(membership.planNameSnapshot)}</h3><p class="muted">${escapeText(t(`memberships.status.${membership.status}` as never))}</p></div><span class="status-badge status-${escapeText(membership.status)}">${escapeText(t(`memberships.status.${membership.status}` as never))}</span></div><dl class="detail-grid"><div><dt>${t('portal.currentPeriod')}</dt><dd>${escapeText(formatDate(membership.currentPeriodStart))} – ${escapeText(formatDate(membership.currentPeriodEnd))}</dd></div><div><dt>${t('portal.nextRenewal')}</dt><dd>${escapeText(membership.nextRenewalDate ? formatDate(membership.nextRenewalDate) : '—')}</dd></div><div><dt>${t('common.price')}</dt><dd>${escapeText(formatMoney(membership.price, membership.currency))}</dd></div></dl><ul class="detail-list">${membership.benefits.map((benefit) => `<li><strong>${escapeText(benefitLabel(benefit))}</strong><span>${escapeText(benefitUsage(benefit))}</span></li>`).join('')}</ul><a class="button small" href="${portalPath(slug, `/memberships/${encodeURIComponent(membership.membershipId)}`)}">${t('portal.viewDetails')}</a></article>`;

async function mountCustomerMemberships(slug: string) {
  const target = app.querySelector<HTMLElement>('#portal-memberships');
  if (!target) return;
  try {
    const memberships = await customerRequest<CustomerPortalMembership[]>(
      '/customer/memberships',
    );
    target.innerHTML = memberships.length
      ? memberships
          .map((membership) => membershipCard(membership, slug))
          .join('')
      : `<p class="card empty">${t('portal.noMemberships')}</p>`;
  } catch (error) {
    target.innerHTML = `<p class="error" role="alert">${escapeText(errorMessage(error))}</p>`;
  }
}

const historyRows = (history: CustomerPortalMembershipDetail['history']) =>
  history.length
    ? history
        .map(
          (item) =>
            `<tr><td>${escapeText(t(`packages.transaction.${item.transactionType}` as never))}</td><td>${item.quantity > 0 ? '+' : ''}${item.quantity} ${escapeText(t(`plans.unit.${item.unit}` as never))}</td><td>${escapeText(item.activityType ? t(`portal.activity.${item.activityType}` as never) : '—')}</td><td>${escapeText(formatDateTime(item.occurredAt))}</td></tr>`,
        )
        .join('')
    : `<tr><td colspan="4" class="empty">${t('portal.noCreditHistory')}</td></tr>`;

async function mountCustomerMembershipDetail(slug: string, id: string) {
  const target = app.querySelector<HTMLElement>('#portal-membership-detail');
  if (!target) return;
  try {
    const detail = await customerRequest<CustomerPortalMembershipDetail>(
      `/customer/memberships/${encodeURIComponent(id)}`,
    );
    const membership = detail.membership;
    target.innerHTML = `<a class="portal-text-link" href="${portalPath(slug, '/memberships')}">← ${t('portal.memberships')}</a><section class="card portal-commercial-card"><div class="portal-card-heading"><div><h2>${escapeText(membership.planNameSnapshot)}</h2><p class="muted">${escapeText(t(`memberships.status.${membership.status}` as never))}</p></div><span class="status-badge status-${escapeText(membership.status)}">${escapeText(t(`memberships.status.${membership.status}` as never))}</span></div><div class="detail-grid"><div><small class="muted">${t('portal.currentPeriod')}</small><strong>${escapeText(formatDate(membership.currentPeriodStart))} – ${escapeText(formatDate(membership.currentPeriodEnd))}</strong></div><div><small class="muted">${t('portal.nextRenewal')}</small><strong>${escapeText(membership.nextRenewalDate ? formatDate(membership.nextRenewalDate) : '—')}</strong></div><div><small class="muted">${t('common.price')}</small><strong>${escapeText(formatMoney(membership.price, membership.currency))}</strong></div></div><h3>${t('portal.benefitsAndUsage')}</h3><ul class="detail-list">${membership.benefits.map((benefit) => `<li><strong>${escapeText(benefitLabel(benefit))}</strong><span>${escapeText(benefitUsage(benefit))}</span></li>`).join('')}</ul></section><section class="card table-wrap"><h3>${t('portal.membershipPeriods')}</h3><table><thead><tr><th>${t('memberships.periodNumber')}</th><th>${t('common.start')}</th><th>${t('common.end')}</th><th>${t('common.status')}</th><th>${t('common.price')}</th></tr></thead><tbody>${detail.periods.map((period) => `<tr><td>${period.periodNumber}</td><td>${escapeText(formatDate(period.startDate))}</td><td>${escapeText(formatDate(period.endDate))}</td><td>${escapeText(t(`memberships.periodStatus.${period.status}` as never))}</td><td>${escapeText(formatMoney(period.price, period.currency))}</td></tr>`).join('')}</tbody></table></section><section class="card table-wrap"><h3>${t('portal.creditHistory')}</h3><table><thead><tr><th>${t('portal.transaction')}</th><th>${t('portal.quantity')}</th><th>${t('portal.activity')}</th><th>${t('common.dateTime')}</th></tr></thead><tbody>${historyRows(detail.history)}</tbody></table></section>`;
  } catch (error) {
    target.innerHTML = `<p class="error" role="alert">${escapeText(errorMessage(error))}</p>`;
  }
}

const creditCard = (credit: CustomerPortalCredit, slug: string) => {
  const detailPath =
    credit.sourceType === 'PACKAGE'
      ? `/packages/${encodeURIComponent(credit.sourceId)}`
      : credit.sourceType === 'MEMBERSHIP'
        ? `/memberships/${encodeURIComponent(credit.sourceId)}`
        : '';
  return `<article class="card portal-commercial-card"><div class="portal-card-heading"><div><h3>${escapeText(credit.label ?? t(`plans.type.${credit.type}` as never))}</h3><p class="muted">${escapeText(credit.sourceName)}</p></div><span class="status-badge">${escapeText(credit.quantityType === 'UNLIMITED' ? t('portal.unlimited') : `${credit.remainingQuantity} ${t(`plans.unit.${credit.unit}` as never)}`)}</span></div><dl class="detail-grid"><div><dt>${t('portal.issued')}</dt><dd>${credit.quantityType === 'UNLIMITED' ? t('portal.unlimited') : `${credit.issuedQuantity} ${t(`plans.unit.${credit.unit}` as never)}`}</dd></div><div><dt>${t('portal.used')}</dt><dd>${credit.consumedQuantity} ${t(`plans.unit.${credit.unit}` as never)}</dd></div><div><dt>${t('portal.expires')}</dt><dd>${escapeText(credit.expiresAt ? formatDate(credit.expiresAt) : t('portal.noExpiry'))}</dd></div></dl>${detailPath ? `<a class="button small" href="${portalPath(slug, detailPath)}">${t('portal.viewDetails')}</a>` : ''}</article>`;
};

async function mountCustomerCredits(slug: string) {
  const target = app.querySelector<HTMLElement>('#portal-credits');
  if (!target) return;
  try {
    const credits =
      await customerRequest<CustomerPortalCredit[]>('/customer/credits');
    target.innerHTML = credits.length
      ? credits.map((credit) => creditCard(credit, slug)).join('')
      : `<p class="card empty">${t('portal.noCredits')}</p>`;
  } catch (error) {
    target.innerHTML = `<p class="error" role="alert">${escapeText(errorMessage(error))}</p>`;
  }
}

async function mountCustomerPackageDetail(slug: string, id: string) {
  const target = app.querySelector<HTMLElement>('#portal-package-detail');
  if (!target) return;
  try {
    const detail = await customerRequest<CustomerPortalPackageDetail>(
      `/customer/packages/${encodeURIComponent(id)}`,
    );
    const item = detail.package;
    target.innerHTML = `<a class="portal-text-link" href="${portalPath(slug, '/credits')}">← ${t('portal.credits')}</a><section class="card portal-commercial-card"><div class="portal-card-heading"><div><h2>${escapeText(item.packageNameSnapshot)}</h2><p class="muted">${escapeText(t(`packages.status.${item.status}` as never))}</p></div><span class="status-badge status-${escapeText(item.status)}">${escapeText(t(`packages.status.${item.status}` as never))}</span></div><div class="detail-grid"><div><small class="muted">${t('portal.issued')}</small><strong>${escapeText(formatDate(item.issuedAt))}</strong></div><div><small class="muted">${t('portal.expires')}</small><strong>${escapeText(item.expiresAt ? formatDate(item.expiresAt) : t('portal.noExpiry'))}</strong></div><div><small class="muted">${t('common.price')}</small><strong>${escapeText(formatMoney(item.price, item.currency))}</strong></div></div><h3>${t('portal.benefitsAndUsage')}</h3><ul class="detail-list">${item.benefits.map((benefit) => `<li><strong>${escapeText(benefitLabel(benefit))}</strong><span>${escapeText(benefitUsage(benefit))}</span></li>`).join('')}</ul></section><section class="card table-wrap"><h3>${t('portal.creditHistory')}</h3><table><thead><tr><th>${t('portal.transaction')}</th><th>${t('portal.quantity')}</th><th>${t('portal.activity')}</th><th>${t('common.dateTime')}</th></tr></thead><tbody>${historyRows(detail.history)}</tbody></table></section>`;
  } catch (error) {
    target.innerHTML = `<p class="error" role="alert">${escapeText(errorMessage(error))}</p>`;
  }
}

async function mountCustomerMakeupCredits() {
  const target = app.querySelector<HTMLElement>('#portal-makeup-credits');
  if (!target) return;
  try {
    const credits = await customerRequest<CustomerMakeupCredit[]>(
      '/customer/makeup-credits',
    );
    target.innerHTML = `<h2>${t('portal.makeupCredits')}</h2>${credits.length ? `<div class="portal-activities">${credits.map((credit) => `<article class="portal-activity"><div><h3>${escapeText(t('portal.makeupCreditOrigin', { classId: credit.originClassId, sessionId: credit.originSessionId }))}</h3><p>${escapeText(t(`makeupCredit.reason.${credit.reason}` as never))} · ${escapeText(t(`makeupCredit.status.${credit.status}` as never))}</p></div><div class="portal-activity-meta"><span>${escapeText(t('profile.remaining'))}: ${credit.remainingQuantity}</span>${credit.expiresAt ? `<span>${escapeText(t('portal.makeupCreditExpires', { date: formatDateTime(credit.expiresAt) }))}</span>` : ''}</div></article>`).join('')}</div>` : `<p class="empty">${t('portal.noMakeupCredits')}</p>`}`;
  } catch (error) {
    target.innerHTML = `<h2>${t('portal.makeupCredits')}</h2><p class="error" role="alert">${escapeText(errorMessage(error))}</p>`;
  }
}

function wireProfileForm(session: CustomerWebSession) {
  const form = app.querySelector<HTMLFormElement>('#portal-profile-form');
  if (!form) return;
  const error = form.querySelector<HTMLElement>('[role="alert"]')!;
  const success = form.querySelector<HTMLElement>('[role="status"]')!;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) {
      error.textContent = t('portal.validationError');
      return;
    }
    error.textContent = '';
    success.textContent = '';
    setBusy(form, true);
    try {
      const updated = await customerRequest<{
        customer: CustomerWebSession['customer'];
      }>('/customer/me', {
        method: 'PATCH',
        body: JSON.stringify(formData(form)),
      });
      const next = { ...session, customer: updated.customer };
      setCustomerSession(next);
      success.textContent = t('portal.profileSaved');
    } catch (reason) {
      error.textContent = errorMessage(reason);
    } finally {
      setBusy(form, false);
    }
  });
}

type CustomerBookingAvailability = CustomerAvailability;

const bookingDurationLabel = (minutes: number) =>
  minutes % 60 === 0
    ? t('common.hours', { count: minutes / 60 })
    : t('common.minutes', { count: minutes });

async function wireBooking(slug: string) {
  const form = app.querySelector<HTMLFormElement>('#portal-booking-form');
  if (!form) return;
  const date = form.elements.namedItem('date') as HTMLInputElement;
  const sport = form.elements.namedItem('sport') as HTMLSelectElement;
  const duration = form.elements.namedItem(
    'durationMinutes',
  ) as HTMLSelectElement;
  const desiredStartTime = form.elements.namedItem(
    'desiredStartTime',
  ) as HTMLInputElement;
  const slots = form.querySelector<HTMLElement>('#portal-booking-slots')!;
  const result = form.querySelector<HTMLElement>('#portal-booking-result')!;
  const policyNotice = app.querySelector<HTMLElement>(
    '#portal-booking-policy',
  )!;
  const confirmation = form.querySelector<HTMLElement>(
    '#portal-booking-confirmation',
  )!;
  const confirm = form.querySelector<HTMLButtonElement>(
    '#portal-booking-confirm',
  )!;
  try {
    const [policy, venue] = await Promise.all([
      customerRequest<{
        reservationMode: string;
        minimumReservationMinutes: number;
        maximumReservationMinutes: number;
      }>('/customer/booking-policy'),
      request<{ timezone: string }>(
        `/public/venues/${encodeURIComponent(slug)}`,
      ),
    ]);
    const rebookId = new URLSearchParams(location.search).get('rebook');
    const rebookDraft = rebookId
      ? await customerRequest<CustomerRebookingDraft>(
          `/customer/reservations/${encodeURIComponent(rebookId)}/rebook`,
        )
      : undefined;
    if (policy.reservationMode === 'STAFF_ONLY') {
      form.replaceWith(
        Object.assign(document.createElement('p'), {
          className: 'notice',
          role: 'alert',
          textContent: t('portal.staffOnly'),
        }),
      );
      return;
    }
    policyNotice.hidden = false;
    policyNotice.className =
      policy.reservationMode === 'REQUEST_APPROVAL'
        ? 'notice portal-request-note'
        : 'notice portal-confirmed-note';
    policyNotice.textContent =
      policy.reservationMode === 'REQUEST_APPROVAL'
        ? t('portal.requestedExplanation')
        : t('portal.confirmedExplanation');
    confirm.textContent =
      policy.reservationMode === 'REQUEST_APPROVAL'
        ? t('portal.requestBooking')
        : t('portal.confirmBooking');
    date.min = new Date().toISOString().slice(0, 10);
    date.value = rebookDraft?.date ?? date.min;
    const policyDurations = Array.from(
      {
        length:
          Math.floor(
            (policy.maximumReservationMinutes -
              policy.minimumReservationMinutes) /
              30,
          ) + 1,
      },
      (_, index) => policy.minimumReservationMinutes + index * 30,
    );
    const durations = [
      ...new Set([
        ...policyDurations,
        ...(rebookDraft ? [rebookDraft.durationMinutes] : []),
      ]),
    ].sort((a, b) => a - b);
    duration.innerHTML = durations
      .map(
        (value) =>
          `<option value="${value}">${escapeText(bookingDurationLabel(value))}</option>`,
      )
      .join('');
    if (rebookDraft) {
      duration.value = String(rebookDraft.durationMinutes);
      desiredStartTime.value = rebookDraft.startTime;
    }
    let availability: CustomerBookingAvailability | undefined;
    const showAvailability = async (useDraftAvailability = false) => {
      if (!date.value || !duration.value) return;
      const query = new URLSearchParams({
        date: date.value,
        durationMinutes: duration.value,
      });
      if (sport.value) query.set('sport', sport.value);
      slots.className = 'loading';
      slots.textContent = t('portal.loadingAvailability');
      confirm.disabled = true;
      try {
        availability = useDraftAvailability
          ? rebookDraft?.availability
          : await customerRequest<CustomerBookingAvailability>(
              `/customer/availability?${query}`,
            );
        if (!availability) throw new Error(t('errors.requestFailed'));
        const sports = [
          ...new Set(availability.courts.map((court) => court.sport)),
        ];
        const selectedSport = sport.value;
        sport.innerHTML = `<option value="">${t('portal.allSports')}</option>${sports.map((name) => `<option value="${escapeText(name)}">${escapeText(name)}</option>`).join('')}`;
        sport.value =
          rebookDraft && useDraftAvailability
            ? rebookDraft.sport
            : sports.includes(selectedSport)
              ? selectedSport
              : '';
        const choices = availability.courts.flatMap((court) =>
          court.available.map((time) => ({ court, time })),
        );
        const preferredChoice =
          rebookDraft && useDraftAvailability
            ? (choices.find(
                ({ court, time }) =>
                  court.courtId === rebookDraft.preferredCourtId &&
                  time === rebookDraft.startTime,
              ) ?? choices.find(({ time }) => time === rebookDraft.startTime))
            : undefined;
        slots.className = '';
        slots.innerHTML = choices.length
          ? choices
              .map(
                ({ court, time }) =>
                  `<label class="check portal-slot"><input type="radio" name="slot" value="${escapeText(court.courtId)}|${escapeText(time)}"${preferredChoice?.court.courtId === court.courtId && preferredChoice.time === time ? ' checked' : ''}> <span><strong>${escapeText(court.name)}</strong><small>${escapeText(court.sport)} · ${escapeText(time)}</small></span></label>`,
              )
              .join('')
          : availability.courts.length
            ? `<p>${t('portal.noCourtsForWaitlist')}</p>${availability.courts.map((court) => `<div class="list-row"><span>${escapeText(court.name)} · ${escapeText(court.sport)}</span><button class="button small" type="button" data-join-court-waitlist="${escapeText(court.courtId)}">${t('portal.joinWaitlist')}</button></div>`).join('')}`
            : `<p class="empty">${t('portal.noCourtsForSearch')}</p>`;
        confirm.disabled = !form.querySelector<HTMLInputElement>(
          'input[name="slot"]:checked',
        );
        updateConfirmation();
      } catch (error) {
        availability = undefined;
        slots.className = 'error';
        slots.textContent = errorMessage(error);
      }
    };
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (form.reportValidity()) void showAvailability();
      else {
        result.className = 'error';
        result.textContent = t('portal.validationError');
      }
    });
    sport.addEventListener('change', () => void showAvailability());
    slots.addEventListener('change', () => {
      confirm.disabled = !form.querySelector<HTMLInputElement>(
        'input[name="slot"]:checked',
      );
      updateConfirmation();
    });
    slots.addEventListener('click', async (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        '[data-join-court-waitlist]',
      );
      if (!button) return;
      if (!desiredStartTime.value) {
        result.className = 'error';
        result.textContent = t('portal.chooseWaitlistTime');
        desiredStartTime.focus();
        return;
      }
      button.disabled = true;
      try {
        await customerRequest('/customer/waitlists/court', {
          method: 'POST',
          body: JSON.stringify({
            courtId: button.dataset.joinCourtWaitlist,
            desiredDate: date.value,
            desiredStartTime: desiredStartTime.value,
            durationMinutes: Number(duration.value),
          }),
        });
        result.className = 'success';
        result.textContent = t('portal.joinedWaitlist');
      } catch (error) {
        result.className = 'error';
        result.textContent = errorMessage(error);
      } finally {
        button.disabled = false;
      }
    });
    confirm.addEventListener('click', async () => {
      const selected = form!.querySelector<HTMLInputElement>(
        'input[name="slot"]:checked',
      );
      if (!selected || !availability) return;
      const [courtId, time] = selected.value.split('|');
      if (!courtId || !time) return;
      confirm.disabled = true;
      try {
        const created = await customerRequest<{ status: string }>(
          '/customer/reservations',
          {
            method: 'POST',
            body: JSON.stringify({
              courtId,
              startAt: isoFromInputs(date.value, time, venue.timezone),
              endAt: endIsoFromInputs(
                date.value,
                time,
                Number(duration.value),
                venue.timezone,
              ),
              notes:
                String(
                  (form.elements.namedItem('notes') as HTMLTextAreaElement)
                    .value || '',
                ) || undefined,
            }),
          },
        );
        result.className = 'success';
        result.textContent =
          created.status === 'REQUESTED'
            ? t('portal.requestSent')
            : t('portal.reservationConfirmed');
        await showAvailability();
      } catch (error) {
        result.className = 'error';
        result.textContent = errorMessage(error);
        if ((error as { code?: string }).code === 'SCHEDULE_CONFLICT')
          await showAvailability();
        else confirm.disabled = false;
      }
    });
    await showAvailability(Boolean(rebookDraft));

    function updateConfirmation() {
      const selected = form!.querySelector<HTMLInputElement>(
        'input[name="slot"]:checked',
      );
      confirmation.textContent = selected
        ? t('portal.confirmationSelection', {
            selection: selected.closest('label')?.textContent?.trim() ?? '',
          })
        : t('portal.confirmationReview');
    }
  } catch (error) {
    result.className = 'error';
    result.textContent = errorMessage(error);
  }
}
