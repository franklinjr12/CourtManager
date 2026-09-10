import './styles.css';
import {
  attendanceStatusLabel,
  blockReasonLabel,
  formatDate,
  formatMoney,
  getLocale,
  paymentMethodLabel,
  paymentStatusLabel,
  reservationSourceLabel,
  reservationStatusLabel,
  requestStatusLabel,
  setLocale,
  t,
  translateError,
  weekdayLabel,
  type Locale,
} from './i18n.js';

type Session = {
  token: string;
  user: { userId: string; name: string; role: string };
  organization?: {
    name: string;
    timezone?: string;
    features?: { classes: boolean; finance: boolean };
  };
};
type OpeningHours = Record<string, { open: string; close: string } | null>;
type Organization = {
  organizationId: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  phone?: string;
  email?: string;
  active: boolean;
  features: { classes: boolean; finance: boolean };
};
type Court = {
  courtId: string;
  name: string;
  sport: string;
  sportId?: string;
  active: boolean;
  publiclyRequestable: boolean;
  slotMinutes: 30 | 60;
  defaultHourlyPrice: number;
  openingHours: OpeningHours;
  notes?: string;
  archivedAt?: string;
};
type Sport = {
  sportId: string;
  name: string;
  active: boolean;
};
type Customer = {
  customerId: string;
  name: string;
  phone?: string;
  email?: string;
  archived: boolean;
  notes?: string;
  customerName?: string;
};
type Reservation = {
  reservationId: string;
  courtId: string;
  customerId: string;
  startAt: string;
  endAt: string;
  status: string;
  source: string;
  expectedAmount: number;
  notes?: string;
  paidAmount?: number;
  remainingAmount?: number;
  paymentStatus?: string;
  customerName?: string;
  courtName?: string;
};
type RequestItem = {
  requestId: string;
  courtId: string;
  requestedStartAt: string;
  requestedEndAt: string;
  customerName: string;
  phone: string;
  email?: string;
  notes?: string;
  status: string;
  linkedCustomerId?: string;
};
type Payment = {
  paymentId: string;
  reservationId?: string;
  classId?: string;
  customerId: string;
  amount: number;
  method: string;
  paidAt: string;
  notes?: string;
};
type SportClass = {
  classId: string;
  name: string;
  sport: string;
  coachId: string;
  courtId: string;
  capacity: number;
  price: number;
  weekday: number;
  startTime: string;
  durationMinutes: number;
  startDate: string;
  endDate?: string;
  active: boolean;
  notes?: string;
};
type ScheduleItem = Reservation & {
  blockId?: string;
  reason?: string;
  classId?: string;
  name?: string;
  occupancyType?: string;
};

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';
const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('App root missing');
const app = root;
const escapeText = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] ?? c,
  );
const session = () =>
  JSON.parse(
    localStorage.getItem('court-manager-session') ?? 'null',
  ) as Session | null;
const setSession = (value: Session | null) =>
  value
    ? localStorage.setItem('court-manager-session', JSON.stringify(value))
    : localStorage.removeItem('court-manager-session');
const timezone = () => session()?.organization?.timezone ?? 'UTC';
const today = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
};
const localParts = (date: Date, zone = timezone()) => {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return values;
};
const isoFromInputs = (date: string, time: string, zone = timezone()) => {
  const [year = NaN, month = NaN, day = NaN] = date.split('-').map(Number);
  const [hour = NaN, minute = NaN] = time.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let instant = new Date(wall);
  for (let i = 0; i < 4; i += 1) {
    const parts = localParts(instant, zone);
    const localAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    const candidate = new Date(wall - (localAsUtc - instant.getTime()));
    if (candidate.getTime() === instant.getTime())
      return candidate.toISOString();
    instant = candidate;
  }
  return instant.toISOString();
};
const endIsoFromInputs = (
  date: string,
  time: string,
  duration: number,
  zone = timezone(),
) => {
  const [year = NaN, month = NaN, day = NaN] = date.split('-').map(Number);
  const [hour = NaN, minute = NaN] = time.split(':').map(Number);
  const local = new Date(
    Date.UTC(year, month - 1, day, hour, minute) + duration * 60000,
  );
  const parts = localParts(local, 'UTC');
  return isoFromInputs(
    `${parts.year}-${parts.month}-${parts.day}`,
    `${parts.hour}:${parts.minute}`,
    zone,
  );
};
const timeValue = (date: string) => {
  const value = localParts(new Date(date));
  return `${value.hour}:${value.minute}`;
};
const localDateKey = (date: string) => {
  const value = localParts(new Date(date));
  return `${value.year}-${value.month}-${value.day}`;
};
const dateValue = (date: string) => {
  return formatDate(new Date(date), timezone());
};
const errorMessage = (error: unknown) => {
  return translateError(error);
};
const languageSelector = () =>
  `<label class="language-selector"><span class="sr-only">${t('common.language')}</span><select class="language-control" data-language-selector aria-label="${t('common.language')}"><option value="pt-BR" ${getLocale() === 'pt-BR' ? 'selected' : ''}>${t('common.portugueseBrazil')}</option><option value="en-US" ${getLocale() === 'en-US' ? 'selected' : ''}>${t('common.englishUS')}</option></select></label>`;
const wireLanguageSelector = () => {
  app.querySelector<HTMLSelectElement>('[data-language-selector]')?.addEventListener('change', (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (!['pt-BR', 'en-US'].includes(value)) return;
    setLocale(value as Locale);
    void renderRoute();
  });
};
const localizeEnumOptions = (container: ParentNode) => {
  container.querySelectorAll<HTMLSelectElement>('select').forEach((select) => {
    select.querySelectorAll<HTMLOptionElement>('option').forEach((option) => {
      const value = option.value || option.textContent?.trim() || '';
      if (select.name === 'status' && ['PRESENT', 'ABSENT', 'EXCUSED'].includes(value)) option.textContent = attendanceStatusLabel(value);
      else if (select.name === 'method') option.textContent = paymentMethodLabel(value);
      else if (select.name === 'source') option.textContent = reservationSourceLabel(value);
      else if (select.name === 'reason') option.textContent = blockReasonLabel(value);
      else if (select.name === 'weekday' && /^\d$/.test(value)) option.textContent = weekdayLabel(Number(value));
    });
  });
};
class ApiError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}
const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const current = session();
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(current ? { Authorization: `Bearer ${current.token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { message?: string; code?: string };
  };
  if (response.status === 401) {
    setSession(null);
    navigate('/login');
  }
  if (!response.ok)
    throw new ApiError(
      payload.error?.message ?? t('errors.requestFailed'),
      payload.error?.code,
      response.status,
    );
  return payload.data as T;
};
const navigate = (path: string) => {
  history.pushState({}, '', path);
  void renderRoute();
};
const renderToast = (
  message: string,
  kind: 'success' | 'error' = 'success',
) => {
  app.querySelector('.toast')?.remove();
  app.insertAdjacentHTML(
    'beforeend',
    `<div class="toast ${kind}" role="status">${escapeText(message)}</div>`,
  );
  window.setTimeout(() => app.querySelector('.toast')?.remove(), 3500);
};
const toast = (message: string, kind: 'success' | 'error' = 'success') => {
  sessionStorage.setItem(
    'court-manager-toast',
    JSON.stringify({ message, kind }),
  );
  renderToast(message, kind);
  window.setTimeout(() => sessionStorage.removeItem('court-manager-toast'), 0);
};
let modalReturn: HTMLElement | null = null;
let modalKeyHandler: ((event: KeyboardEvent) => void) | null = null;
const closeModal = () => {
  app.querySelector('.modal-backdrop')?.remove();
  if (modalKeyHandler) {
    document.removeEventListener('keydown', modalKeyHandler);
    modalKeyHandler = null;
  }
  const focus = modalReturn;
  modalReturn = null;
  focus?.focus();
};
const openModal = (title: string, body: string, returnFocus?: HTMLElement) => {
  closeModal();
  modalReturn = returnFocus ?? (document.activeElement as HTMLElement);
  app.insertAdjacentHTML(
    'beforeend',
    `<div class="modal-backdrop" role="presentation"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">${escapeText(title)}</h2><button type="button" class="icon-button" data-close aria-label="${t('common.close')}">×</button></div><div class="modal-body">${body}</div></section></div>`,
  );
  localizeEnumOptions(app);
  const backdrop = app.querySelector('.modal-backdrop');
  backdrop?.addEventListener('click', (event) => {
    if (event.target === backdrop) closeModal();
  });
  backdrop
    ?.querySelector<HTMLElement>('[data-close]')
    ?.addEventListener('click', closeModal);
  modalKeyHandler = (event) => {
    if (event.key === 'Escape') closeModal();
  };
  document.addEventListener('keydown', modalKeyHandler);
  backdrop?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
};
const formData = (form: HTMLFormElement) =>
  Object.fromEntries(new FormData(form).entries());
const setBusy = (form: HTMLFormElement, busy: boolean) => {
  form.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.disabled = busy;
  });
  form.classList.toggle('busy', busy);
};
const showFormError = (form: HTMLFormElement, error: unknown) => {
  let element = form.querySelector<HTMLElement>('.form-error');
  if (!element) {
    element = document.createElement('p');
    element.className = 'form-error';
    element.setAttribute('role', 'alert');
    form.append(element);
  }
  element.textContent = errorMessage(error);
};
const button = (label: string, attrs = '') =>
  `<button type="button" class="button" ${attrs}>${escapeText(label)}</button>`;
