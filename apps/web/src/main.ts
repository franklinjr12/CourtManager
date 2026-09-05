import './styles.css';

type Session = {
  token: string;
  user: { userId: string; name: string; role: string };
  organization?: { name: string; features?: { classes: boolean; finance: boolean } };
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
  active: boolean;
  publiclyRequestable: boolean;
  slotMinutes: 30 | 60;
  defaultHourlyPrice: number;
  openingHours: OpeningHours;
  notes?: string;
  archivedAt?: string;
};
type Customer = {
  customerId: string;
  name: string;
  phone?: string;
  email?: string;
  archived: boolean;
  notes?: string;
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
type ScheduleItem = Reservation & { blockId?: string; reason?: string };

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';
const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('App root missing');
const app = root;
const escapeText = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
const session = () =>
  JSON.parse(localStorage.getItem('court-manager-session') ?? 'null') as Session | null;
const setSession = (value: Session | null) =>
  value
    ? localStorage.setItem('court-manager-session', JSON.stringify(value))
    : localStorage.removeItem('court-manager-session');
const formatMoney = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n) || 0);
const today = () => new Date().toISOString().slice(0, 10);
const isoFromInputs = (date: string, time: string) => new Date(`${date}T${time}:00`).toISOString();
const timeValue = (date: string) =>
  new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dateValue = (date: string) => new Date(date).toLocaleDateString();
const errorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : 'Request failed';
  if (message === 'SCHEDULE_CONFLICT')
    return 'This time is no longer available. Choose another time.';
  return message;
};
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
    throw new Error(
      payload.error?.code === 'SCHEDULE_CONFLICT'
        ? 'SCHEDULE_CONFLICT'
        : (payload.error?.message ?? 'Request failed'),
    );
  return payload.data as T;
};
const navigate = (path: string) => {
  history.pushState({}, '', path);
  void renderRoute();
};
const renderToast = (message: string, kind: 'success' | 'error' = 'success') => {
  app.querySelector('.toast')?.remove();
  app.insertAdjacentHTML(
    'beforeend',
    `<div class="toast ${kind}" role="status">${escapeText(message)}</div>`,
  );
  window.setTimeout(() => app.querySelector('.toast')?.remove(), 3500);
};
const toast = (message: string, kind: 'success' | 'error' = 'success') => {
  sessionStorage.setItem('court-manager-toast', JSON.stringify({ message, kind }));
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
    `<div class="modal-backdrop" role="presentation"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">${escapeText(title)}</h2><button type="button" class="icon-button" data-close aria-label="Close">×</button></div><div class="modal-body">${body}</div></section></div>`,
  );
  const backdrop = app.querySelector('.modal-backdrop');
  backdrop?.addEventListener('click', (event) => {
    if (event.target === backdrop) closeModal();
  });
  backdrop?.querySelector<HTMLElement>('[data-close]')?.addEventListener('click', closeModal);
  modalKeyHandler = (event) => {
    if (event.key === 'Escape') closeModal();
  };
  document.addEventListener('keydown', modalKeyHandler);
  backdrop?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
};
const formData = (form: HTMLFormElement) => Object.fromEntries(new FormData(form).entries());
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
const days = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const defaultHours = (): OpeningHours =>
  Object.fromEntries(days.map((day) => [day, { open: '07:00', close: '23:00' }]));
const hourFields = (hours: OpeningHours) =>
  days
    .map((day) => {
      const value = hours[day] ?? { open: '07:00', close: '23:00' };
      return `<div class="hour-row"><strong>${day}</strong><label>Open<input name="open-${day}" type="time" value="${escapeText(value.open)}" required></label><label>Close<input name="close-${day}" type="time" value="${escapeText(value.close)}" required></label></div>`;
    })
    .join('');
const courtForm = (court?: Court) => {
  const hours = court?.openingHours ?? defaultHours();
  return `<form id="court-form" class="form-grid"><label>Name<input name="name" required maxlength="100" value="${escapeText(court?.name)}"></label><label>Sport<input name="sport" required maxlength="80" value="${escapeText(court?.sport)}"></label><label>Hourly price<input name="defaultHourlyPrice" type="number" min="0" step="0.01" required value="${escapeText(court?.defaultHourlyPrice ?? 80)}"></label><label>Slot size<select name="slotMinutes"><option value="30" ${court?.slotMinutes === 30 ? 'selected' : ''}>30 minutes</option><option value="60" ${court?.slotMinutes === 60 ? 'selected' : ''}>60 minutes</option></select></label><label class="check"><input name="publiclyRequestable" type="checkbox" ${court?.publiclyRequestable !== false ? 'checked' : ''}> Public booking enabled</label><label class="check"><input name="active" type="checkbox" ${court?.active !== false ? 'checked' : ''}> Active</label><label class="full">Notes<textarea name="notes" maxlength="2000">${escapeText(court?.notes)}</textarea></label><fieldset class="full"><legend>Opening hours</legend>${hourFields(hours)}</fieldset><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>Cancel</button><button class="button primary">${court ? 'Save changes' : 'Add court'}</button></div></form>`;
};
const customerForm = (customer?: Customer) =>
  `<form id="customer-form" class="form-grid"><label>Name<input name="name" required maxlength="160" value="${escapeText(customer?.name)}"></label><label>Phone<input name="phone" maxlength="40" value="${escapeText(customer?.phone)}"></label><label>Email<input name="email" type="email" value="${escapeText(customer?.email)}"></label><label class="full">Notes<textarea name="notes" maxlength="4000">${escapeText(customer?.notes)}</textarea></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>Cancel</button><button class="button primary">${customer ? 'Save changes' : 'Create customer'}</button></div></form>`;
