import type {
  FixedCourtAgreement,
  FixedCourtOccurrence,
} from '@court-manager/contracts';
import type { Court, Customer } from '../core/types.js';
import { formatDate, formatMoney, t, weekdayLabel } from '../i18n.js';
import { toast } from '../ui/feedback.js';
import { formData, setBusy, showFormError } from '../ui/forms.js';
import { closeModal, openModal } from '../ui/modal.js';
import { shell } from '../ui/shell.js';
import { app, escapeText, renderRoute, request, screen } from './runtime.js';

type AgreementDetails = FixedCourtAgreement & {
  occurrences: FixedCourtOccurrence[];
};

const today = () => new Date().toISOString().slice(0, 10);

const statusBadge = (status: FixedCourtAgreement['status']) =>
  `<span class="status-badge status-${escapeText(status)}">${escapeText(t(`fixedCourtAgreements.status.${status}` as never))}</span>`;

const weekdays = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;

export async function fixedCourtAgreements() {
  const customerId = new URLSearchParams(location.search).get('customerId');
  const [agreements, customers, courts] = await Promise.all([
    request<FixedCourtAgreement[]>(
      `/fixed-court-agreements?limit=100${customerId ? `&customerId=${encodeURIComponent(customerId)}` : ''}`,
    ),
    request<Customer[]>('/customers?limit=100'),
    request<Court[]>('/courts?limit=100'),
  ]);
  const customerName = (id: string) =>
    customers.find((customer) => customer.customerId === id)?.name ?? id;
  const courtName = (id: string) =>
    courts.find((court) => court.courtId === id)?.name ?? id;
  await shell(
    () => {
      return `<div class="toolbar"><div><h2>${t('fixedCourtAgreements.title')}</h2><p class="muted">${t('fixedCourtAgreements.description')}</p></div><button class="button primary" id="add-fixed-agreement">${t('fixedCourtAgreements.add')}</button></div><article class="card table-wrap"><table><thead><tr><th>${t('common.customer')}</th><th>${t('common.court')}</th><th>${t('common.weekday')}</th><th>${t('common.time')}</th><th>${t('common.price')}</th><th>${t('common.status')}</th><th>${t('common.actions')}</th></tr></thead><tbody>${agreements.length ? agreements.map((agreement) => `<tr><td><strong>${escapeText(customerName(agreement.customerId))}</strong></td><td>${escapeText(courtName(agreement.courtId))}</td><td>${escapeText(weekdayLabel(agreement.weekday))}</td><td>${escapeText(agreement.startTime)} · ${agreement.durationMinutes} ${t('fixedCourtAgreements.minutes')}</td><td>${escapeText(formatMoney(agreement.monthlyPrice, agreement.currency))}/${t('fixedCourtAgreements.month')}</td><td>${statusBadge(agreement.status)}</td><td class="row-actions"><button class="button small" data-fixed-action="details" data-fixed-id="${escapeText(agreement.agreementId)}">${t('fixedCourtAgreements.details')}</button>${agreement.status === 'ACTIVE' ? `<button class="button small" data-fixed-action="pause" data-fixed-id="${escapeText(agreement.agreementId)}">${t('fixedCourtAgreements.pause')}</button><button class="button small" data-fixed-action="change" data-fixed-id="${escapeText(agreement.agreementId)}">${t('fixedCourtAgreements.change')}</button><button class="button small danger" data-fixed-action="cancel" data-fixed-id="${escapeText(agreement.agreementId)}">${t('fixedCourtAgreements.cancel')}</button>` : agreement.status === 'PAUSED' ? `<button class="button small" data-fixed-action="resume" data-fixed-id="${escapeText(agreement.agreementId)}">${t('fixedCourtAgreements.resume')}</button>` : ''}</td></tr>`).join('') : `<tr><td colspan="7" class="empty">${t('fixedCourtAgreements.empty')}</td></tr>`}</tbody></table></article>`;
    },
    () => wireFixedAgreements(customers, courts),
  );
}