const days = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
];
const defaultHours = (): OpeningHours =>
  Object.fromEntries(
    days.map((day) => [day, { open: '07:00', close: '23:00' }]),
  );
const hourFields = (hours: OpeningHours) =>
  days
    .map((day) => {
      const closed = hours[day] === null;
      const value = hours[day] ?? { open: '07:00', close: '23:00' };
      return `<div class="hour-row"><strong>${weekdayLabel(day)}</strong><label>${t('settings.open')}<input name="open-${day}" type="time" value="${escapeText(value.open)}" ${closed ? 'disabled' : 'required'}></label><label>${t('settings.close')}<input name="close-${day}" type="time" value="${escapeText(value.close)}" ${closed ? 'disabled' : 'required'}></label><label class="check"><input name="closed-${day}" type="checkbox" ${closed ? 'checked' : ''}> ${t('settings.closed')}</label></div>`;
    })
    .join('');
const courtForm = (court?: Court) => {
  const hours = court?.openingHours ?? defaultHours();
  return `<form id="court-form" class="form-grid"><label>${t('common.name')}<input name="name" required maxlength="100" value="${escapeText(court?.name)}"></label><label>${t('common.sport')}<input name="sport" required maxlength="80" value="${escapeText(court?.sport)}"></label><label>${t('settings.hourlyPrice')}<input name="defaultHourlyPrice" type="number" min="0" step="0.01" required value="${escapeText(court?.defaultHourlyPrice ?? 80)}"></label><label>${t('settings.slotSize')}<select name="slotMinutes"><option value="30">${t('common.minutes', { count: 30 })}</option><option value="60">${t('common.minutes', { count: 60 })}</option></select></label><label class="check"><input name="publiclyRequestable" type="checkbox" ${court?.publiclyRequestable !== false ? 'checked' : ''}> ${t('settings.publicBookingEnabled')}</label><label class="check"><input name="active" type="checkbox" ${court?.active !== false ? 'checked' : ''}> ${t('common.active')}</label><label class="full">${t('common.notes')}<textarea name="notes" maxlength="2000">${escapeText(court?.notes)}</textarea></label><fieldset class="full"><legend>${t('settings.openingHours')}</legend>${hourFields(hours)}</fieldset><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${court ? t('common.saveChanges') : t('settings.addCourt')}</button></div></form>`;
};
const customerForm = (customer?: Customer) =>
  `<form id="customer-form" class="form-grid"><label>${t('common.name')}<input name="name" required maxlength="160" value="${escapeText(customer?.name)}"></label><label>${t('common.phone')}<input name="phone" maxlength="40" value="${escapeText(customer?.phone)}"></label><label>${t('common.email')}<input name="email" type="email" value="${escapeText(customer?.email)}"></label><label class="full">${t('common.notes')}<textarea name="notes" maxlength="4000">${escapeText(customer?.notes)}</textarea></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${customer ? t('common.saveChanges') : t('customers.create')}</button></div></form>`;
const organizationForm = (org: Organization) =>
  `<form id="organization-form" class="form-grid"><label>${t('common.name')}<input name="name" required maxlength="160" value="${escapeText(org.name)}"></label><label>${t('settings.publicSlug')}<input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value="${escapeText(org.slug)}"></label><label>${t('settings.timezone')}<input name="timezone" required value="${escapeText(org.timezone)}"></label><label>${t('settings.currency')}<input name="currency" required maxlength="3" value="${escapeText(org.currency)}"></label><label>${t('common.phone')}<input name="phone" value="${escapeText(org.phone)}"></label><label>${t('common.email')}<input name="email" type="email" value="${escapeText(org.email)}"></label><label class="check full"><input name="classes" type="checkbox" ${org.features.classes ? 'checked' : ''}> ${t('settings.enableClasses')}</label><p class="form-error" role="alert"></p><div class="form-actions full"><button class="button primary">${t('settings.saveOrganization')}</button></div></form>`;