const organizationForm = (org: Organization) =>
  `<form id="organization-form" class="form-grid"><label>Name<input name="name" required maxlength="160" value="${escapeText(org.name)}"></label><label>Public slug<input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value="${escapeText(org.slug)}"></label><label>Timezone<input name="timezone" required value="${escapeText(org.timezone)}"></label><label>Currency<input name="currency" required maxlength="3" value="${escapeText(org.currency)}"></label><label>Phone<input name="phone" value="${escapeText(org.phone)}"></label><label>Email<input name="email" type="email" value="${escapeText(org.email)}"></label><label class="check full"><input name="classes" type="checkbox" ${org.features.classes ? 'checked' : ''}> Enable classes</label><p class="form-error" role="alert"></p><div class="form-actions full"><button class="button primary">Save organization</button></div></form>`;

function login() {
  app.innerHTML = `<main class="login"><form id="login-form" class="card"><h1>Court Manager</h1><p class="muted">Sign in to manage your courts.</p><label>Email<input name="email" type="email" required autocomplete="email"></label><label>Password<input name="password" type="password" required autocomplete="current-password"></label><button class="button primary">Sign in</button><p id="login-error" class="error" role="alert"></p></form></main>`;
  app.querySelector<HTMLFormElement>('#login-form')?.addEventListener('submit', async (event) => {
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
  app.innerHTML = `<div class="shell"><aside><h1>Court Manager</h1><nav><a href="/dashboard">Dashboard</a><a href="/schedule">Schedule</a><a href="/requests">Requests</a><a href="/reservations">Reservations</a><a href="/customers">Customers</a><a href="/finance">Finance</a><a href="/classes">Classes</a><a href="/reports">Reports</a><a href="/settings">Settings</a></nav><button id="logout" class="link-button">Log out</button></aside><main class="content"><header><span>${escapeText(current.organization?.name ?? 'Sports center')}</span><span>${escapeText(current.user.name)}</span></header><section id="screen"><div class="loading">Loading…</div></section></main></div>`;
  const queuedToast = sessionStorage.getItem('court-manager-toast');
  if (queuedToast) {
    sessionStorage.removeItem('court-manager-toast');
    const queued = JSON.parse(queuedToast) as { message: string; kind: 'success' | 'error' };
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
  if (target) target.innerHTML = await content();
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
    return `<div class="toolbar"><div><h2>Today</h2><p class="muted">Operational overview</p></div><a class="button primary" href="/schedule">Open schedule</a></div><div class="metrics"><article class="metric card"><span>Reservations</span><strong>${data.reservationsToday}</strong></article><article class="metric card"><span>Pending requests</span><strong>${data.pendingRequests}</strong></article><article class="metric card"><span>Expected revenue</span><strong>${formatMoney(data.expectedRevenue)}</strong></article><article class="metric card"><span>Outstanding</span><strong>${formatMoney(data.outstanding)}</strong></article></div><article class="card"><h3>Upcoming</h3>${data.upcoming.length ? `<ul>${data.upcoming.map((item) => `<li>${escapeText(timeValue(item.startAt))} — ${formatMoney(item.expectedAmount)}</li>`).join('')}</ul>` : '<p class="empty">No reservations yet today.</p>'}</article>`;
  });
}
function openingHoursFrom(form: HTMLFormElement) {
  return Object.fromEntries(
    days.map((day) => [
      day,
      {
        open: String((form.elements.namedItem(`open-${day}`) as HTMLInputElement).value),
        close: String((form.elements.namedItem(`close-${day}`) as HTMLInputElement).value),
      },
    ]),
  );
}
async function openCourtModal(court?: Court) {
  openModal(court ? 'Edit court' : 'Add court', courtForm(court));
  const form = app.querySelector<HTMLFormElement>('#court-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
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
      toast(court ? 'Court updated.' : 'Court added.');
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
async function settings() {
  await shell(async () => {
    const [org, courts] = await Promise.all([
      request<Organization>('/organization'),
      request<Court[]>('/courts?includeArchived=true'),
    ]);
    setTimeout(wireSettings, 0);
    return `<div class="toolbar"><div><h2>Settings</h2><p class="muted">Manage organization and courts.</p></div><button class="button primary" id="add-court">Add court</button></div><article class="card"><h3>Organization</h3>${organizationForm(org)}</article><article class="card section-card"><div class="section-head"><div><h3>Courts</h3><p class="muted">${courts.filter((c) => !c.archivedAt).length} active · ${courts.filter((c) => c.archivedAt).length} archived</p></div></div><div class="court-list">${courts.length ? courts.map((c) => `<article class="list-row ${c.archivedAt ? 'archived' : ''}"><div><strong>${escapeText(c.name)}</strong><span>${escapeText(c.sport)} · ${formatMoney(c.defaultHourlyPrice)}/hour · ${c.slotMinutes} min</span><small>${c.archivedAt ? 'Archived' : c.active ? 'Active' : 'Inactive'} · ${c.publiclyRequestable ? 'Public booking enabled' : 'Private'}</small></div><div class="row-actions">${button('Edit', `data-edit-court="${escapeText(c.courtId)}"`)}${c.archivedAt ? button('Restore', `data-restore-court="${escapeText(c.courtId)}"`) : button('Archive', `data-archive-court="${escapeText(c.courtId)}"`)}</div></article>`).join('') : '<p class="empty">No courts yet. Add first court.</p>'}</div></article>`;
  });
}
function wireSettings() {
  app
    .querySelector<HTMLButtonElement>('#add-court')
    ?.addEventListener('click', () => void openCourtModal(undefined));
  app.querySelectorAll<HTMLElement>('[data-edit-court]').forEach((element) =>
    element.addEventListener('click', async () => {
      const court = await request<Court>(`/courts/${element.dataset.editCourt}`);
      await openCourtModal(court);
    }),
  );
  app.querySelectorAll<HTMLElement>('[data-archive-court]').forEach((element) =>
    element.addEventListener('click', async () => {
      if (!window.confirm('Archive this court? Existing history will remain.')) return;
      try {
        await request(`/courts/${element.dataset.archiveCourt}/archive`, { method: 'POST' });
        toast('Court archived.');
        await renderRoute();
      } catch (error) {
        toast(errorMessage(error), 'error');
      }
    }),
  );
  app.querySelectorAll<HTMLElement>('[data-restore-court]').forEach((element) =>
    element.addEventListener('click', async () => {
      try {
        await request(`/courts/${element.dataset.restoreCourt}/restore`, { method: 'POST' });
        toast('Court restored.');
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
        toast('Organization saved.');
        setBusy(form, false);
      } catch (error) {
        showFormError(form, error);
        setBusy(form, false);
      }
    });
}
async function loadAvailability(form: HTMLFormElement) {
  const court = String((form.elements.namedItem('courtId') as HTMLSelectElement)?.value ?? ''),
    date = String((form.elements.namedItem('date') as HTMLInputElement)?.value ?? ''),
    duration = String(
      (form.elements.namedItem('durationMinutes') as HTMLSelectElement)?.value ?? '30',
    ),
    start = form.elements.namedItem('startTime') as HTMLSelectElement;
  if (!court || !date) return;
  start.innerHTML = '<option>Loading…</option>';
  try {
    const data = await request<{ available: string[] }>(
      `/availability?courtId=${encodeURIComponent(court)}&date=${encodeURIComponent(date)}&durationMinutes=${duration}`,
    );
    start.innerHTML = data.available.length
      ? data.available
          .map((value) => `<option value="${escapeText(value)}">${escapeText(value)}</option>`)
          .join('')
      : '<option value="">No available times</option>';
  } catch (error) {
    start.innerHTML = `<option value="">${escapeText(errorMessage(error))}</option>`;
  }
}
async function openCustomerModal(onCreated?: (customer: Customer) => void, customer?: Customer) {
  openModal(customer ? 'Edit customer' : 'Create customer', customerForm(customer));
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
      toast(customer ? 'Customer updated.' : 'Customer created.');
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
  const body = `<form id="reservation-form" class="form-grid"><label>Court<select name="courtId" required>${courts.map((c) => `<option value="${escapeText(c.courtId)}" data-price="${c.defaultHourlyPrice}" ${c.courtId === prefill?.courtId ? 'selected' : ''}>${escapeText(c.name)} — ${escapeText(c.sport)}</option>`).join('')}</select></label><label>Date<input name="date" type="date" required value="${escapeText(prefill?.startAt ? startDate.toISOString().slice(0, 10) : date)}"></label><label>Duration<select name="durationMinutes"><option value="30">30 minutes</option><option value="60">60 minutes</option></select></label><label>Start time<select name="startTime" required><option>Loading…</option></select></label><label class="full">Customer<select name="customerId" required>${customerOptions(customers)}</select><button type="button" class="button small" id="quick-customer">+ New customer</button></label><div id="quick-customer-fields" class="inline-panel full" hidden><label>Name<input name="quickName" maxlength="160"></label><label>Phone<input name="quickPhone" maxlength="40"></label><button type="button" class="button small" id="create-quick-customer">Create customer</button><p class="form-error" id="quick-customer-error" role="alert"></p></div><label>Expected amount<input name="expectedAmount" type="number" min="0" step="0.01" required></label><label>Source<select name="source"><option>STAFF</option><option>PHONE</option><option>WHATSAPP</option><option>WALK_IN</option><option>OTHER</option></select></label><label class="full">Notes<textarea name="notes" maxlength="4000"></textarea></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>Cancel</button><button class="button primary">Save reservation</button></div></form>`;
  openModal('New reservation', body);
  const form = app.querySelector<HTMLFormElement>('#reservation-form');
  if (!form) return;
  form.querySelector('[data-close]')?.addEventListener('click', closeModal);
  const updatePrice = () => {
    const selected = form.querySelector<HTMLSelectElement>('[name="courtId"]')?.selectedOptions[0];
    const duration = Number(
      (form.elements.namedItem('durationMinutes') as HTMLSelectElement)?.value ?? 30,
    );
    const price = form.elements.namedItem('expectedAmount') as HTMLInputElement;
    if (selected) price.value = ((Number(selected.dataset.price ?? 0) * duration) / 60).toFixed(2);
  };
  const refresh = () => {
    void loadAvailability(form);
    updatePrice();
  };
  form.querySelector('[name="courtId"]')?.addEventListener('change', refresh);
  form.querySelector('[name="date"]')?.addEventListener('change', refresh);
  form.querySelector('[name="durationMinutes"]')?.addEventListener('change', refresh);
  form.querySelector('#quick-customer')?.addEventListener('click', () => {
    const fields = form.querySelector<HTMLElement>('#quick-customer-fields');
    if (fields) fields.hidden = !fields.hidden;
  });
  form.querySelector('#create-quick-customer')?.addEventListener('click', async () => {
    const name = String((form.elements.namedItem('quickName') as HTMLInputElement).value).trim(),
      phone = String((form.elements.namedItem('quickPhone') as HTMLInputElement).value).trim(),
      error = form.querySelector<HTMLElement>('#quick-customer-error');
    if (!name) {
      if (error) error.textContent = 'Name is required.';
      return;
    }
    try {
      const customer = await request<Customer>('/customers', {
        method: 'POST',
        body: JSON.stringify({ name, phone: phone || undefined }),
      });
      const select = form.elements.namedItem('customerId') as HTMLSelectElement;
      select.insertAdjacentHTML(
        'beforeend',
        `<option value="${escapeText(customer.customerId)}">${escapeText(customer.name)}</option>`,
      );
      select.value = customer.customerId;
      const fields = form.querySelector<HTMLElement>('#quick-customer-fields');
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
      const start = isoFromInputs(String(values.date), String(values.startTime));
      const end = new Date(
        new Date(start).getTime() + Number(values.durationMinutes) * 60000,
      ).toISOString();
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
      toast('Reservation created.');
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
    'Block court',
    `<form id="block-form" class="form-grid"><label>Court<select name="courtId" required>${courts.map((c) => `<option value="${escapeText(c.courtId)}" ${c.courtId === courtId ? 'selected' : ''}>${escapeText(c.name)}</option>`).join('')}</select></label><label>Date<input name="date" type="date" value="${escapeText(date)}" required></label><label>Start<input name="start" type="time" value="08:00" required></label><label>End<input name="end" type="time" value="09:00" required></label><label>Reason<select name="reason"><option>MAINTENANCE</option><option>CLEANING</option><option>PRIVATE_EVENT</option><option>TOURNAMENT</option><option>WEATHER</option><option>STAFF_USE</option><option>OTHER</option></select></label><label class="full">Notes<textarea name="notes"></textarea></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>Cancel</button><button class="button primary">Block court</button></div></form>`,
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
      toast('Court blocked.');
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
    'Reservation details',
    `<div class="detail-grid"><div><span class="muted">Status</span><strong>${escapeText(reservation.status)}</strong></div><div><span class="muted">Time</span><strong>${escapeText(dateValue(reservation.startAt))} ${escapeText(timeValue(reservation.startAt))}–${escapeText(timeValue(reservation.endAt))}</strong></div><div><span class="muted">Expected</span><strong>${formatMoney(reservation.expectedAmount)}</strong></div><div><span class="muted">Paid</span><strong>${formatMoney(reservation.paidAmount ?? 0)}</strong></div></div><form id="reservation-edit-form" class="form-grid"><label>Date<input name="date" type="date" value="${escapeText(reservation.startAt.slice(0, 10))}" required></label><label>Start<input name="start" type="time" value="${escapeText(reservation.startAt.slice(11, 16))}" required></label><label>End<input name="end" type="time" value="${escapeText(reservation.endAt.slice(11, 16))}" required></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>Close</button>${reservation.status === 'CONFIRMED' ? '<button class="button primary">Save time</button>' : ''}</div></form><div class="row-actions detail-actions">${reservation.status === 'CONFIRMED' ? `${button('Complete', 'data-transition="COMPLETED"')}${button('No-show', 'data-transition="NO_SHOW"')}${button('Cancel reservation', 'data-transition="CANCELLED"')}${button('Record payment', `data-payment="${escapeText(reservation.reservationId)}"`)}` : ''}</div>`,
  );
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
      toast('Reservation updated.');
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
          `${status === 'CANCELLED' ? 'Cancel' : status === 'NO_SHOW' ? 'Mark no-show' : 'Complete'} reservation?`,
        )
      )
        return;
      try {
        await request(
          `/reservations/${id}/${status === 'CANCELLED' ? 'cancel' : status === 'NO_SHOW' ? 'no-show' : 'complete'}`,
          { method: 'POST' },
        );
        closeModal();
        toast('Reservation status updated.');
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
  await shell(async () => {
    const data = await request<{ courts: Court[]; items: ScheduleItem[] }>(
      `/schedule?date=${encodeURIComponent(date)}`,
    );
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
            () => void openReservationDetail(String(element.dataset.reservation)),
          ),
        );
      screen()
        ?.querySelectorAll<HTMLElement>('[data-block]')
        .forEach((element) =>
          element.addEventListener('click', async () => {
            if (!window.confirm('Cancel this court block?')) return;
            try {
              await request(`/blocks/${element.dataset.block}/cancel`, { method: 'POST' });
              toast('Court block cancelled.');
              await renderRoute();
            } catch (error) {
              toast(errorMessage(error), 'error');
            }
          }),
        );
    }, 0);
    return `<div class="toolbar"><div><h2>Schedule</h2><p class="muted">${escapeText(date)}</p></div><div class="row-actions"><button class="button" id="previous-day">Previous day</button><button class="button" id="today">Today</button><button class="button" id="next-day">Next day</button><button class="button" id="block-court">Block court</button><button class="button primary" id="new-booking">New reservation</button></div></div><div class="schedule-grid">${
      data.courts
        .map((court) => {
          const items = data.items.filter((item) => item.courtId === court.courtId);
          return `<article class="card court"><h3>${escapeText(court.name)} <small>${escapeText(court.sport)}</small></h3>${items.length ? items.map((item) => (item.reservationId ? `<button class="schedule-item" data-reservation="${escapeText(item.reservationId)}"><strong>${escapeText(timeValue(item.startAt))}–${escapeText(timeValue(item.endAt))}</strong><span>Reservation · ${escapeText(item.status)}</span></button>` : `<div class="schedule-item blocked"><strong>${escapeText(timeValue(item.startAt))}–${escapeText(timeValue(item.endAt))}</strong><span>Blocked · ${escapeText(item.reason)}</span>${item.blockId ? button('Cancel', `data-block="${escapeText(item.blockId)}"`) : ''}</div>`)).join('') : '<p class="empty">Available</p>'}</article>`;
        })
        .join('') || '<p class="empty">Create a court in Settings to start scheduling.</p>'
    }</div>`;
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
    return `<div class="toolbar"><div><h2>Customers</h2><p class="muted">Create and maintain customer records.</p></div><button class="button primary" id="add-customer">Add customer</button></div><form id="customer-search" class="search-bar"><input name="search" placeholder="Search name, phone, email" value="${escapeText(query)}"><button class="button">Search</button></form><article class="card table-wrap">${data.length ? `<table><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Status</th><th>Actions</th></tr></thead><tbody>${data.map((c) => `<tr><td>${escapeText(c.name)}</td><td>${escapeText(c.phone)}</td><td>${escapeText(c.email)}</td><td>${c.archived ? 'Archived' : 'Active'}</td><td class="row-actions">${button('Edit', `data-edit-customer="${escapeText(c.customerId)}"`)}${c.archived ? '' : button('Archive', `data-archive-customer="${escapeText(c.customerId)}"`)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No customers yet.</p>'}</article>`;
  });
}
function wireCustomerList() {
  app
    .querySelector<HTMLButtonElement>('#add-customer')
    ?.addEventListener('click', () => void openCustomerModal());
  app.querySelector<HTMLFormElement>('#customer-search')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = formData(event.currentTarget as HTMLFormElement);
    navigate(
      `/customers${values.search ? `?search=${encodeURIComponent(String(values.search))}` : ''}`,
    );
  });
  app.querySelectorAll<HTMLElement>('[data-edit-customer]').forEach((element) =>
    element.addEventListener('click', async () => {
      const customer = await request<Customer>(`/customers/${element.dataset.editCustomer}`);
      await openCustomerModal(undefined, customer);
    }),
  );
  app.querySelectorAll<HTMLElement>('[data-archive-customer]').forEach((element) =>
    element.addEventListener('click', async () => {
      if (!window.confirm('Archive this customer?')) return;
      try {
        await request(`/customers/${element.dataset.archiveCustomer}/archive`, { method: 'POST' });
        toast('Customer archived.');
        await renderRoute();
      } catch (error) {
        toast(errorMessage(error), 'error');
      }
    }),
  );
}
async function reservations() {
  const data = await request<Reservation[]>('/reservations');
  await shell(async () => {
    setTimeout(() => {
      screen()
        ?.querySelector('#add-reservation')
        ?.addEventListener('click', () => void openReservationModal());
      screen()
        ?.querySelectorAll<HTMLElement>('[data-reservation]')
        .forEach((element) =>
          element.addEventListener(
            'click',
            () => void openReservationDetail(String(element.dataset.reservation)),
          ),
        );
    }, 0);
    return `<div class="toolbar"><div><h2>Reservations</h2><p class="muted">Manage confirmed and completed bookings.</p></div><button class="button primary" id="add-reservation">New reservation</button></div><article class="card table-wrap">${data.length ? `<table><thead><tr><th>Date/time</th><th>Court</th><th>Customer</th><th>Status</th><th>Expected</th><th>Actions</th></tr></thead><tbody>${data.map((r) => `<tr><td>${escapeText(dateValue(r.startAt))} ${escapeText(timeValue(r.startAt))}–${escapeText(timeValue(r.endAt))}</td><td>${escapeText(r.courtId)}</td><td>${escapeText(r.customerId)}</td><td>${escapeText(r.status)}</td><td>${formatMoney(r.expectedAmount)}</td><td>${button('Open', `data-reservation="${escapeText(r.reservationId)}"`)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No reservations yet.</p>'}</article>`;
  });
}
async function requests() {
  const [data, customers] = await Promise.all([
    request<RequestItem[]>('/requests'),
    request<Customer[]>('/customers?limit=100'),
  ]);
  await shell(async () => {
    setTimeout(() => wireRequests(data, customers), 0);
    return `<div class="toolbar"><div><h2>Reservation requests</h2><p class="muted">${data.filter((item) => item.status === 'REQUESTED').length} pending</p></div></div><article class="card table-wrap">${data.length ? `<table><thead><tr><th>Customer</th><th>Requested time</th><th>Court</th><th>Status</th><th>Actions</th></tr></thead><tbody>${data.map((item) => `<tr><td>${escapeText(item.customerName)}<small>${escapeText(item.phone)}</small></td><td>${escapeText(dateValue(item.requestedStartAt))} ${escapeText(timeValue(item.requestedStartAt))}–${escapeText(timeValue(item.requestedEndAt))}</td><td>${escapeText(item.courtId)}</td><td>${escapeText(item.status)}</td><td>${item.status === 'REQUESTED' ? `${button('Review', `data-review-request="${escapeText(item.requestId)}"`)}${button('Confirm', `data-confirm-request="${escapeText(item.requestId)}"`)}${button('Reject', `data-reject-request="${escapeText(item.requestId)}"`)}` : '—'}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No reservation requests yet.</p>'}</article>`;
  });
}
function wireRequests(data: RequestItem[], customers: Customer[]) {
  app.querySelectorAll<HTMLElement>('[data-review-request]').forEach((element) =>
    element.addEventListener('click', () => {
      const item = data.find((value) => value.requestId === element.dataset.reviewRequest);
      if (item)
        openModal(
          'Request review',
          `<div class="detail-grid"><div><span class="muted">Customer</span><strong>${escapeText(item.customerName)}</strong></div><div><span class="muted">Contact</span><strong>${escapeText(item.phone)} ${escapeText(item.email)}</strong></div><div><span class="muted">Requested</span><strong>${escapeText(dateValue(item.requestedStartAt))} ${escapeText(timeValue(item.requestedStartAt))}–${escapeText(timeValue(item.requestedEndAt))}</strong></div></div><p>${escapeText(item.notes || 'No notes.')}</p>`,
        );
    }),
  );
  app.querySelectorAll<HTMLElement>('[data-confirm-request]').forEach((element) =>
    element.addEventListener('click', () => {
      const item = data.find((value) => value.requestId === element.dataset.confirmRequest);
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
    'Confirm request',
    `<form id="confirm-request-form" class="form-grid"><p class="full">${escapeText(item.customerName)} · ${escapeText(dateValue(item.requestedStartAt))} ${escapeText(timeValue(item.requestedStartAt))}</p><label class="full">Customer<select name="customerId"><option value="">Create customer from request</option>${customerOptions(customers, item.linkedCustomerId)}</select></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>Cancel</button><button class="button primary">Confirm request</button></div></form>`,
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
        body: JSON.stringify(values.customerId ? { customerId: values.customerId } : {}),
      });
      closeModal();
      toast('Request confirmed.');
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
async function rejectRequest(id: string) {
  openModal(
    'Reject request',
    `<form id="reject-request-form" class="form-grid"><label class="full">Reason<textarea name="reason" maxlength="1000"></textarea></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>Cancel</button><button class="button danger">Reject request</button></div></form>`,
  );
  const form = app.querySelector<HTMLFormElement>('#reject-request-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!window.confirm('Reject this request?')) return;
    setBusy(form, true);
    try {
      const values = formData(form);
      await request(`/requests/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: values.reason || undefined }),
      });
      closeModal();
      toast('Request rejected.');
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
    'Record payment',
    `<form id="payment-form" class="form-grid"><label class="full">Reservation<select name="reservationId" required>${reservationsData.map((r) => `<option value="${escapeText(r.reservationId)}" data-customer="${escapeText(r.customerId)}" data-remaining="${escapeText(r.remainingAmount ?? r.expectedAmount)}">${escapeText(dateValue(r.startAt))} ${escapeText(timeValue(r.startAt))} · ${formatMoney(r.expectedAmount)}</option>`).join('')}</select></label><label>Customer<select name="customerId" required>${customerOptions(customers, reservation?.customerId)}</select></label><label>Amount<input name="amount" type="number" min="0" step="0.01" required value="${escapeText(reservation?.remainingAmount ?? '')}"></label><label>Method<select name="method"><option>PIX</option><option>CASH</option><option>CREDIT_CARD</option><option>DEBIT_CARD</option><option>BANK_TRANSFER</option><option>OTHER</option></select></label><label>Paid at<input name="paidAt" type="datetime-local" required value="${escapeText(new Date().toISOString().slice(0, 16))}"></label><label class="full">Notes<textarea name="notes"></textarea></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>Cancel</button><button class="button primary">Record payment</button></div></form>`,
  );
  const form = app.querySelector<HTMLFormElement>('#payment-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.querySelector('[name="reservationId"]')?.addEventListener('change', (event) => {
    const option = (event.target as HTMLSelectElement).selectedOptions[0];
    if (!option) return;
    const customer = form.elements.namedItem('customerId') as HTMLSelectElement;
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
      toast('Payment recorded.');
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
            if (!window.confirm('Delete this payment record?')) return;
            try {
              await request(`/payments/${element.dataset.deletePayment}`, { method: 'DELETE' });
              toast('Payment deleted.');
              await renderRoute();
            } catch (error) {
              toast(errorMessage(error), 'error');
            }
          }),
        );
    }, 0);
    return `<div class="toolbar"><div><h2>Payments</h2><p class="muted">External payment records.</p></div><button class="button primary" id="record-payment">Record payment</button></div><article class="card table-wrap">${data.length ? `<table><thead><tr><th>Paid at</th><th>Amount</th><th>Method</th><th>Reservation/class</th><th>Actions</th></tr></thead><tbody>${data.map((p) => `<tr><td>${escapeText(dateValue(p.paidAt))}</td><td>${formatMoney(p.amount)}</td><td>${escapeText(p.method)}</td><td>${escapeText(p.reservationId ?? p.classId)}</td><td>${button('Delete', `data-delete-payment="${escapeText(p.paymentId)}"`)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No payments yet.</p>'}</article>`;
  });
}
async function classes() {
  const org = await request<Organization>('/organization');
  const data = await request<SportClass[]>('/classes');
  const courts = await request<Court[]>('/courts');
  const customers = await request<Customer[]>('/customers?limit=100');
  await shell(async () => {
    setTimeout(() => wireClasses(data, customers), 0);
    return `<div class="toolbar"><div><h2>Classes</h2><p class="muted">Recurring court sessions and attendance.</p></div>${org.features.classes ? '<button class="button primary" id="add-class">Add class</button>' : ''}</div>${org.features.classes ? `<article class="card table-wrap">${data.length ? `<table><thead><tr><th>Name</th><th>Sport</th><th>Schedule</th><th>Capacity</th><th>Actions</th></tr></thead><tbody>${data.map((c) => `<tr><td>${escapeText(c.name)}</td><td>${escapeText(c.sport)}</td><td>${escapeText(c.startDate)} ${escapeText(c.startTime)}</td><td>${c.capacity}</td><td>${button('Enroll', `data-enroll-class="${escapeText(c.classId)}"`)} ${button('Attendance', `data-attendance-class="${escapeText(c.classId)}"`)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No classes yet.</p>'}</article>` : `<article class="card"><h3>Classes disabled</h3><p class="empty">Enable classes in Settings to create sessions.</p><a class="button" href="/settings">Open settings</a></article>`}`;
  });
  if (org.features.classes)
    setTimeout(() => {
      screen()
        ?.querySelector('#add-class')
        ?.addEventListener('click', () => void openClassModal(courts));
    }, 0);
}
function classForm(courts: Court[]) {
  return `<form id="class-form" class="form-grid"><label>Name<input name="name" required></label><label>Sport<input name="sport" required></label><label>Court<select name="courtId" required>${courts.map((c) => `<option value="${escapeText(c.courtId)}">${escapeText(c.name)}</option>`).join('')}</select></label><label>Capacity<input name="capacity" type="number" min="1" required value="10"></label><label>Price<input name="price" type="number" min="0" step="0.01" required value="0"></label><label>Weekday<select name="weekday"><option value="0">Sunday</option><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option></select></label><label>Start time<input name="startTime" type="time" required value="18:00"></label><label>Duration<input name="durationMinutes" type="number" min="30" required value="60"></label><label>Start date<input name="startDate" type="date" required value="${today()}"></label><label>End date<input name="endDate" type="date" value="${today()}"></label><label class="full">Notes<textarea name="notes"></textarea></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>Cancel</button><button class="button primary">Create class</button></div></form>`;
}
function openClassModal(courts: Court[]) {
  openModal('Add class', classForm(courts));
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
      toast('Class created.');
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
function openEnrollmentModal(classId: string, customers: Customer[], returnFocus: HTMLElement) {
  openModal(
    'Enroll customer',
    `<form id="enroll-form" class="form-grid"><label class="full">Customer<select name="customerId" required>${customerOptions(customers)}</select></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>Cancel</button><button class="button primary">Enroll</button></div></form>`,
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
      toast('Customer enrolled.');
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
        openEnrollmentModal(String(element.dataset.enrollClass), customers, element),
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
    'Record attendance',
    `<form id="attendance-form" class="form-grid"><input type="hidden" name="classId" value="${escapeText(classId)}"><label class="full">Customer<select name="customerId" required>${customerOptions(customers)}</select></label><label>Date<input name="date" type="date" required value="${today()}"></label><label>Status<select name="status"><option>PRESENT</option><option>ABSENT</option><option>EXCUSED</option></select></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>Cancel</button><button class="button primary">Save attendance</button></div></form>`,
  );
  const form = app.querySelector<HTMLFormElement>('#attendance-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      await request('/classes/attendance', { method: 'POST', body: JSON.stringify(values) });
      closeModal();
      toast('Attendance saved.');
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
async function reports() {
  await shell(async () => {
    const data = await request<Record<string, unknown>>('/reports/summary');
    return `<div class="toolbar"><h2>Reports</h2></div><article class="card"><div class="metrics"><div class="metric"><span>Reservations</span><strong>${data.reservationCount}</strong></div><div class="metric"><span>Expected revenue</span><strong>${formatMoney(Number(data.expectedRevenue))}</strong></div><div class="metric"><span>Recorded payments</span><strong>${formatMoney(Number(data.recordedPayments))}</strong></div></div></article>`;
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
      target.innerHTML = `<article class="card error-state"><h2>Could not load this screen</h2><p>${escapeText(errorMessage(error))}</p><button class="button" onclick="location.reload()">Try again</button></article>`;
  }
}
async function publicBooking(slug: string) {
  try {
    const venue = await request<{
      name: string;
      courts: { courtId: string; name: string; sport: string }[];
    }>(`/public/venues/${encodeURIComponent(slug)}`);
    app.innerHTML = `<main class="login"><section class="card public-booking"><h1>${escapeText(venue.name)}</h1><p class="muted">Request a court reservation</p><form id="public-form"><label>Court<select name="courtId" required>${venue.courts.map((court) => `<option value="${escapeText(court.courtId)}">${escapeText(court.name)} — ${escapeText(court.sport)}</option>`).join('')}</select></label><label>Date<input type="date" name="date" required></label><label>Start time<input type="time" name="time" required></label><label>Duration<select name="durationMinutes"><option value="30">30 minutes</option><option value="60">60 minutes</option><option value="120">2 hours</option></select></label><label>Name<input name="customerName" required></label><label>Phone<input name="phone" required></label><label>Email (optional)<input name="email" type="email"></label><label>Notes (optional)<textarea name="notes"></textarea></label><p class="notice">This is a reservation request. Your reservation is not confirmed yet. The venue will contact you after reviewing it.</p><button class="button primary">Send request</button><p id="public-result" role="status"></p></form></section></main>`;
    app
      .querySelector<HTMLFormElement>('#public-form')
      ?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const values = formData(form);
        const start = isoFromInputs(String(values.date), String(values.time)),
          end = new Date(
            new Date(start).getTime() + Number(values.durationMinutes) * 60000,
          ).toISOString();
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
          result.textContent = 'Request sent. The venue will contact you after reviewing it.';
          form.reset();
        } catch (error) {
          result.textContent = errorMessage(error);
        }
      });
  } catch (error) {
    app.innerHTML = `<main class="login"><article class="card error-state"><h2>Venue unavailable</h2><p>${escapeText(errorMessage(error))}</p></article></main>`;
  }
}
const renderRoute = async () => {
  if (location.pathname.startsWith('/book/'))
    await publicBooking(location.pathname.split('/')[2] ?? '');
  else await render();
};
window.addEventListener('popstate', () => void renderRoute());
void renderRoute();