function wireFixedAgreements(customers: Customer[], courts: Court[]) {
  screen()
    ?.querySelector('#add-fixed-agreement')
    ?.addEventListener('click', () => void openCreateModal(customers, courts));
  screen()
    ?.querySelectorAll<HTMLElement>('[data-fixed-action]')
    .forEach((button) =>
      button.addEventListener('click', async () => {
        const action = button.dataset.fixedAction;
        const id = button.dataset.fixedId;
        if (!action || !id) return;
        if (action === 'details')
          return void openRichDetails(id, customers, courts);
        if (action === 'change') return void openChangeModal(id, courts);
        if (
          action === 'cancel' &&
          !window.confirm(t('fixedCourtAgreements.cancel'))
        )
          return;
        try {
          await request(`/fixed-court-agreements/${id}/${action}`, {
            method: 'POST',
            body: JSON.stringify({}),
          });
          const messageKey =
            action === 'pause'
              ? 'fixedCourtAgreements.paused'
              : action === 'resume'
                ? 'fixedCourtAgreements.resumed'
                : 'fixedCourtAgreements.cancelled';
          toast(t(messageKey as never));
          await renderRoute();
        } catch (error) {
          toast(
            String(error instanceof Error ? error.message : error),
            'error',
          );
        }
      }),
    );
}

function customerOptions(customers: Customer[]) {
  return customers
    .filter((customer) => !customer.archived)
    .map(
      (customer) =>
        `<option value="${escapeText(customer.customerId)}">${escapeText(customer.name)}</option>`,
    )
    .join('');
}

function courtOptions(courts: Court[]) {
  return courts
    .filter((court) => court.active && !court.archivedAt)
    .map(
      (court) =>
        `<option value="${escapeText(court.courtId)}">${escapeText(court.name)}</option>`,
    )
    .join('');
}

function weekdayOptions(selected = 'WEDNESDAY') {
  return weekdays
    .map(
      (weekday) =>
        `<option value="${weekday}"${weekday === selected ? ' selected' : ''}>${escapeText(weekdayLabel(weekday))}</option>`,
    )
    .join('');
}

function agreementFields(
  customers: Customer[],
  courts: Court[],
  agreement?: FixedCourtAgreement,
) {
  return `<label>${t('common.customer')}<select name="customerId" required>${customerOptions(customers)}</select></label><label>${t('common.court')}<select name="courtId" required>${courtOptions(courts)}</select></label><label>${t('common.weekday')}<select name="weekday" required>${weekdayOptions(agreement?.weekday)}</select></label><label>${t('common.startTime')}<input name="startTime" type="time" required value="${escapeText(agreement?.startTime ?? '19:00')}"></label><label>${t('common.duration')}<select name="durationMinutes"><option value="60">60 ${t('fixedCourtAgreements.minutes')}</option><option value="90">90 ${t('fixedCourtAgreements.minutes')}</option><option value="120" selected>120 ${t('fixedCourtAgreements.minutes')}</option></select></label><label>${t('common.start')}<input name="startDate" type="date" required value="${escapeText(agreement?.startDate ?? today())}"></label><label>${t('common.end')} <span class="muted">(${t('common.optional')})</span><input name="endDate" type="date" value="${escapeText(agreement?.endDate ?? '')}"></label><label>${t('fixedCourtAgreements.intervalWeeks')}<input name="intervalWeeks" type="number" min="1" max="52" value="${agreement?.intervalWeeks ?? 1}" required></label><label>${t('common.price')}<input name="monthlyPrice" type="number" min="0" step="0.01" required value="${agreement?.monthlyPrice ?? ''}"></label>`;
}

async function openCreateModal(customers: Customer[], courts: Court[]) {
  openModal(
    t('fixedCourtAgreements.add'),
    `<form id="fixed-agreement-form" class="form-grid">${agreementFields(customers, courts)}<label class="checkbox full"><input name="skipConflicts" type="checkbox">${t('fixedCourtAgreements.skipConflicts')}</label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${t('fixedCourtAgreements.create')}</button></div></form>`,
  );
  const form = app.querySelector<HTMLFormElement>('#fixed-agreement-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      await request('/fixed-court-agreements', {
        method: 'POST',
        body: JSON.stringify({
          ...values,
          durationMinutes: Number(values.durationMinutes),
          intervalWeeks: Number(values.intervalWeeks),
          monthlyPrice: Number(values.monthlyPrice),
          endDate: values.endDate || undefined,
          skipConflicts: Boolean(values.skipConflicts),
        }),
      });
      closeModal();
      toast(t('fixedCourtAgreements.created'));
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}