function login() {
  app.innerHTML = `<main class="login"><form id="login-form" class="card"><div class="login-head"><h1>Court Manager</h1>${languageSelector()}</div><p class="muted">${t('login.subtitle')}</p><label>${t('common.email')}<input name="email" type="email" required autocomplete="email"></label><label>${t('login.password')}<input name="password" type="password" required autocomplete="current-password"></label><button class="button primary">${t('login.submit')}</button><p id="login-error" class="error" role="alert"></p></form></main>`;
  wireLanguageSelector();
  app
    .querySelector<HTMLFormElement>('#login-form')
    ?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      setBusy(form, true);
      try {
        const data = await request<Session>('/auth/login', {
          method: 'POST',
          body: JSON.stringify(formData(form)),
        });
        setSession(data);
        navigate('/dashboard');
      } catch (error) {
        showFormError(form, error);
        setBusy(form, false);
      }
    });
}
async function shell(content: () => Promise<string> | string) {
  const current = session();
  if (!current) {
    navigate('/login');
    return;
  }
  app.innerHTML = `<div class="shell"><aside><h1>Court Manager</h1><nav><a href="/dashboard">${t('nav.dashboard')}</a><a href="/schedule">${t('nav.schedule')}</a><a href="/requests">${t('nav.requests')}</a><a href="/reservations">${t('nav.reservations')}</a><a href="/customers">${t('nav.customers')}</a><a href="/finance">${t('nav.finance')}</a><a href="/classes">${t('nav.classes')}</a><a href="/reports">${t('nav.reports')}</a><a href="/settings">${t('nav.settings')}</a></nav><button id="logout" class="link-button">${t('nav.logOut')}</button></aside><main class="content"><header><span>${escapeText(current.organization?.name ?? t('nav.sportsCenter'))}</span><span>${languageSelector()} ${escapeText(current.user.name)}</span></header><section id="screen"><div class="loading">${t('common.loading')}</div></section></main></div>`;
  wireLanguageSelector();
  const queuedToast = sessionStorage.getItem('court-manager-toast');
  if (queuedToast) {
    sessionStorage.removeItem('court-manager-toast');
    const queued = JSON.parse(queuedToast) as {
      message: string;
      kind: 'success' | 'error';
    };
    window.setTimeout(() => renderToast(queued.message, queued.kind), 0);
  }
  app.querySelector('#logout')?.addEventListener('click', async () => {
    try {
      await request('/auth/logout', { method: 'POST' });
    } finally {
      setSession(null);
      navigate('/login');
    }
  });
  app.querySelectorAll<HTMLAnchorElement>('a').forEach((link) =>
    link.addEventListener('click', (event) => {
      const anchor = event.currentTarget as HTMLAnchorElement;
      if (
        anchor.origin === location.origin &&
        !anchor.hasAttribute('download') &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        navigate(anchor.pathname + anchor.search);
      }
    }),
  );
  const target = document.querySelector<HTMLElement>('#screen');
  if (target) {
    target.innerHTML = await content();
    localizeEnumOptions(target);
  }
}
const screen = () => document.querySelector<HTMLElement>('#screen');
async function dashboard() {
  await shell(async () => {
    const data = await request<{
      reservationsToday: number;
      pendingRequests: number;
      expectedRevenue: number;
      recordedPayments: number;
      outstanding: number;
      upcoming: Reservation[];
    }>('/dashboard');
    return `<div class="toolbar"><div><h2>${t('dashboard.today')}</h2><p class="muted">${t('dashboard.overview')}</p></div><a class="button primary" href="/schedule">${t('dashboard.openSchedule')}</a></div><div class="metrics"><article class="metric card"><span>${t('dashboard.reservations')}</span><strong>${data.reservationsToday}</strong></article><article class="metric card"><span>${t('dashboard.pendingRequests')}</span><strong>${data.pendingRequests}</strong></article><article class="metric card"><span>${t('dashboard.expectedRevenue')}</span><strong>${formatMoney(data.expectedRevenue)}</strong></article><article class="metric card"><span>${t('dashboard.outstanding')}</span><strong>${formatMoney(data.outstanding)}</strong></article></div><article class="card"><h3>${t('dashboard.upcoming')}</h3>${data.upcoming.length ? `<ul>${data.upcoming.map((item) => `<li>${escapeText(timeValue(item.startAt))} — ${formatMoney(item.expectedAmount)}</li>`).join('')}</ul>` : `<p class="empty">${t('dashboard.noReservations')}</p>`}</article>`;
  });
}
function openingHoursFrom(form: HTMLFormElement) {
  return Object.fromEntries(
    days.map((day) => [
      day,
      (form.elements.namedItem(`closed-${day}`) as HTMLInputElement).checked
        ? null
        : {
            open: String(
              (form.elements.namedItem(`open-${day}`) as HTMLInputElement)
                .value,
            ),
            close: String(
              (form.elements.namedItem(`close-${day}`) as HTMLInputElement)
                .value,
            ),
          },
    ]),
  );
}
async function openCourtModal(court?: Court) {
  openModal(court ? t('settings.editCourt') : t('settings.addCourt'), courtForm(court));
  const form = app.querySelector<HTMLFormElement>('#court-form');
  if (!form) return;
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  days.forEach((day) =>
    (
      form?.elements.namedItem(`closed-${day}`) as HTMLInputElement | null
    )?.addEventListener('change', (event: Event) => {
      const closed = (event.currentTarget as HTMLInputElement).checked;
      (
        form.elements.namedItem(`open-${day}`) as HTMLInputElement | null
      )?.toggleAttribute('disabled', closed);
      (
        form.elements.namedItem(`close-${day}`) as HTMLInputElement | null
      )?.toggleAttribute('disabled', closed);
    }),
  );
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      const payload = {
        name: String(values.name),
        sport: String(values.sport),
        defaultHourlyPrice: Number(values.defaultHourlyPrice),
        slotMinutes: Number(values.slotMinutes),
        publiclyRequestable: values.publiclyRequestable === 'on',
        active: values.active === 'on',
        notes: String(values.notes || '') || undefined,
        openingHours: openingHoursFrom(form),
      };
      await request(court ? `/courts/${court.courtId}` : '/courts', {
        method: court ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
      closeModal();
      toast(court ? t('settings.courtUpdated') : t('settings.courtAdded'));
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
async function openSportModal(sport?: Sport) {
  openModal(
    sport ? t('settings.editSport') : t('settings.addSport'),
    `<form id="sport-form" class="form-grid"><label class="full">${t('common.name')}<input name="name" required maxlength="80" value="${escapeText(sport?.name)}"></label><label class="check full"><input name="active" type="checkbox" ${sport?.active !== false ? 'checked' : ''}> ${t('common.active')}</label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${sport ? t('common.saveChanges') : t('settings.addSport')}</button></div></form>`,
  );
  const form = app.querySelector<HTMLFormElement>('#sport-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      await request(sport ? `/sports/${sport.sportId}` : '/sports', {
        method: sport ? 'PATCH' : 'POST',
        body: JSON.stringify({
          name: values.name,
          active: values.active === 'on',
        }),
      });
      closeModal();
      toast(sport ? t('settings.sportUpdated') : t('settings.sportAdded'));
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
async function settings() {
  await shell(async () => {
    const [org, courts, sports] = await Promise.all([
      request<Organization>('/organization'),
      request<Court[]>('/courts?includeArchived=true'),
      request<Sport[]>('/sports?includeInactive=true'),
    ]);
    setTimeout(wireSettings, 0);
    return `<div class="toolbar"><div><h2>${t('settings.title')}</h2><p class="muted">${t('settings.description')}</p></div><button class="button primary" id="add-court">${t('settings.addCourt')}</button></div><article class="card"><h3>${t('settings.organization')}</h3>${organizationForm(org)}</article><article class="card section-card"><div class="section-head"><div><h3>${t('settings.sports')}</h3><p class="muted">${t('settings.activeSummary', { active: sports.filter((s) => s.active).length, inactive: sports.filter((s) => !s.active).length })}</p></div><button class="button" id="add-sport">${t('settings.addSport')}</button></div><div class="court-list">${sports.length ? sports.map((sport) => `<article class="list-row ${sport.active ? '' : 'archived'}"><div><strong>${escapeText(sport.name)}</strong><small>${sport.active ? t('common.active') : t('common.inactive')}</small></div><div class="row-actions">${button(t('common.edit'), `data-edit-sport="${escapeText(sport.sportId)}"`)}${button(sport.active ? t('common.deactivate') : t('common.activate'), `data-toggle-sport="${escapeText(sport.sportId)}" data-active="${sport.active ? 'false' : 'true'}"`)}</div></article>`).join('') : `<p class="empty">${t('settings.noSports')}</p>`}</div></article><article class="card section-card"><div class="section-head"><div><h3>${t('settings.courts')}</h3><p class="muted">${t('settings.courtSummary', { active: courts.filter((c) => !c.archivedAt).length, archived: courts.filter((c) => c.archivedAt).length })}</p></div></div><div class="court-list">${courts.length ? courts.map((c) => `<article class="list-row ${c.archivedAt ? 'archived' : ''}"><div><strong>${escapeText(c.name)}</strong><span>${escapeText(c.sport)} · ${formatMoney(c.defaultHourlyPrice)}${t('common.hour')} · ${c.slotMinutes} min</span><small>${c.archivedAt ? t('common.archived') : c.active ? t('common.active') : t('common.inactive')} · ${c.publiclyRequestable ? t('settings.publicBookingEnabled') : t('common.private')}</small></div><div class="row-actions">${button(t('common.edit'), `data-edit-court="${escapeText(c.courtId)}"`)}${c.archivedAt ? button(t('common.restore'), `data-restore-court="${escapeText(c.courtId)}"`) : button(t('common.archive'), `data-archive-court="${escapeText(c.courtId)}"`)}</div></article>`).join('') : `<p class="empty">${t('settings.noCourts')}</p>`}</div></article>`;
  });
}
function wireSettings() {
  app
    .querySelector('#add-sport')
    ?.addEventListener('click', () => void openSportModal());
  app.querySelectorAll<HTMLElement>('[data-edit-sport]').forEach((element) =>
    element.addEventListener('click', async () => {
      const sport = await request<Sport>(`/sports/${element.dataset.editSport}`);
      await openSportModal(sport);
    }),
  );
  app.querySelectorAll<HTMLElement>('[data-toggle-sport]').forEach((element) =>
    element.addEventListener('click', async () => {
      try {
        await request(`/sports/${element.dataset.toggleSport}`, {
          method: 'PATCH',
          body: JSON.stringify({ active: element.dataset.active === 'true' }),
        });
        toast(t('settings.sportStatusUpdated'));
        await renderRoute();
      } catch (error) {
        toast(errorMessage(error), 'error');
      }
    }),
  );
  app
    .querySelector<HTMLButtonElement>('#add-court')
    ?.addEventListener('click', () => void openCourtModal(undefined));
  app.querySelectorAll<HTMLElement>('[data-edit-court]').forEach((element) =>
    element.addEventListener('click', async () => {
      const court = await request<Court>(
        `/courts/${element.dataset.editCourt}`,
      );
      await openCourtModal(court);
    }),
  );
  app.querySelectorAll<HTMLElement>('[data-archive-court]').forEach((element) =>
    element.addEventListener('click', async () => {
      if (!window.confirm(t('settings.archiveCourtConfirmation')))
        return;
      try {
        await request(`/courts/${element.dataset.archiveCourt}/archive`, {
          method: 'POST',
        });
        toast(t('settings.courtArchived'));
        await renderRoute();
      } catch (error) {
        toast(errorMessage(error), 'error');
      }
    }),
  );
  app.querySelectorAll<HTMLElement>('[data-restore-court]').forEach((element) =>
    element.addEventListener('click', async () => {
      try {
        await request(`/courts/${element.dataset.restoreCourt}/restore`, {
          method: 'POST',
        });
        toast(t('settings.courtRestored'));
        await renderRoute();
      } catch (error) {
        toast(errorMessage(error), 'error');
      }
    }),
  );
  app
    .querySelector<HTMLFormElement>('#organization-form')
    ?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      setBusy(form, true);
      try {
        const values = formData(form);
        const current = await request<Organization>('/organization');
        await request('/organization', {
          method: 'PATCH',
          body: JSON.stringify({
            name: values.name,
            slug: values.slug,
            timezone: values.timezone,
            currency: String(values.currency).toUpperCase(),
            phone: values.phone || undefined,
            email: values.email || undefined,
            features: { ...current.features, classes: values.classes === 'on' },
          }),
        });
        toast(t('settings.organizationSaved'));
        setBusy(form, false);
      } catch (error) {
        showFormError(form, error);
        setBusy(form, false);
      }
    });
}
async function loadAvailability(form: HTMLFormElement) {
  const court = String(
      (form.elements.namedItem('courtId') as HTMLSelectElement)?.value ?? '',
    ),
    date = String(
      (form.elements.namedItem('date') as HTMLInputElement)?.value ?? '',
    ),
    duration = String(
      (form.elements.namedItem('durationMinutes') as HTMLSelectElement)
        ?.value ?? '30',
    ),
    start = form.elements.namedItem('startTime') as HTMLSelectElement;
  if (!court || !date) return;
  start.innerHTML = `<option>${t('common.loading')}</option>`;
  try {
    const data = await request<{ available: string[] }>(
      `/availability?courtId=${encodeURIComponent(court)}&date=${encodeURIComponent(date)}&durationMinutes=${duration}`,
    );
    start.innerHTML = data.available.length
      ? data.available
          .map(
            (value) =>
              `<option value="${escapeText(value)}">${escapeText(value)}</option>`,
          )
          .join('')
      : `<option value="">${t('common.noAvailableTimes')}</option>`;
  } catch (error) {
    start.innerHTML = `<option value="">${escapeText(errorMessage(error))}</option>`;
  }
}
async function openCustomerModal(
  onCreated?: (customer: Customer) => void,
  customer?: Customer,
) {
  openModal(
    customer ? t('customers.edit') : t('customers.create'),
    customerForm(customer),
  );
  const form = app.querySelector<HTMLFormElement>('#customer-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      const payload = {
        name: String(values.name),
        phone: String(values.phone || '') || undefined,
        email: String(values.email || '') || undefined,
        notes: String(values.notes || '') || undefined,
      };
      const saved = await request<Customer>(
        customer ? `/customers/${customer.customerId}` : '/customers',
        { method: customer ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
      );
      closeModal();
      toast(customer ? t('customers.updated') : t('customers.created'));
      onCreated?.(saved);
      if (!onCreated) await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
const customerOptions = (customers: Customer[], selected = '') =>
  customers
    .map(
      (c) =>
        `<option value="${escapeText(c.customerId)}" ${c.customerId === selected ? 'selected' : ''}>${escapeText(c.name)}${c.phone ? ` — ${escapeText(c.phone)}` : ''}</option>`,
    )
    .join('');
async function openReservationModal(
  date = today(),
  prefill?: { courtId?: string; startAt?: string },
) {
  const [courts, customers] = await Promise.all([
    request<Court[]>('/courts'),
    request<Customer[]>('/customers?limit=100'),
  ]);
  const startDate = prefill?.startAt ? new Date(prefill.startAt) : new Date();
  const body = `<form id="reservation-form" class="form-grid"><label>${t('common.court')}<select name="courtId" required>${courts.map((c) => `<option value="${escapeText(c.courtId)}" data-price="${c.defaultHourlyPrice}" ${c.courtId === prefill?.courtId ? 'selected' : ''}>${escapeText(c.name)} — ${escapeText(c.sport)}</option>`).join('')}</select></label><label>${t('common.date')}<input name="date" type="date" required value="${escapeText(prefill?.startAt ? startDate.toISOString().slice(0, 10) : date)}"></label><label>${t('common.duration')}<select name="durationMinutes"><option value="30">${t('common.minutes', { count: 30 })}</option><option value="60">${t('common.minutes', { count: 60 })}</option></select></label><label>${t('common.startTime')}<select name="startTime" required><option>${t('common.loading')}</option></select></label><label class="full">${t('common.customer')}<select name="customerId" required>${customerOptions(customers)}</select><button type="button" class="button small" id="quick-customer">${t('reservations.quickNewCustomer')}</button></label><div id="quick-customer-fields" class="inline-panel full" hidden><label>${t('common.name')}<input name="quickName" maxlength="160"></label><label>${t('common.phone')}<input name="quickPhone" maxlength="40"></label><button type="button" class="button small" id="create-quick-customer">${t('customers.create')}</button><p class="form-error" id="quick-customer-error" role="alert"></p></div><label>${t('common.expectedAmount')}<input name="expectedAmount" type="number" min="0" step="0.01" required></label><label>${t('common.source')}<select name="source"><option>STAFF</option><option>PHONE</option><option>WHATSAPP</option><option>WALK_IN</option><option>OTHER</option></select></label><label class="full">${t('common.notes')}<textarea name="notes" maxlength="4000"></textarea></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${t('reservations.save')}</button></div></form>`;
  openModal(t('reservations.new'), body);
  const form = app.querySelector<HTMLFormElement>('#reservation-form');
  if (!form) return;
  form.querySelector('[data-close]')?.addEventListener('click', closeModal);
  const updatePrice = () => {
    const selected =
      form.querySelector<HTMLSelectElement>('[name="courtId"]')
        ?.selectedOptions[0];
    const duration = Number(
      (form.elements.namedItem('durationMinutes') as HTMLSelectElement)
        ?.value ?? 30,
    );
    const price = form.elements.namedItem('expectedAmount') as HTMLInputElement;
    if (selected)
      price.value = (
        (Number(selected.dataset.price ?? 0) * duration) /
        60
      ).toFixed(2);
  };
  const refresh = () => {
    void loadAvailability(form);
    updatePrice();
  };
  form.querySelector('[name="courtId"]')?.addEventListener('change', refresh);
  form.querySelector('[name="date"]')?.addEventListener('change', refresh);
  form
    .querySelector('[name="durationMinutes"]')
    ?.addEventListener('change', refresh);
  form.querySelector('#quick-customer')?.addEventListener('click', () => {
    const fields = form.querySelector<HTMLElement>('#quick-customer-fields');
    if (fields) fields.hidden = !fields.hidden;
  });
  form
    .querySelector('#create-quick-customer')
    ?.addEventListener('click', async () => {
      const name = String(
          (form.elements.namedItem('quickName') as HTMLInputElement).value,
        ).trim(),
        phone = String(
          (form.elements.namedItem('quickPhone') as HTMLInputElement).value,
        ).trim(),
        error = form.querySelector<HTMLElement>('#quick-customer-error');
      if (!name) {
        if (error) error.textContent = t('reservations.nameRequired');
        return;
      }
      try {
        const customer = await request<Customer>('/customers', {
          method: 'POST',
          body: JSON.stringify({ name, phone: phone || undefined }),
        });
        const select = form.elements.namedItem(
          'customerId',
        ) as HTMLSelectElement;
        select.insertAdjacentHTML(
          'beforeend',
          `<option value="${escapeText(customer.customerId)}">${escapeText(customer.name)}</option>`,
        );
        select.value = customer.customerId;
        const fields = form.querySelector<HTMLElement>(
          '#quick-customer-fields',
        );
        if (fields) fields.hidden = true;
      } catch (errorValue) {
        if (error) error.textContent = errorMessage(errorValue);
      }
    });
  refresh();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      const start = isoFromInputs(
        String(values.date),
        String(values.startTime),
      );
      const end = endIsoFromInputs(
        String(values.date),
        String(values.startTime),
        Number(values.durationMinutes),
      );
      await request('/reservations', {
        method: 'POST',
        body: JSON.stringify({
          courtId: values.courtId,
          customerId: values.customerId,
          startAt: start,
          endAt: end,
          expectedAmount: Number(values.expectedAmount),
          source: values.source,
          notes: values.notes || undefined,
        }),
      });
      closeModal();
      toast(t('reservations.created'));
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
async function openBlockModal(date = today(), courtId?: string) {
  const courts = await request<Court[]>('/courts');
  openModal(
    t('schedule.blockCourt'),
    `<form id="block-form" class="form-grid"><label>${t('common.court')}<select name="courtId" required>${courts.map((c) => `<option value="${escapeText(c.courtId)}" ${c.courtId === courtId ? 'selected' : ''}>${escapeText(c.name)}</option>`).join('')}</select></label><label>${t('common.date')}<input name="date" type="date" value="${escapeText(date)}" required></label><label>${t('common.start')}<input name="start" type="time" value="08:00" required></label><label>${t('common.end')}<input name="end" type="time" value="09:00" required></label><label>${t('common.reason' as never)}<select name="reason"><option>MAINTENANCE</option><option>CLEANING</option><option>PRIVATE_EVENT</option><option>TOURNAMENT</option><option>WEATHER</option><option>STAFF_USE</option><option>OTHER</option></select></label><label class="full">${t('common.notes')}<textarea name="notes"></textarea></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${t('schedule.blockCourt')}</button></div></form>`,
  );
  const form = app.querySelector<HTMLFormElement>('#block-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      await request('/blocks', {
        method: 'POST',
        body: JSON.stringify({
          courtId: values.courtId,
          startAt: isoFromInputs(String(values.date), String(values.start)),
          endAt: isoFromInputs(String(values.date), String(values.end)),
          reason: values.reason,
          notes: values.notes || undefined,
        }),
      });
      closeModal();
      toast(t('schedule.blockCourt'));
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
async function openReservationDetail(id: string) {
  const reservation = await request<Reservation>(`/reservations/${id}`);
  openModal(
    t('reservations.details'),
    `<div class="detail-grid"><div><span class="muted">${t('common.status')}</span><strong>${reservationStatusLabel(reservation.status)}</strong></div><div><span class="muted">${t('common.time')}</span><strong>${escapeText(dateValue(reservation.startAt))} ${escapeText(timeValue(reservation.startAt))}–${escapeText(timeValue(reservation.endAt))}</strong></div><div><span class="muted">${t('common.expected')}</span><strong>${formatMoney(reservation.expectedAmount)}</strong></div><div><span class="muted">${t('common.paid')}</span><strong>${formatMoney(reservation.paidAmount ?? 0)}</strong></div></div><form id="reservation-edit-form" class="form-grid"><label>${t('common.date')}<input name="date" type="date" value="${escapeText(reservation.startAt.slice(0, 10))}" required></label><label>${t('common.start')}<input name="start" type="time" value="${escapeText(reservation.startAt.slice(11, 16))}" required></label><label>${t('common.end')}<input name="end" type="time" value="${escapeText(reservation.endAt.slice(11, 16))}" required></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.close')}</button>${reservation.status === 'CONFIRMED' ? `<button class="button primary">${t('reservations.saveTime')}</button>` : ''}</div></form><div class="row-actions detail-actions">${reservation.status === 'CONFIRMED' ? `${button(t('reservations.complete'), 'data-transition="COMPLETED"')}${button(t('reservations.noShow'), 'data-transition="NO_SHOW"')}${button(t('reservations.cancel'), 'data-transition="CANCELLED"')}${button(t('reservations.recordPayment'), `data-payment="${escapeText(reservation.reservationId)}"`)}` : ''}</div>`,
  );
  const detailGrid = app.querySelector<HTMLElement>('.modal .detail-grid');
  detailGrid?.insertAdjacentHTML(
    'beforeend',
    `<div><span class="muted">${t('common.paymentStatus')}</span><strong>${paymentStatusLabel(reservation.paymentStatus ?? 'UNPAID')}</strong></div>`,
  );
  const detailDate = app.querySelector<HTMLInputElement>(
    '#reservation-edit-form [name="date"]',
  );
  const detailStart = app.querySelector<HTMLInputElement>(
    '#reservation-edit-form [name="start"]',
  );
  const detailEnd = app.querySelector<HTMLInputElement>(
    '#reservation-edit-form [name="end"]',
  );
  if (detailDate) detailDate.value = localDateKey(reservation.startAt);
  if (detailStart) detailStart.value = timeValue(reservation.startAt);
  if (detailEnd) detailEnd.value = timeValue(reservation.endAt);
  const form = app.querySelector<HTMLFormElement>('#reservation-edit-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      await request(`/reservations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          startAt: isoFromInputs(String(values.date), String(values.start)),
          endAt: isoFromInputs(String(values.date), String(values.end)),
        }),
      });
      closeModal();
      toast(t('reservations.updated'));
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
  app.querySelectorAll<HTMLElement>('[data-transition]').forEach((element) =>
    element.addEventListener('click', async () => {
      const status = String(element.dataset.transition);
      if (
        !window.confirm(
          status === 'CANCELLED' ? t('reservations.cancelConfirmation') : status === 'NO_SHOW' ? t('reservations.noShowConfirmation') : t('reservations.completeConfirmation'),
        )
      )
        return;
      try {
        await request(
          `/reservations/${id}/${status === 'CANCELLED' ? 'cancel' : status === 'NO_SHOW' ? 'no-show' : 'complete'}`,
          { method: 'POST' },
        );
        closeModal();
        toast(t('reservations.statusUpdated'));
        await renderRoute();
      } catch (error) {
        toast(errorMessage(error), 'error');
      }
    }),
  );
  app
    .querySelector<HTMLElement>('[data-payment]')
    ?.addEventListener('click', () => void openPaymentModal(reservation));
}
async function schedule() {
  const date = new URLSearchParams(location.search).get('date') ?? today();
  let renderedItems: ScheduleItem[] = [];
  await shell(async () => {
    const data = await request<{ courts: Court[]; items: ScheduleItem[] }>(
      `/schedule?date=${encodeURIComponent(date)}`,
    );
    const displayItems = data.items.map((item) =>
      item.reservationId
        ? {
            ...item,
            status: `${item.customerName ?? t('common.customer')} · ${reservationStatusLabel(item.status)} · ${paymentStatusLabel(item.paymentStatus ?? 'UNPAID')}`,
          }
        : item.classId
          ? { ...item, reason: `${t('schedule.class')} · ${item.name ?? t('schedule.class')}` }
          : item,
    );
    renderedItems = data.items;
    setTimeout(() => {
      screen()
        ?.querySelector('#new-booking')
        ?.addEventListener('click', () => void openReservationModal(date));
      screen()
        ?.querySelector('#block-court')
        ?.addEventListener('click', () => void openBlockModal(date));
      screen()
        ?.querySelectorAll<HTMLElement>('[data-reservation]')
        .forEach((element) =>
          element.addEventListener(
            'click',
            () =>
              void openReservationDetail(String(element.dataset.reservation)),
          ),
        );
      screen()
        ?.querySelectorAll<HTMLElement>('[data-block]')
        .forEach((element) =>
          element.addEventListener('click', async () => {
            if (!window.confirm(t('schedule.cancelBlockConfirmation'))) return;
            try {
              await request(`/blocks/${element.dataset.block}/cancel`, {
                method: 'POST',
              });
              toast(t('schedule.cancelBlock'));
              await renderRoute();
            } catch (error) {
              toast(errorMessage(error), 'error');
            }
          }),
        );
    }, 0);
    return `<div class="toolbar"><div><h2>${t('schedule.title')}</h2><p class="muted">${escapeText(formatDate(`${date}T12:00:00`, timezone()))}</p></div><div class="row-actions"><button class="button" id="previous-day">${t('common.previousDay')}</button><button class="button" id="today">${t('dashboard.today')}</button><button class="button" id="next-day">${t('common.nextDay')}</button><button class="button" id="block-court">${t('schedule.blockCourt')}</button><button class="button primary" id="new-booking">${t('reservations.new')}</button></div></div><div class="schedule-grid">${
      data.courts
        .map((court) => {
          const items = displayItems.filter(
            (item) => item.courtId === court.courtId,
          );
          return `<article class="card court"><h3>${escapeText(court.name)} <small>${escapeText(court.sport)}</small></h3>${items.length ? items.map((item) => (item.reservationId ? `<button class="schedule-item" data-reservation="${escapeText(item.reservationId)}"><strong>${escapeText(timeValue(item.startAt))}–${escapeText(timeValue(item.endAt))}</strong><span>${t('schedule.reservation')} · ${escapeText(item.status)}</span></button>` : `<div class="schedule-item blocked"><strong>${escapeText(timeValue(item.startAt))}–${escapeText(timeValue(item.endAt))}</strong><span>${item.classId ? `${t('schedule.class')} · ${escapeText(item.reason)}` : `${t('schedule.blocked')} · ${blockReasonLabel(item.reason ?? '')}`}</span>${item.blockId ? button(t('schedule.cancelBlock'), `data-block="${escapeText(item.blockId)}"`) : ''}</div>`)).join('') : `<p class="empty">${t('common.available')}</p>`}</article>`;
        })
        .join('') ||
      `<p class="empty">${t('schedule.createCourtHint')}</p>`
    }</div>`;
  });
  screen()
    ?.querySelectorAll<HTMLElement>('[data-reservation]')
    .forEach((element) => {
      const reservation = renderedItems.find(
        (item) => item.reservationId === element.dataset.reservation,
      );
      const strong = element.querySelector('strong');
      if (reservation && strong)
        strong.textContent = `${strong.textContent} — ${reservation.customerName ?? t('common.customer')}`;
    });
  const move = (amount: number) => {
    const next = new Date(`${date}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + amount);
    navigate(`/schedule?date=${next.toISOString().slice(0, 10)}`);
  };
  setTimeout(() => {
    screen()
      ?.querySelector('#previous-day')
      ?.addEventListener('click', () => move(-1));
    screen()
      ?.querySelector('#next-day')
      ?.addEventListener('click', () => move(1));
    screen()
      ?.querySelector('#today')
      ?.addEventListener('click', () => navigate('/schedule'));
  }, 0);
}
async function customers() {
  const query = new URLSearchParams(location.search).get('search') ?? '';
  await shell(async () => {
    const data = await request<Customer[]>(
      `/customers?limit=100${query ? `&search=${encodeURIComponent(query)}` : ''}`,
    );
    setTimeout(wireCustomerList, 0);
    return `<div class="toolbar"><div><h2>${t('customers.title')}</h2><p class="muted">${t('customers.description')}</p></div><button class="button primary" id="add-customer">${t('customers.add')}</button></div><form id="customer-search" class="search-bar"><input name="search" placeholder="${t('customers.searchPlaceholder')}" value="${escapeText(query)}"><button class="button">${t('common.search')}</button></form><article class="card table-wrap">${data.length ? `<table><thead><tr><th>${t('common.name')}</th><th>${t('common.phone')}</th><th>${t('common.email')}</th><th>${t('common.status')}</th><th>${t('common.actions')}</th></tr></thead><tbody>${data.map((c) => `<tr><td>${escapeText(c.name)}</td><td>${escapeText(c.phone)}</td><td>${escapeText(c.email)}</td><td>${c.archived ? t('common.archived') : t('common.active')}</td><td class="row-actions">${button(t('common.edit'), `data-edit-customer="${escapeText(c.customerId)}"`)}${c.archived ? '' : button(t('common.archive'), `data-archive-customer="${escapeText(c.customerId)}"`)}</td></tr>`).join('')}</tbody></table>` : `<p class="empty">${t('customers.noCustomers')}</p>`}</article>`;
  });
}
function wireCustomerList() {
  app
    .querySelector<HTMLButtonElement>('#add-customer')
    ?.addEventListener('click', () => void openCustomerModal());
  app
    .querySelector<HTMLFormElement>('#customer-search')
    ?.addEventListener('submit', (event) => {
      event.preventDefault();
      const values = formData(event.currentTarget as HTMLFormElement);
      navigate(
        `/customers${values.search ? `?search=${encodeURIComponent(String(values.search))}` : ''}`,
      );
    });
  app.querySelectorAll<HTMLElement>('[data-edit-customer]').forEach((element) =>
    element.addEventListener('click', async () => {
      const customer = await request<Customer>(
        `/customers/${element.dataset.editCustomer}`,
      );
      await openCustomerModal(undefined, customer);
    }),
  );
  app
    .querySelectorAll<HTMLElement>('[data-archive-customer]')
    .forEach((element) =>
      element.addEventListener('click', async () => {
        if (!window.confirm(t('customers.archiveConfirmation'))) return;
        try {
          await request(
            `/customers/${element.dataset.archiveCustomer}/archive`,
            { method: 'POST' },
          );
          toast(t('customers.archived'));
          await renderRoute();
        } catch (error) {
          toast(errorMessage(error), 'error');
        }
      }),
    );
  app
    .querySelectorAll<HTMLElement>('[data-edit-customer]')
    .forEach((element) => {
      const actions = element.parentElement;
      if (actions && !actions.querySelector('[data-customer-history]'))
        actions.insertAdjacentHTML(
          'beforeend',
          button(
            t('customers.history'),
            `data-customer-history="${escapeText(element.dataset.editCustomer)}"`,
          ),
        );
    });
  app
    .querySelectorAll<HTMLElement>('[data-customer-history]')
    .forEach((element) =>
      element.addEventListener(
        'click',
        () => void openCustomerHistory(String(element.dataset.customerHistory)),
      ),
    );
}
async function openCustomerHistory(customerId: string) {
  const [customer, reservationsData] = await Promise.all([
    request<Customer>(`/customers/${customerId}`),
    request<Reservation[]>(
      `/reservations?customerId=${encodeURIComponent(customerId)}&limit=100`,
    ),
  ]);
  openModal(
    t('customers.historyTitle', { name: customer.name }),
    `<p class="muted">${escapeText(customer.phone ?? '')} ${escapeText(customer.email ?? '')}</p>${reservationsData.length ? `<div class="table-wrap"><table><thead><tr><th>${t('common.dateTime')}</th><th>${t('common.status')}</th><th>${t('common.expected')}</th><th>${t('common.payment')}</th></tr></thead><tbody>${reservationsData.map((reservation) => `<tr><td>${escapeText(dateValue(reservation.startAt))} ${escapeText(timeValue(reservation.startAt))}</td><td>${reservationStatusLabel(reservation.status)}</td><td>${formatMoney(reservation.expectedAmount)}</td><td>${paymentStatusLabel(reservation.paymentStatus ?? 'UNPAID')}</td></tr>`).join('')}</tbody></table></div>` : `<p class="empty">${t('customers.noHistory')}</p>`}`,
  );
}
async function openRecurringReservationModal() {
  const [courts, customers] = await Promise.all([
    request<Court[]>('/courts'),
    request<Customer[]>('/customers?limit=100'),
  ]);
  openModal(
    t('reservations.recurring'),
    `<form id="recurring-form" class="form-grid"><label>${t('common.court')}<select name="courtId" required>${courts.map((court) => `<option value="${escapeText(court.courtId)}">${escapeText(court.name)}</option>`).join('')}</select></label><label>${t('common.customer')}<select name="customerId" required>${customerOptions(customers)}</select></label><label>${t('reservations.firstDate')}<input name="date" type="date" required value="${escapeText(today())}"></label><label>${t('reservations.untilDate')}<input name="untilDate" type="date" required value="${escapeText(today())}"></label><label>${t('common.startTime')}<input name="time" type="time" required value="18:00"></label><label>${t('common.duration')}<select name="durationMinutes"><option value="30">${t('common.minutes', { count: 30 })}</option><option value="60">${t('common.minutes', { count: 60 })}</option><option value="120">${t('common.minutes', { count: 120 })}</option></select></label><label>${t('reservations.everyWeeks')}<input name="intervalWeeks" type="number" min="1" max="52" value="1" required></label><label>${t('common.source')}<select name="source"><option>STAFF</option><option>PHONE</option><option>WHATSAPP</option><option>WALK_IN</option><option>OTHER</option></select></label><p class="form-error full" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${t('reservations.createRecurring')}</button></div></form>`,
  );
  const form = app.querySelector<HTMLFormElement>('#recurring-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form) return;
    setBusy(form, true);
    try {
      const values = formData(form);
      const startAt = isoFromInputs(String(values.date), String(values.time));
      const endAt = endIsoFromInputs(
        String(values.date),
        String(values.time),
        Number(values.durationMinutes),
      );
      await request('/reservations/recurring', {
        method: 'POST',
        body: JSON.stringify({
          courtId: values.courtId,
          customerId: values.customerId,
          startAt,
          endAt,
          untilDate: values.untilDate,
          intervalWeeks: Number(values.intervalWeeks),
          source: values.source,
        }),
      });
      closeModal();
      toast(t('reservations.recurringCreated'));
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
async function reservations() {
  const data = await request<Reservation[]>('/reservations');
  await shell(async () => {
    setTimeout(() => {
      screen()
        ?.querySelector('#add-reservation')
        ?.addEventListener('click', () => void openReservationModal());
      const actions = screen()?.querySelector('.toolbar');
      if (actions && !actions.querySelector('#add-recurring-reservation')) {
        actions.insertAdjacentHTML(
          'beforeend',
          `<button class="button" id="add-recurring-reservation">${t('reservations.recurring')}</button>`,
        );
        actions
          .querySelector('#add-recurring-reservation')
          ?.addEventListener(
            'click',
            () => void openRecurringReservationModal(),
          );
      }
      screen()
        ?.querySelectorAll<HTMLElement>('[data-reservation]')
        .forEach((element) =>
          element.addEventListener(
            'click',
            () =>
              void openReservationDetail(String(element.dataset.reservation)),
          ),
        );
    }, 0);
    return `<div class="toolbar"><div><h2>${t('reservations.title')}</h2><p class="muted">${t('reservations.description')}</p></div><button class="button primary" id="add-reservation">${t('reservations.new')}</button></div><article class="card table-wrap">${data.length ? `<table><thead><tr><th>${t('common.dateTime')}</th><th>${t('common.court')}</th><th>${t('common.customer')}</th><th>${t('common.status')}</th><th>${t('common.expected')}</th><th>${t('common.actions')}</th></tr></thead><tbody>${data.map((r) => `<tr><td>${escapeText(dateValue(r.startAt))} ${escapeText(timeValue(r.startAt))}–${escapeText(timeValue(r.endAt))}</td><td>${escapeText(r.courtId)}</td><td>${escapeText(r.customerId)}</td><td>${reservationStatusLabel(r.status)} · ${paymentStatusLabel(r.paymentStatus ?? 'UNPAID')}</td><td>${formatMoney(r.expectedAmount)}</td><td>${button(t('common.open' as never), `data-reservation="${escapeText(r.reservationId)}"`)}</td></tr>`).join('')}</tbody></table>` : `<p class="empty">${t('reservations.noReservations')}</p>`}</article>`;
  });
  const rows = screen()?.querySelectorAll<HTMLTableRowElement>('tbody tr');
  rows?.forEach((row, index) => {
    const reservation = data[index];
    if (reservation) {
      const cells = row.querySelectorAll('td');
      if (cells[1])
        cells[1].textContent = reservation.courtName ?? reservation.courtId;
      if (cells[2])
        cells[2].textContent =
          reservation.customerName ?? reservation.customerId;
      if (cells[3])
        cells[3].textContent = `${reservationStatusLabel(reservation.status)} · ${paymentStatusLabel(reservation.paymentStatus ?? 'UNPAID')}`;
    }
  });
}
async function requests() {
  const [data, customers] = await Promise.all([
    request<RequestItem[]>('/requests'),
    request<Customer[]>('/customers?limit=100'),
  ]);
  await shell(async () => {
    setTimeout(() => wireRequests(data, customers), 0);
    return `<div class="toolbar"><div><h2>${t('requests.title')}</h2><p class="muted">${t('requests.pending', { count: data.filter((item) => item.status === 'REQUESTED').length })}</p></div></div><article class="card table-wrap">${data.length ? `<table><thead><tr><th>${t('common.customer')}</th><th>${t('requests.requestedTime')}</th><th>${t('common.court')}</th><th>${t('common.status')}</th><th>${t('common.actions')}</th></tr></thead><tbody>${data.map((item) => `<tr><td>${escapeText(item.customerName)}<small>${escapeText(item.phone)}</small></td><td>${escapeText(dateValue(item.requestedStartAt))} ${escapeText(timeValue(item.requestedStartAt))}–${escapeText(timeValue(item.requestedEndAt))}</td><td>${escapeText(item.courtId)}</td><td>${requestStatusLabel(item.status)}</td><td>${item.status === 'REQUESTED' ? `${button(t('requests.review'), `data-review-request="${escapeText(item.requestId)}"`)}${button(t('requests.confirm'), `data-confirm-request="${escapeText(item.requestId)}"`)}${button(t('requests.reject'), `data-reject-request="${escapeText(item.requestId)}"`)}` : '—'}</td></tr>`).join('')}</tbody></table>` : `<p class="empty">${t('requests.noRequests')}</p>`}</article>`;
  });
}
function wireRequests(data: RequestItem[], customers: Customer[]) {
  app
    .querySelectorAll<HTMLElement>('[data-review-request]')
    .forEach((element) =>
      element.addEventListener('click', () => {
        const item = data.find(
          (value) => value.requestId === element.dataset.reviewRequest,
        );
        if (item)
          openModal(
            t('requests.reviewTitle'),
            `<div class="detail-grid"><div><span class="muted">${t('common.customer')}</span><strong>${escapeText(item.customerName)}</strong></div><div><span class="muted">${t('requests.contact')}</span><strong>${escapeText(item.phone)} ${escapeText(item.email)}</strong></div><div><span class="muted">${t('requests.requested')}</span><strong>${escapeText(dateValue(item.requestedStartAt))} ${escapeText(timeValue(item.requestedStartAt))}–${escapeText(timeValue(item.requestedEndAt))}</strong></div></div><p>${escapeText(item.notes || t('common.noNotes'))}</p>`,
          );
      }),
    );
  app
    .querySelectorAll<HTMLElement>('[data-confirm-request]')
    .forEach((element) =>
      element.addEventListener('click', () => {
        const item = data.find(
          (value) => value.requestId === element.dataset.confirmRequest,
        );
        if (item) openConfirmRequest(item, customers);
      }),
    );
  app
    .querySelectorAll<HTMLElement>('[data-reject-request]')
    .forEach((element) =>
      element.addEventListener(
        'click',
        () => void rejectRequest(String(element.dataset.rejectRequest)),
      ),
    );
}
function openConfirmRequest(item: RequestItem, customers: Customer[]) {
  openModal(
    t('requests.confirmTitle'),
    `<form id="confirm-request-form" class="form-grid"><p class="full">${escapeText(item.customerName)} · ${escapeText(dateValue(item.requestedStartAt))} ${escapeText(timeValue(item.requestedStartAt))}</p><label class="full">${t('common.customer')}<select name="customerId"><option value="">${t('requests.createCustomer')}</option>${customerOptions(customers, item.linkedCustomerId)}</select></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${t('requests.confirmButton')}</button></div></form>`,
  );
  const form = app.querySelector<HTMLFormElement>('#confirm-request-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      await request(`/requests/${item.requestId}/confirm`, {
        method: 'POST',
        body: JSON.stringify(
          values.customerId ? { customerId: values.customerId } : {},
        ),
      });
      closeModal();
      toast(t('requests.confirmed'));
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
async function rejectRequest(id: string) {
  openModal(
    t('requests.rejectTitle'),
    `<form id="reject-request-form" class="form-grid"><label class="full">${t('common.reason' as never)}<textarea name="reason" maxlength="1000"></textarea></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button danger">${t('requests.rejectButton')}</button></div></form>`,
  );
  const form = app.querySelector<HTMLFormElement>('#reject-request-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!window.confirm(t('requests.rejectConfirmation'))) return;
    setBusy(form, true);
    try {
      const values = formData(form);
      await request(`/requests/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: values.reason || undefined }),
      });
      closeModal();
      toast(t('requests.rejected'));
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
async function openPaymentModal(reservation?: Reservation) {
  const reservationsData = reservation
    ? [reservation]
    : await request<Reservation[]>('/reservations');
  const customers = await request<Customer[]>('/customers?limit=100');
  openModal(
    t('finance.record'),
    `<form id="payment-form" class="form-grid"><label class="full">${t('common.reservation' as never)}<select name="reservationId" required>${reservationsData.map((r) => `<option value="${escapeText(r.reservationId)}" data-customer="${escapeText(r.customerId)}" data-remaining="${escapeText(r.remainingAmount ?? r.expectedAmount)}">${escapeText(dateValue(r.startAt))} ${escapeText(timeValue(r.startAt))} · ${formatMoney(r.expectedAmount)}</option>`).join('')}</select></label><label>${t('common.customer')}<select name="customerId" required>${customerOptions(customers, reservation?.customerId)}</select></label><label>${t('common.price')}<input name="amount" type="number" min="0" step="0.01" required value="${escapeText(reservation?.remainingAmount ?? '')}"></label><label>${t('common.payment')}<select name="method"><option value="PIX">${paymentMethodLabel('PIX')}</option><option value="CASH">${paymentMethodLabel('CASH')}</option><option value="CREDIT_CARD">${paymentMethodLabel('CREDIT_CARD')}</option><option value="DEBIT_CARD">${paymentMethodLabel('DEBIT_CARD')}</option><option value="BANK_TRANSFER">${paymentMethodLabel('BANK_TRANSFER')}</option><option value="OTHER">${paymentMethodLabel('OTHER')}</option></select></label><label>${t('finance.paidAt')}<input name="paidAt" type="datetime-local" required value="${escapeText(new Date().toISOString().slice(0, 16))}"></label><label class="full">${t('common.notes')}<textarea name="notes"></textarea></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${t('finance.record')}</button></div></form>`,
  );
  const form = app.querySelector<HTMLFormElement>('#payment-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form
    ?.querySelector('[name="reservationId"]')
    ?.addEventListener('change', (event) => {
      const option = (event.target as HTMLSelectElement).selectedOptions[0];
      if (!option) return;
      const customer = form.elements.namedItem(
        'customerId',
      ) as HTMLSelectElement;
      customer.value = String(option.dataset.customer ?? '');
      const amount = form.elements.namedItem('amount') as HTMLInputElement;
      amount.value = String(option.dataset.remaining ?? '');
    });
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const currentForm = event.currentTarget as HTMLFormElement;
    setBusy(currentForm, true);
    try {
      const values = formData(currentForm);
      await request('/payments', {
        method: 'POST',
        body: JSON.stringify({
          ...values,
          amount: Number(values.amount),
          paidAt: new Date(String(values.paidAt)).toISOString(),
        }),
      });
      closeModal();
      toast(t('finance.paymentRecorded'));
      await renderRoute();
    } catch (error) {
      showFormError(currentForm, error);
      setBusy(currentForm, false);
    }
  });
}
async function finance() {
  const data = await request<Payment[]>('/payments');
  await shell(async () => {
    setTimeout(() => {
      screen()
        ?.querySelector('#record-payment')
        ?.addEventListener('click', () => void openPaymentModal());
      screen()
        ?.querySelectorAll<HTMLElement>('[data-delete-payment]')
        .forEach((element) =>
          element.addEventListener('click', async () => {
            if (!window.confirm(t('finance.deleteConfirmation'))) return;
            try {
              await request(`/payments/${element.dataset.deletePayment}`, {
                method: 'DELETE',
              });
              toast(t('finance.deleted'));
              await renderRoute();
            } catch (error) {
              toast(errorMessage(error), 'error');
            }
          }),
        );
    }, 0);
    return `<div class="toolbar"><div><h2>${t('finance.title')}</h2><p class="muted">${t('finance.description')}</p></div><button class="button primary" id="record-payment">${t('finance.record')}</button></div><article class="card table-wrap">${data.length ? `<table><thead><tr><th>${t('finance.paidAt')}</th><th>${t('common.price')}</th><th>${t('common.payment')}</th><th>${t('finance.reservationClass')}</th><th>${t('common.actions')}</th></tr></thead><tbody>${data.map((p) => `<tr><td>${escapeText(dateValue(p.paidAt))}</td><td>${formatMoney(p.amount)}</td><td>${paymentMethodLabel(p.method)}</td><td>${escapeText(p.reservationId ?? p.classId)}</td><td>${button(t('common.delete'), `data-delete-payment="${escapeText(p.paymentId)}"`)}</td></tr>`).join('')}</tbody></table>` : `<p class="empty">${t('finance.noPayments')}</p>`}</article>`;
  });
}
async function classes() {
  const org = await request<Organization>('/organization');
  const data = await request<SportClass[]>('/classes');
  const courts = await request<Court[]>('/courts');
  const customers = await request<Customer[]>('/customers?limit=100');
  await shell(async () => {
    setTimeout(() => wireClasses(data, customers), 0);
    return `<div class="toolbar"><div><h2>${t('classes.title')}</h2><p class="muted">${t('classes.description')}</p></div>${org.features.classes ? `<button class="button primary" id="add-class">${t('classes.add')}</button>` : ''}</div>${org.features.classes ? `<article class="card table-wrap">${data.length ? `<table><thead><tr><th>${t('common.name')}</th><th>${t('common.sport')}</th><th>${t('common.schedule' as never)}</th><th>${t('classes.capacity' as never)}</th><th>${t('common.actions')}</th></tr></thead><tbody>${data.map((c) => `<tr><td>${escapeText(c.name)}</td><td>${escapeText(c.sport)}</td><td>${escapeText(c.startDate)} ${escapeText(c.startTime)}</td><td>${c.capacity}</td><td>${button(t('classes.enroll'), `data-enroll-class="${escapeText(c.classId)}"`)} ${button(t('classes.attendance'), `data-attendance-class="${escapeText(c.classId)}"`)}</td></tr>`).join('')}</tbody></table>` : `<p class="empty">${t('classes.noClasses' as never)}</p>`}</article>` : `<article class="card"><h3>${t('classes.disabled')}</h3><p class="empty">${t('classes.enableHint')}</p><a class="button" href="/settings">${t('classes.openSettings')}</a></article>`}`;
  });
  if (org.features.classes)
    setTimeout(() => {
      screen()
        ?.querySelector('#add-class')
        ?.addEventListener('click', () => void openClassModal(courts));
    }, 0);
}
function classForm(courts: Court[]) {
  return `<form id="class-form" class="form-grid"><label>${t('common.name')}<input name="name" required></label><label>${t('common.sport')}<input name="sport" required></label><label>${t('common.court')}<select name="courtId" required>${courts.map((c) => `<option value="${escapeText(c.courtId)}">${escapeText(c.name)}</option>`).join('')}</select></label><label>${t('classes.capacity')}<input name="capacity" type="number" min="1" required value="10"></label><label>${t('common.price')}<input name="price" type="number" min="0" step="0.01" required value="0"></label><label>${t('common.weekday' as never)}<select name="weekday">${[0, 1, 2, 3, 4, 5, 6].map((day) => `<option value="${day}">${weekdayLabel(day)}</option>`).join('')}</select></label><label>${t('common.startTime')}<input name="startTime" type="time" required value="18:00"></label><label>${t('common.duration')}<input name="durationMinutes" type="number" min="30" required value="60"></label><label>${t('common.start')} ${t('common.date')}<input name="startDate" type="date" required value="${today()}"></label><label>${t('common.end')} ${t('common.date')}<input name="endDate" type="date" value="${today()}"></label><label class="full">${t('common.notes')}<textarea name="notes"></textarea></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${t('classes.create')}</button></div></form>`;
}
function openClassModal(courts: Court[]) {
  openModal(t('classes.add'), classForm(courts));
  const form = app.querySelector<HTMLFormElement>('#class-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      await request('/classes', {
        method: 'POST',
        body: JSON.stringify({
          name: values.name,
          sport: values.sport,
          coachId: session()?.user.userId,
          courtId: values.courtId,
          capacity: Number(values.capacity),
          price: Number(values.price),
          weekday: Number(values.weekday),
          startTime: values.startTime,
          durationMinutes: Number(values.durationMinutes),
          startDate: values.startDate,
          endDate: values.endDate || undefined,
          notes: values.notes || undefined,
        }),
      });
      closeModal();
      toast(t('classes.created'));
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
function openEnrollmentModal(
  classId: string,
  customers: Customer[],
  returnFocus: HTMLElement,
) {
  openModal(
    t('classes.enrollCustomer'),
    `<form id="enroll-form" class="form-grid"><label class="full">${t('common.customer')}<select name="customerId" required>${customerOptions(customers)}</select></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${t('classes.enroll')}</button></div></form>`,
    returnFocus,
  );
  const form = app.querySelector<HTMLFormElement>('#enroll-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      await request(`/classes/${classId}/enroll`, {
        method: 'POST',
        body: JSON.stringify({ customerId: values.customerId }),
      });
      closeModal();
      toast(t('classes.enrolled'));
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
function wireClasses(data: SportClass[], customers: Customer[]) {
  void data;
  app
    .querySelectorAll<HTMLElement>('[data-enroll-class]')
    .forEach((element) =>
      element.addEventListener('click', () =>
        openEnrollmentModal(
          String(element.dataset.enrollClass),
          customers,
          element,
        ),
      ),
    );
  app
    .querySelectorAll<HTMLElement>('[data-attendance-class]')
    .forEach((element) =>
      element.addEventListener('click', () =>
        openAttendanceModal(String(element.dataset.attendanceClass), customers),
      ),
    );
}
function openAttendanceModal(classId: string, customers: Customer[]) {
  openModal(
    t('classes.recordAttendance'),
    `<form id="attendance-form" class="form-grid"><input type="hidden" name="classId" value="${escapeText(classId)}"><label class="full">${t('common.customer')}<select name="customerId" required>${customerOptions(customers)}</select></label><label>${t('common.date')}<input name="date" type="date" required value="${today()}"></label><label>${t('common.status')}<select name="status"><option value="PRESENT">${attendanceStatusLabel('PRESENT')}</option><option value="ABSENT">${attendanceStatusLabel('ABSENT')}</option><option value="EXCUSED">${attendanceStatusLabel('EXCUSED')}</option></select></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${t('classes.saveAttendance')}</button></div></form>`,
  );
  const form = app.querySelector<HTMLFormElement>('#attendance-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      await request('/classes/attendance', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      closeModal();
      toast(t('classes.attendanceSaved'));
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
async function reports() {
  await shell(async () => {
    const data = await request<Record<string, unknown>>('/reports/summary');
    return `<div class="toolbar"><h2>${t('reports.title')}</h2></div><article class="card"><div class="metrics"><div class="metric"><span>${t('dashboard.reservations')}</span><strong>${data.reservationCount}</strong></div><div class="metric"><span>${t('dashboard.expectedRevenue')}</span><strong>${formatMoney(Number(data.expectedRevenue))}</strong></div><div class="metric"><span>${t('finance.recorded' as never)}</span><strong>${formatMoney(Number(data.recordedPayments))}</strong></div></div></article>`;
  });
}
async function render() {
  const path = location.pathname;
  if (path === '/login') {
    login();
    return;
  }
  if (!session()) {
    login();
    return;
  }
  try {
    if (path === '/' || path === '/dashboard') await dashboard();
    else if (path === '/schedule') await schedule();
    else if (path === '/settings') await settings();
    else if (path === '/customers') await customers();
    else if (path === '/reservations') await reservations();
    else if (path === '/requests') await requests();
    else if (path === '/finance') await finance();
    else if (path === '/classes') await classes();
    else if (path === '/reports') await reports();
    else await dashboard();
  } catch (error) {
    const target = screen();
    if (target)
      target.innerHTML = `<article class="card error-state"><h2>${t('errors.couldNotLoad')}</h2><p>${escapeText(errorMessage(error))}</p><button class="button" onclick="location.reload()">${t('common.tryAgain')}</button></article>`;
  }
}
async function publicBooking(slug: string) {
  try {
    const venue = await request<{
      name: string;
      timezone: string;
      courts: {
        courtId: string;
        name: string;
        sport: string;
        slotMinutes: number;
      }[];
    }>(`/public/venues/${encodeURIComponent(slug)}`);
      app.innerHTML = `<main class="login"><section class="card public-booking"><div class="public-head"><h1>${escapeText(venue.name)}</h1>${languageSelector()}</div><p class="muted">${t('public.title')}</p><form id="public-form"><label>${t('common.court')}<select name="courtId" required>${venue.courts.map((court) => `<option value="${escapeText(court.courtId)}">${escapeText(court.name)} — ${escapeText(court.sport)}</option>`).join('')}</select></label><label>${t('common.date')}<input type="date" name="date" required></label><label>${t('common.startTime')}<input type="time" name="time" required></label><label>${t('common.duration')}<select name="durationMinutes"><option value="30">${t('common.minutes', { count: 30 })}</option><option value="60">${t('common.minutes', { count: 60 })}</option><option value="120">${t('common.hours', { count: 2 })}</option></select></label><label>${t('common.name')}<input name="customerName" required></label><label>${t('common.phone')}<input name="phone" required></label><label>${t('common.email')} (${t('common.optional')})<input name="email" type="email"></label><label>${t('common.notes')} (${t('common.optional')})<textarea name="notes"></textarea></label><p class="notice">${t('public.disclaimer')}</p><button class="button primary">${t('public.sendRequest')}</button><p id="public-result" role="status"></p></form></section></main>`;
      wireLanguageSelector();
      localizeEnumOptions(app);
    const publicForm = app.querySelector<HTMLFormElement>('#public-form');
    const publicTime = publicForm?.elements.namedItem(
      'time',
    ) as HTMLInputElement | null;
    publicTime?.replaceWith(
      Object.assign(document.createElement('select'), {
        name: 'time',
        required: true,
        innerHTML: `<option value="">${t('common.loading')}</option>`,
      }),
    );
    const loadPublicAvailability = async () => {
      if (!publicForm) return;
      const courtId = String(
        (publicForm.elements.namedItem('courtId') as HTMLSelectElement).value,
      );
      const date = String(
        (publicForm.elements.namedItem('date') as HTMLInputElement).value,
      );
      const duration = String(
        (publicForm.elements.namedItem('durationMinutes') as HTMLSelectElement)
          .value,
      );
      const start = publicForm.elements.namedItem('time') as HTMLSelectElement;
      start.innerHTML = `<option>${t('common.loading')}</option>`;
      try {
        const data = await request<{ available: string[] }>(
          `/public/venues/${encodeURIComponent(slug)}/availability?courtId=${encodeURIComponent(courtId)}&date=${encodeURIComponent(date)}&durationMinutes=${duration}`,
        );
        start.innerHTML = data.available.length
          ? data.available
              .map(
                (value) =>
                  `<option value="${escapeText(value)}">${escapeText(value)}</option>`,
              )
              .join('')
          : `<option value="">${t('common.noAvailableTimes')}</option>`;
      } catch (error) {
        start.innerHTML = `<option value="">${escapeText(errorMessage(error))}</option>`;
      }
    };
    publicForm
      ?.querySelector('[name="courtId"]')
      ?.addEventListener('change', () => void loadPublicAvailability());
    publicForm
      ?.querySelector('[name="date"]')
      ?.addEventListener('change', () => void loadPublicAvailability());
    publicForm
      ?.querySelector('[name="durationMinutes"]')
      ?.addEventListener('change', () => void loadPublicAvailability());
    void loadPublicAvailability();
    app
      .querySelector<HTMLFormElement>('#public-form')
      ?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const values = formData(form);
        const start = isoFromInputs(
            String(values.date),
            String(values.time),
            venue.timezone,
          ),
          end = endIsoFromInputs(
            String(values.date),
            String(values.time),
            Number(values.durationMinutes),
            venue.timezone,
          );
        const result = app.querySelector('#public-result')!;
        try {
          await request(`/public/venues/${encodeURIComponent(slug)}/requests`, {
            method: 'POST',
            body: JSON.stringify({
              courtId: values.courtId,
              requestedStartAt: start,
              requestedEndAt: end,
              customerName: values.customerName,
              phone: values.phone,
              email: values.email || undefined,
              notes: values.notes || undefined,
            }),
          });
          result.textContent = t('public.requestSent');
          form.reset();
        } catch (error) {
          result.textContent = errorMessage(error);
        }
      });
  } catch (error) {
    app.innerHTML = `<main class="login"><article class="card error-state"><div class="public-head"><h2>${t('errors.venueUnavailable')}</h2>${languageSelector()}</div><p>${escapeText(errorMessage(error))}</p></article></main>`;
    wireLanguageSelector();
  }
}
const renderRoute = async () => {
  if (location.pathname.startsWith('/book/'))
    await publicBooking(location.pathname.split('/')[2] ?? '');
  else await render();
};
window.addEventListener('popstate', () => void renderRoute());
void renderRoute();
