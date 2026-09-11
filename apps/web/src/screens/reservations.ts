import {
  endIsoFromInputs,
  isoFromInputs,
  localDateKey,
  dateValue,
  timeValue,
  today,
  errorMessage,
} from '../core/presentation.js';
import type { Court, Customer, Reservation } from '../core/types.js';
import { button } from '../dom.js';
import {
  formatMoney,
  paymentStatusLabel,
  reservationStatusLabel,
  t,
} from '../i18n.js';
import { toast } from '../ui/feedback.js';
import { formData, setBusy, showFormError } from '../ui/forms.js';
import { closeModal, openModal } from '../ui/modal.js';
import { shell } from '../ui/shell.js';
import { customerOptions } from './customers.js';
import { openPaymentModal } from './finance.js';
import { app, escapeText, renderRoute, request, screen } from './runtime.js';

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

export async function openReservationModal(
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
  let availabilityRequest = Promise.resolve();
  const refresh = () => {
    availabilityRequest = loadAvailability(form);
    updatePrice();
  };
  form.querySelector('[name="courtId"]')?.addEventListener('change', refresh);
  form.querySelector('[name="date"]')?.addEventListener('change', refresh);
  form.querySelector('[name="date"]')?.addEventListener('input', refresh);
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
    await availabilityRequest;
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
export async function openBlockModal(date = today(), courtId?: string) {
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
export async function openReservationDetail(id: string) {
  const reservation = await request<Reservation>(`/reservations/${id}`);
  openModal(
    t('reservations.details'),
    `<div class="detail-grid"><div><span class="muted">${t('common.status')}</span><strong>${reservationStatusLabel(reservation.status)}</strong></div><div><span class="muted">${t('common.time')}</span><strong>${escapeText(dateValue(reservation.startAt))} ${escapeText(timeValue(reservation.startAt))}–${escapeText(timeValue(reservation.endAt))}</strong></div><div><span class="muted">${t('common.expected')}</span><strong>${formatMoney(reservation.expectedAmount)}</strong></div><div><span class="muted">${t('common.paid')}</span><strong>${formatMoney(reservation.paidAmount ?? 0)}</strong></div></div><form id="reservation-edit-form" class="form-grid"><label>${t('common.date')}<input name="date" type="date" value="${escapeText(reservation.startAt.slice(0, 10))}" required></label><label>${t('common.start')}<input name="start" type="time" value="${escapeText(reservation.startAt.slice(11, 16))}" required></label><label>${t('common.end')}<input name="end" type="time" value="${escapeText(reservation.endAt.slice(11, 16))}" required></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.close')}</button>${reservation.status === 'CONFIRMED' ? `<button class="button primary">${t('reservations.saveTime')}</button>` : ''}</div></form><div class="row-actions detail-actions">${reservation.status === 'CONFIRMED' ? `${button(t('reservations.complete'), 'data-transition="COMPLETED"')}${button(t('reservations.noShow'), 'data-transition="NO_SHOW"')}${button(t('reservations.cancel'), 'data-transition="CANCELLED"')}${button(t('reservations.recordPayment'), `data-payment="${escapeText(reservation.reservationId)}"`)}` : ''}</div>`,
  );
  if (reservation.status === 'BOOKED')
    app
      .querySelector<HTMLElement>('.modal .detail-actions')
      ?.insertAdjacentHTML(
        'afterbegin',
        button(t('classSession.checkIn'), 'data-transition="CHECKED_IN"'),
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
          status === 'CANCELLED'
            ? t('reservations.cancelConfirmation')
            : status === 'NO_SHOW'
              ? t('reservations.noShowConfirmation')
              : t('reservations.completeConfirmation'),
        )
      )
        return;
      try {
        await request(
          `/reservations/${id}/${status === 'CANCELLED' ? 'cancel' : status === 'NO_SHOW' ? 'no-show' : status === 'CHECKED_IN' ? 'check-in' : 'complete'}`,
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
export async function reservations() {
  const data = await request<Reservation[]>('/reservations');
  await shell(
    async () => {
      return `<div class="toolbar"><div><h2>${t('reservations.title')}</h2><p class="muted">${t('reservations.description')}</p></div><button class="button primary" id="add-reservation">${t('reservations.new')}</button></div><article class="card table-wrap">${data.length ? `<table><thead><tr><th>${t('common.dateTime')}</th><th>${t('common.court')}</th><th>${t('common.customer')}</th><th>${t('common.status')}</th><th>${t('common.expected')}</th><th>${t('common.actions')}</th></tr></thead><tbody>${data.map((r) => `<tr><td>${escapeText(dateValue(r.startAt))} ${escapeText(timeValue(r.startAt))}–${escapeText(timeValue(r.endAt))}</td><td>${escapeText(r.courtId)}</td><td>${escapeText(r.customerId)}</td><td>${reservationStatusLabel(r.status)} · ${paymentStatusLabel(r.paymentStatus ?? 'UNPAID')}</td><td>${formatMoney(r.expectedAmount)}</td><td>${button(t('common.open' as never), `data-reservation="${escapeText(r.reservationId)}"`)}</td></tr>`).join('')}</tbody></table>` : `<p class="empty">${t('reservations.noReservations')}</p>`}</article>`;
    },
    () => {
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
    },
  );
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