async function openChangeModal(id: string, courts: Court[]) {
  const agreement = await request<FixedCourtAgreement>(
    `/fixed-court-agreements/${id}`,
  );
  openModal(
    t('fixedCourtAgreements.change'),
    `<form id="fixed-change-form" class="form-grid"><label>${t('common.court')}<select name="courtId" required>${courtOptions(courts)}</select></label><label>${t('common.weekday')}<select name="weekday" required>${weekdayOptions(agreement.weekday)}</select></label><label>${t('common.startTime')}<input name="startTime" type="time" required value="${escapeText(agreement.startTime)}"></label><label>${t('common.duration')}<input name="durationMinutes" type="number" min="30" max="240" value="${agreement.durationMinutes}" required></label><label>${t('fixedCourtAgreements.effectiveDate')}<input name="effectiveDate" type="date" required value="${today()}"></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${t('common.saveChanges')}</button></div></form>`,
  );
  const form = app.querySelector<HTMLFormElement>('#fixed-change-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      await request(`/fixed-court-agreements/${id}/change-slot`, {
        method: 'POST',
        body: JSON.stringify({
          ...values,
          durationMinutes: Number(values.durationMinutes),
        }),
      });
      closeModal();
      toast(t('fixedCourtAgreements.changed'));
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}

async function openRichDetails(
  id: string,
  customers: Customer[],
  courts: Court[],
) {
  const agreement = await request<AgreementDetails>(
    `/fixed-court-agreements/${id}`,
  );
  const charges = await request<
    Array<{ amount: number; paidAmount: number; paymentStatus: string }>
  >(
    `/charges?customerId=${encodeURIComponent(agreement.customerId)}&sourceType=FIXED_COURT_AGREEMENT`,
  );
  const customer =
    customers.find((item) => item.customerId === agreement.customerId)?.name ??
    agreement.customerId;
  const court =
    courts.find((item) => item.courtId === agreement.courtId)?.name ??
    agreement.courtId;
  const nextOccurrence = agreement.occurrences
    .filter((item) => item.status === 'BOOKED' && item.date >= today())
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const charge = charges[0];
  openModal(
    t('fixedCourtAgreements.details'),
    `<div class="detail-grid"><div><small class="muted">${t('common.customer')}</small><strong>${escapeText(customer)}</strong></div><div><small class="muted">${t('common.court')}</small><strong>${escapeText(court)}</strong></div><div><small class="muted">${t('common.weekday')}</small><strong>${escapeText(weekdayLabel(agreement.weekday))}</strong></div><div><small class="muted">${t('common.time')}</small><strong>${escapeText(agreement.startTime)} · ${agreement.durationMinutes} ${t('fixedCourtAgreements.minutes')}</strong></div><div><small class="muted">${t('common.price')}</small><strong>${escapeText(formatMoney(agreement.monthlyPrice, agreement.currency))}/${t('fixedCourtAgreements.month')}</strong></div><div><small class="muted">${t('common.status')}</small><strong>${statusBadge(agreement.status)}</strong></div><div><small class="muted">${t('fixedCourtAgreements.nextOccurrence')}</small><strong>${nextOccurrence ? escapeText(formatDate(nextOccurrence.date)) : '—'}</strong></div><div><small class="muted">${t('fixedCourtAgreements.billing')}</small><strong>${charge ? `${escapeText(t(`paymentStatus.${charge.paymentStatus}` as never))} · ${escapeText(formatMoney(charge.paidAmount, agreement.currency))} / ${escapeText(formatMoney(charge.amount, agreement.currency))}` : t('fixedCourtAgreements.notBilled')}</strong></div></div><article class="section-card table-wrap"><h3>${t('fixedCourtAgreements.linkedReservations')}</h3><table><thead><tr><th>${t('common.date')}</th><th>${t('common.time')}</th><th>${t('common.status')}</th><th>${t('fixedCourtAgreements.reservation')}</th></tr></thead><tbody>${agreement.occurrences.map((occurrence) => `<tr><td>${escapeText(formatDate(occurrence.date))}</td><td>${escapeText(occurrence.startAt.slice(11, 16))}–${escapeText(occurrence.endAt.slice(11, 16))}</td><td>${escapeText(occurrence.status)}</td><td>${escapeText(occurrence.reservationId ?? '—')}</td></tr>`).join('')}</tbody></table></article><div class="form-actions"><button class="button" data-close>${t('common.close')}</button></div>`,
  );
  app.querySelector('[data-close]')?.addEventListener('click', closeModal);
}
